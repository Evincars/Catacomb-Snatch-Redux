import { Container, Rectangle, Sprite } from 'pixi.js';
import { GAME_WIDTH, GAME_HEIGHT } from '../render/Camera';
import type { Scene } from '../game/SceneManager';
import type { SceneManager } from '../game/SceneManager';
import { PixelButton } from '../ui/PixelButton';
import { makeText } from '../ui/PixelText';
import { getTexture } from '../assets/AssetLoader';
import { gameState } from '../game/GameState';
import { sound } from '../audio/SoundPlayer';
import { coop } from '../network/CoopSession';
import { savedRun } from '../game/SaveStore';

const GW = GAME_WIDTH;
const GH = GAME_HEIGHT;

export class TitleScene implements Scene {
  container: Container;
  private buttons: PixelButton[] = [];

  constructor(manager: SceneManager) {
    coop.close();
    gameState.multiplayerMode = 'companion';
    savedRun.pending = null;
    const url = new URL(location.href);
    if (url.searchParams.has('join')) {
      url.searchParams.delete('join');
      history.replaceState(null, '', url.href);
    }
    this.container = new Container();

    // Title screen background
    const bg = new Sprite(getTexture('titlescreen'));
    bg.width = GW;
    bg.height = GH;
    this.container.addChild(bg);

    sound.startTitleMusic();

    const menuItems: { label: string; action: () => void }[] = [
      { label: 'Start',       action: () => manager.goto('level_select') },
      { label: 'Host multiplayer', action: () => manager.goto('coop_host') },
      { label: 'Join multiplayer', action: () => manager.goto('coop_join') },
      { label: 'Saved games', action: () => manager.goto('saves') },
      { label: 'How To Play', action: () => manager.goto('how_to_play') },
      { label: 'Options',     action: () => manager.goto('options') },
    ];

    const BTN_W = 248;
    const startY = 174;
    menuItems.forEach(({ label, action }, i) => {
      const btn = new PixelButton(label, BTN_W, 24);
      btn.x = (GW - BTN_W) / 2;
      btn.y = startY + i * 27;
      btn.onPress = action;
      this.buttons.push(btn);
      this.container.addChild(btn);
    });

    const ver = makeText(`v${__APP_VERSION__}`, 0xaaaaaa, 8, 'right');
    ver.x = GW - 4;
    ver.y = GH - 12;
    this.container.addChild(ver);

    const author = makeText('by Evincars', 0xffcc66, 8, 'left');
    author.x = 4;
    author.y = GH - 12;
    author.eventMode = 'static';
    author.cursor = 'pointer';
    author.hitArea = new Rectangle(-3, -3, author.width + 6, 14);
    author.on('pointerover', () => { author.alpha = 0.7; });
    author.on('pointerout', () => { author.alpha = 1; });
    author.on('pointertap', () => { window.open('https://github.com/Evincars', '_blank', 'noopener'); });
    this.container.addChild(author);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
