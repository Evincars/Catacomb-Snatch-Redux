import { Container } from 'pixi.js';
import type { Scene, SceneManager } from '../game/SceneManager';
import { coop, invitePeer } from '../network/CoopSession';
import { savedRun } from '../game/SaveStore';
import { makeText, makeTitle } from '../ui/PixelText';
import { PixelButton } from '../ui/PixelButton';

export class CoopScene implements Scene {
  container = new Container();
  private input = document.createElement('input');
  private disposed = false;

  constructor(private manager: SceneManager, role: 'host' | 'guest', destination?: string) {
    const title = makeTitle(role === 'host' ? 'Host co-op' : 'Join co-op');
    title.x = 256; title.y = 38;
    this.container.addChild(title);
    const status = makeText('', 0xffdd88, 8, 'center');
    status.x = 256; status.y = 110;
    this.container.addChild(status);
    this.input.type = 'text';
    this.input.setAttribute('aria-label', role === 'host' ? 'Co-op invite link' : 'Host invite link or peer ID');
    this.input.placeholder = 'Paste invite link or peer ID';
    this.input.style.cssText = 'position:fixed;left:15%;top:42%;width:70%;box-sizing:border-box;padding:10px;background:#241b18;color:#fff;border:1px solid #d9a454';
    this.input.readOnly = role === 'host';
    document.body.appendChild(this.input);
    const action = this.button(role === 'host' ? 'Copy invite' : 'Connect', 215, async () => {
      try {
        if (role === 'host') {
          if (!coop.invite) throw new Error('Invite is not ready yet');
          await navigator.clipboard.writeText(coop.invite);
          status.text = 'Invite copied. Send it to your teammate.';
        } else {
          const peer = invitePeer(this.input.value);
          await coop.open('guest', peer);
          watch();
        }
      } catch (error) {
        console.error('Co-op lobby:', error);
        status.text = error instanceof Error ? error.message : String(error);
      }
    });
    const start = this.button('Choose level / start', 255, () => {
      if (!coop.connected) return;
      manager.goto(savedRun.pending ? 'in_game' : 'level_select');
    });
    start.visible = role === 'host';
    const watch = () => {
      coop.onChange = () => {
        if (this.disposed) return;
        status.text = coop.status;
        if (role === 'host') this.input.value = coop.invite;
        start.setEnabled(coop.connected);
        action.setEnabled(role !== 'host' || !!coop.invite);
      };
      coop.onState = () => {
        if (!this.disposed && role === 'guest') manager.goto('in_game');
      };
      coop.onChange();
    };
    this.button('Cancel', 310, () => {
      coop.close(); savedRun.pending = null; manager.goto('title');
    });
    const showError = (error: unknown) => {
      console.error('Co-op lobby:', error);
      status.text = error instanceof Error ? error.message : String(error);
    };
    if (role === 'host') {
      void coop.open('host').catch(showError);
      watch();
    } else if (destination) {
      this.input.value = destination;
      try { void coop.open('guest', invitePeer(destination)).catch(showError); }
      catch (error) { showError(error); }
      watch();
    } else status.text = 'Paste the link your host sent you.';
  }

  private button(text: string, y: number, action: () => void): PixelButton {
    const button = new PixelButton(text, 240, 28);
    button.x = 136; button.y = y; button.onPress = action;
    this.container.addChild(button);
    return button;
  }
  destroy(): void {
    this.disposed = true;
    coop.onChange = null;
    this.input.remove();
    this.container.destroy({ children: true });
  }
}
