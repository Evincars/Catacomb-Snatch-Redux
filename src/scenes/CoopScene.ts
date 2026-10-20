import { Container } from 'pixi.js';
import type { Scene, SceneManager } from '../game/SceneManager';
import { coop, invitePeer } from '../network/CoopSession';
import { savedRun } from '../game/SaveStore';
import { makeText, makeTitle } from '../ui/PixelText';
import { PixelButton } from '../ui/PixelButton';
import { NameField } from '../ui/NameField';
import { gameState } from '../game/GameState';
import { settings } from '../game/Settings';
import { GAME_WIDTH, GAME_HEIGHT } from '../render/Camera';
import { attempt, attemptAsync, report, StateError } from '../core/errors';

export class CoopScene implements Scene {
  container = new Container();
  private input = document.createElement('input');
  private nameField: NameField;
  private disposed = false;
  private overlayWatch?: ReturnType<typeof setInterval>;
  private place: () => void;

  constructor(private manager: SceneManager, role: 'host' | 'guest', destination?: string) {
    const canvas = manager.application.canvas;
    const title = makeTitle(role === 'host' ? 'Host multiplayer' : 'Join multiplayer');
    title.x = 256; title.y = 30;
    this.container.addChild(title);
    // A loaded save only has room for the guests it was saved with.
    const savedGuests = savedRun.pending ? savedRun.pending.state.entities.filter(e => e.data.playerSlot && e.data.playerSlot !== 'host').length : null;
    if (role === 'host') {
      gameState.multiplayerMode = savedRun.pending?.state.settings.multiplayerMode ?? 'companion';
      const mode = this.button('', 58, () => {
        const next = gameState.multiplayerMode === 'companion' ? 'enemy' : 'companion';
        if (next === 'enemy' && coop.guestSlots().length > 1) {
          status.text = 'An enemy match is one against one. Let the extra players leave first.';
          return;
        }
        gameState.multiplayerMode = next;
        mode.setText(modeLabel());
        coop.sendMode();
      });
      const modeLabel = () => `Guests: ${gameState.multiplayerMode === 'enemy' ? 'Enemy (1v1)' : 'Companions (up to 3)'}`;
      mode.setText(modeLabel());
      mode.setEnabled(!savedRun.pending);
    }
    const status = makeText('', 0xffdd88, 8, 'center');
    status.x = 256; status.y = 94;
    this.container.addChild(status);

    this.input.type = 'text';
    this.input.setAttribute('aria-label', role === 'host' ? 'Multiplayer invite link' : 'Host invite link or peer ID');
    this.input.placeholder = 'Paste invite link or peer ID';
    this.input.style.cssText = 'position:fixed;box-sizing:border-box;padding:0 8px;background:#241b18;color:#fff;border:1px solid #d9a454;z-index:10';
    this.input.readOnly = role === 'host';
    document.body.appendChild(this.input);
    this.place = () => {
      const rect = canvas.getBoundingClientRect();
      const sx = rect.width / GAME_WIDTH;
      const sy = rect.height / GAME_HEIGHT;
      this.input.style.left = `${rect.left + 70 * sx}px`;
      this.input.style.top = `${rect.top + 108 * sy}px`;
      this.input.style.width = `${372 * sx}px`;
      this.input.style.height = `${22 * sy}px`;
      this.input.style.fontSize = `${Math.max(10, 10 * sy)}px`;
    };
    window.addEventListener('resize', this.place);
    this.place();

    const copyInvite = async () => {
      if (!coop.invite) throw new StateError('Invite is not ready yet');
      await navigator.clipboard.writeText(coop.invite);
      status.text = 'Invite copied. Send it to the other players.';
    };
    const connect = async () => {
      await coop.open('guest', invitePeer(this.input.value));
      watch();
    };
    const action = this.button(role === 'host' ? 'Copy invite' : 'Connect', 136, async () => {
      const done = await attemptAsync(role === 'host' ? copyInvite : connect, 'network');
      if (!done.ok) showError(done.error);
    });

    // Everyone sets the name the others will see above their character.
    const nameLabel = makeText('Your name', 0xffdd88, 8, 'center');
    nameLabel.x = 256; nameLabel.y = 172;
    this.container.addChild(nameLabel);
    this.nameField = new NameField(canvas, 136, 184, 240, 22);
    this.button('Options', 212, () => manager.pushOverlay('options'));

    const roster = makeText('', 0xffffff, 8, 'center');
    roster.x = 256; roster.y = 246;
    this.container.addChild(roster);

    const start = this.button('Choose level / start', 298, () => {
      if (!ready()) return;
      manager.goto(savedRun.pending ? 'in_game' : 'level_select');
    });
    start.visible = role === 'host';
    const ready = () => savedGuests === null ? coop.connected : coop.guestSlots().length === savedGuests;
    const showRoster = () => {
      const lines = coop.roster.map((p, i) => `${i + 1}. ${p.name}${p.slot === 'host' ? ' (host)' : ''}`);
      roster.text = lines.length ? `Players in the room\n${lines.join('\n')}` : '';
    };
    const watch = () => {
      coop.onChange = () => {
        if (this.disposed) return;
        status.text = savedGuests !== null && role === 'host' && coop.guestSlots().length < savedGuests
          ? `This save needs ${savedGuests} guest${savedGuests > 1 ? 's' : ''} (${coop.guestSlots().length} here).`
          : coop.status;
        if (role === 'host') this.input.value = coop.invite;
        start.setEnabled(ready());
        action.setEnabled(role !== 'host' || !!coop.invite);
        showRoster();
      };
      coop.onState = () => {
        if (!this.disposed && role === 'guest') manager.goto('in_game');
      };
      coop.onChange();
    };
    this.button('Cancel', 334, () => {
      coop.close(); savedRun.pending = null; manager.goto('title');
    });
    const showError = (error: unknown) => {
      status.text = report(error, 'Co-op lobby', 'network').message;
    };
    if (role === 'host') {
      void coop.open('host').catch(showError);
      coop.guestLimit = savedGuests;
      watch();
    } else if (destination) {
      this.input.value = destination;
      const peer = attempt(() => invitePeer(destination));
      if (peer.ok) void coop.open('guest', peer.value).catch(showError);
      else showError(peer.error);
      watch();
    } else status.text = 'Paste the link your host sent you.';

    // The Options screen lies over this one; the text boxes would show through it.
    let overlay = false;
    this.overlayWatch = setInterval(() => {
      if (manager.hasOverlay === overlay) return;
      overlay = manager.hasOverlay;
      this.container.interactiveChildren = !overlay;
      this.input.style.display = overlay ? 'none' : '';
      this.nameField.visible = !overlay;
      if (!overlay) {
        this.nameField.element.value = settings.playerName;
        this.place();
      }
    }, 150);
  }

  private button(text: string, y: number, action: () => void): PixelButton {
    const button = new PixelButton(text, 240, 28);
    button.x = 136; button.y = y; button.onPress = action;
    this.container.addChild(button);
    return button;
  }
  destroy(): void {
    this.disposed = true;
    clearInterval(this.overlayWatch);
    window.removeEventListener('resize', this.place);
    coop.onChange = null;
    this.nameField.destroy();
    this.input.remove();
    this.container.destroy({ children: true });
  }
}
