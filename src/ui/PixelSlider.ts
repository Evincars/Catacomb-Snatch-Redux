import { Container, Graphics } from 'pixi.js';
import type { Text } from 'pixi.js';
import { makeText } from './PixelText';

const HEIGHT = 22;
const KNOB = 10;

/** Horizontal 0..1 slider rendered as a filled bar with a percentage label. */
export class PixelSlider extends Container {
  private bar = new Graphics();
  private text: Text;
  private _value: number;

  onChange: ((value: number) => void) | null = null;

  // `width` and `label` are taken by Container, hence the prefixed names.
  constructor(private caption: string, value: number, private barWidth = 220) {
    super();
    this._value = value;

    this.addChild(this.bar);
    this.text = makeText('', 0xffffff, 11);
    this.text.x = 8;
    this.text.y = HEIGHT / 2 - 7;
    this.addChild(this.text);

    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointerdown', (e) => this.setFromPointer(e.global.x));
    this.on('globalpointermove', (e) => {
      // Only drag while the button is held over this control.
      if (e.buttons & 1) this.setFromPointer(e.global.x);
    });

    this.draw();
  }

  get value(): number {
    return this._value;
  }

  private setFromPointer(globalX: number): void {
    const local = this.toLocal({ x: globalX, y: 0 });
    const next = Math.max(0, Math.min(1, local.x / this.barWidth));
    if (Math.abs(next - this._value) < 0.005) return;
    this._value = next;
    this.draw();
    this.onChange?.(this._value);
  }

  private draw(): void {
    this.bar.clear();
    this.bar.rect(0, 0, this.barWidth, HEIGHT).fill(0x000000);
    this.bar.rect(1, 1, this.barWidth - 2, HEIGHT - 2).fill(0x1a0f00);
    this.bar.rect(1, 1, (this.barWidth - 2) * this._value, HEIGHT - 2).fill(0x6a3a10);

    const knobX = Math.min(this.barWidth - KNOB - 1, Math.max(1, this._value * (this.barWidth - KNOB)));
    this.bar.rect(knobX, 1, KNOB, HEIGHT - 2).fill(0xffcc44);
    this.bar.rect(0, 0, this.barWidth, HEIGHT).stroke({ color: 0x9a5a20, width: 1 });

    this.text.text = `${this.caption}: ${Math.round(this._value * 100)}%`;
  }
}
