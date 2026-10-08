import { Container, Graphics, Text, TextStyle, NineSliceSprite, Texture } from 'pixi.js';
import { getTexture } from '../assets/AssetLoader';

const BUTTON_W = 128;
const BUTTON_H = 24;
const HOVER_COLOR = 0xffe0a0;
const NORMAL_COLOR = 0xffffff;

export class PixelButton extends Container {
  private bg: Graphics;
  private btnLabel: Text;
  private _hovered = false;
  private _enabled = true;

  onPress: (() => void) | null = null;

  constructor(text: string, width = BUTTON_W, height = BUTTON_H) {
    super();

    this.bg = new Graphics();
    this.addChild(this.bg);

    this.btnLabel = new Text({
      text,
      style: new TextStyle({
        fontFamily: 'monospace',
        fontSize: 10,
        fill: NORMAL_COLOR,
        align: 'center',
      }),
    });
    this.btnLabel.anchor.set(0.5, 0.5);
    this.btnLabel.x = width / 2;
    this.btnLabel.y = height / 2;
    this.addChild(this.btnLabel);

    this.draw(width, height, false);

    this.eventMode = 'static';
    this.cursor = 'pointer';

    this.on('pointerover', () => {
      this._hovered = true;
      this.draw(width, height, true);
      this.btnLabel.style.fill = HOVER_COLOR;
    });
    this.on('pointerout', () => {
      this._hovered = false;
      this.draw(width, height, false);
      this.btnLabel.style.fill = NORMAL_COLOR;
    });
    this.on('pointertap', () => {
      if (this._enabled && this.onPress) this.onPress();
    });
  }

  private draw(w: number, h: number, hovered: boolean): void {
    this.bg.clear();
    // Outer frame
    this.bg.rect(0, 0, w, h).fill(0x000000);
    // Inner fill
    this.bg.rect(1, 1, w - 2, h - 2).fill(hovered ? 0x5a3010 : 0x3a1a00);
    // Top/left highlight
    this.bg.moveTo(1, h - 2).lineTo(1, 1).lineTo(w - 2, 1).stroke({ color: hovered ? 0xffe090 : 0x9a5a20, width: 1 });
    // Bottom/right shadow
    this.bg.moveTo(2, h - 2).lineTo(w - 2, h - 2).lineTo(w - 2, 2).stroke({ color: 0x1a0800, width: 1 });
  }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    this.alpha = enabled ? 1 : 0.4;
  }

  setText(text: string): void {
    this.btnLabel.text = text;
  }
}
