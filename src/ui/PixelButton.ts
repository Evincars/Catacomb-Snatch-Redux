import { Container, NineSliceSprite } from 'pixi.js';
import { frameTexture } from '../render/Sheets';
import { PixelLabel } from './PixelText';

const BUTTON_W = 128;
const BUTTON_H = 24;
const NORMAL_COLOR = 0xfff0d0;
const HOVER_COLOR = 0xffd860;
/** Border of the stone-and-copper frame in button.png, kept unstretched. */
const BORDER = 8;
/** Frame rows in button.png. */
const STATE_NORMAL = 0;
const STATE_HOVER = 1;
const STATE_DISABLED = 2;

/** A button drawn from the original's three-state button art. */
export class PixelButton extends Container {
  private bg: NineSliceSprite;
  private btnLabel: PixelLabel;
  private readonly w: number;
  private readonly h: number;
  private _hovered = false;
  private _enabled = true;

  onPress: (() => void) | null = null;

  constructor(text: string, width = BUTTON_W, height = BUTTON_H) {
    super();
    this.w = width;
    this.h = height;

    this.bg = new NineSliceSprite({
      texture: frameTexture('button', 0, STATE_NORMAL),
      leftWidth: BORDER,
      topHeight: BORDER,
      rightWidth: BORDER,
      bottomHeight: BORDER,
      width,
      height,
    });
    this.addChild(this.bg);

    this.btnLabel = new PixelLabel(text.toUpperCase(), {
      color: NORMAL_COLOR,
      scale: height >= 30 ? 2 : 1,
      align: 'center',
      shadow: true,
    });
    this.addChild(this.btnLabel);
    this.positionLabel();

    this.eventMode = 'static';
    this.cursor = 'pointer';

    this.on('pointerover', () => {
      this._hovered = true;
      this.refresh();
    });
    this.on('pointerout', () => {
      this._hovered = false;
      this.refresh();
    });
    this.on('pointertap', () => {
      if (this._enabled && this.onPress) this.onPress();
    });
  }

  private positionLabel(): void {
    this.btnLabel.x = Math.round(this.w / 2);
    this.btnLabel.y = Math.round((this.h - this.btnLabel.textHeight + 1) / 2);
  }

  private refresh(): void {
    const state = !this._enabled ? STATE_DISABLED : this._hovered ? STATE_HOVER : STATE_NORMAL;
    this.bg.texture = frameTexture('button', 0, state);
    this.btnLabel.fill = this._hovered && this._enabled ? HOVER_COLOR : NORMAL_COLOR;
  }

  setEnabled(enabled: boolean): void {
    this._enabled = enabled;
    this.refresh();
  }

  setText(text: string): void {
    this.btnLabel.text = text.toUpperCase();
    this.positionLabel();
  }
}
