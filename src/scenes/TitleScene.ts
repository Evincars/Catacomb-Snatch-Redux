import { Container, Sprite } from 'pixi.js';
import { GAME_WIDTH, GAME_HEIGHT } from '../render/Camera';
import type { Scene } from '../game/SceneManager';
import type { SceneManager } from '../game/SceneManager';
import { PixelButton } from '../ui/PixelButton';
import { makeText } from '../ui/PixelText';
import { getTexture } from '../assets/AssetLoader';
import { sound } from '../audio/SoundPlayer';

const GW = GAME_WIDTH;
const GH = GAME_HEIGHT;

export class TitleScene implements Scene {
  container: Container;
  private buttons: PixelButton[] = [];

  constructor(manager: SceneManager) {
    this.container = new Container();

    // Title screen background
    const bg = new Sprite(getTexture('titlescreen'));
    bg.width = GW;
    bg.height = GH;
    this.container.addChild(bg);

    sound.startTitleMusic();

    const menuItems: { label: string; action: () => void }[] = [
      { label: 'Start',       action: () => manager.goto('level_select') },
      { label: 'How To Play', action: () => manager.goto('how_to_play') },
      { label: 'Options',     action: () => manager.goto('options') },
    ];

    const BTN_W = 248;
    const startY = 196;
    menuItems.forEach(({ label, action }, i) => {
      const btn = new PixelButton(label, BTN_W, 30);
      btn.x = (GW - BTN_W) / 2;
      btn.y = startY + i * 40;
      btn.onPress = action;
      this.buttons.push(btn);
      this.container.addChild(btn);
    });

    // Version label
    const ver = makeText('v0.1.0', 0xaaaaaa, 8, 'right');
    ver.x = GW - 4;
    ver.y = GH - 12;
    this.container.addChild(ver);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
