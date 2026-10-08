import { Container, Sprite } from 'pixi.js';
import type { Scene } from '../game/SceneManager';
import type { SceneManager } from '../game/SceneManager';
import { PixelButton } from '../ui/PixelButton';
import { makeText } from '../ui/PixelText';
import { getTexture } from '../assets/AssetLoader';

const GW = 320;
const GH = 240;

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

    const menuItems: { label: string; action: () => void }[] = [
      { label: 'Play',        action: () => manager.goto('level_select') },
      { label: 'How To Play', action: () => {/* TODO: show howtoplay overlay */} },
      { label: 'Exit',        action: () => { /* can't exit browser, just back to title */ } },
    ];

    const startY = 140;
    menuItems.forEach(({ label, action }, i) => {
      const btn = new PixelButton(label, 128, 20);
      btn.x = (GW - 128) / 2;
      btn.y = startY + i * 28;
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
