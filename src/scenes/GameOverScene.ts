import { Container, Sprite, Graphics } from 'pixi.js';
import { GAME_WIDTH, GAME_HEIGHT } from '../render/Camera';
import type { Scene, SceneManager } from '../game/SceneManager';
import { PixelButton } from '../ui/PixelButton';
import { makeText, makeTitle } from '../ui/PixelText';
import type { PixelLabel } from '../ui/PixelText';
import { getTexture } from '../assets/AssetLoader';
import { characterName, gameState } from '../game/GameState';
import { coop } from '../network/CoopSession';
import { sound } from '../audio/SoundPlayer';

const GW = GAME_WIDTH;
const GH = GAME_HEIGHT;
const BTN_W = 200;
const BTN_H = 28;
/** Vertical distance between stacked buttons. */
const BTN_STEP = 42;

export class GameOverScene implements Scene {
  container: Container;
  private manager: SceneManager;
  private status: PixelLabel;
  private readonly onRoomChange = (): void => this.showRoom();
  private readonly onLobby = (): void => this.manager.goto('coop_join');
  private replay: PixelButton | null = null;

  constructor(manager: SceneManager) {
    this.manager = manager;
    this.container = new Container();

    const backdrop = new Graphics();
    backdrop.rect(0, 0, GW, GH).fill(0x0a0a0a);
    this.container.addChild(backdrop);

    const bg = new Sprite(getTexture('game_over'));
    bg.width = GW;
    bg.height = GH;
    this.container.addChild(bg);

    sound.startEndMusic();

    const title = makeTitle('Game Over');
    title.x = GW / 2;
    title.y = 100;
    this.container.addChild(title);

    const winner = makeText(this.winnerLabel(), 0xffdd44, 12, 'center');
    winner.x = GW / 2;
    winner.y = 150;
    this.container.addChild(winner);

    this.status = makeText('', 0xffffff, 8, 'center');
    this.status.x = GW / 2;
    this.status.y = 178;
    this.container.addChild(this.status);

    if (coop.role === 'host' && coop.inRoom) this.addHostButtons();
    else if (coop.role === 'guest' && coop.inRoom) this.addGuestButtons();
    else this.addSoloButtons();
  }

  private winnerLabel(): string {
    const ai = gameState.opponent === 'ai';
    if (gameState.winningTeam === 1) return ai ? 'You Win!' : 'Player 1 Wins!';
    if (gameState.winningTeam === 2) return ai ? `${characterName(gameState.aiCharacter)} Wins!` : 'Player 2 Wins!';
    return 'No Winner';
  }

  /** A button centred across the screen, `row` steps up from the bottom one. */
  private button(text: string, row: number, action: () => void): PixelButton {
    const button = new PixelButton(text, BTN_W, BTN_H);
    button.x = (GW - BTN_W) / 2;
    button.y = GH - 70 - row * BTN_STEP;
    button.onPress = action;
    this.container.addChild(button);
    return button;
  }

  private addSoloButtons(): void {
    this.button('Play Again', 1, () => this.playAgain());
    this.button('Main Menu', 0, () => this.manager.goto('title'));
  }

  /** Alone, straight back in; after a multiplayer room fell apart, a fresh room is opened or joined. */
  private playAgain(): void {
    const role = coop.role;
    if (!role) {
      this.manager.goto('in_game');
      return;
    }
    coop.close();
    this.manager.goto(role === 'host' ? 'coop_host' : 'coop_join');
  }

  /**
   * The host keeps the room: the same map again at once, or back to the lobby to pick another map and other
   * settings. Either way the guests follow without a new invite.
   */
  private addHostButtons(): void {
    this.replay = this.button('Play Again', 2, () => {
      if (!coop.connected) return;
      coop.reopen();
      this.manager.goto('in_game');
    });
    this.button('New map / settings', 1, () => {
      coop.reopen();
      this.manager.goto('coop_host');
    });
    this.button('Main Menu', 0, () => this.manager.goto('title'));
    coop.onChange = this.onRoomChange;
    this.showRoom();
  }

  /** A guest waits in the room for the host's next match, or leaves it. */
  private addGuestButtons(): void {
    this.button('Leave room', 0, () => this.manager.goto('title'));
    coop.onChange = this.onRoomChange;
    coop.onLobby = this.onLobby;
    this.showRoom();
  }

  private showRoom(): void {
    const players = coop.roster.length;
    if (coop.role === 'host') {
      this.status.text = coop.connected
        ? `${players} players still in the room - no new invite needed`
        : 'Everyone else left. Pick a new map to invite players again.';
      this.replay?.setEnabled(coop.connected);
      return;
    }
    this.status.text = coop.connected ? 'Waiting for the host to start the next match' : coop.status;
  }

  destroy(): void {
    if (coop.onChange === this.onRoomChange) coop.onChange = null;
    if (coop.onLobby === this.onLobby) coop.onLobby = null;
    this.container.destroy({ children: true });
  }
}
