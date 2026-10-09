import { Container, Graphics } from 'pixi.js';
import { makeText } from './PixelText';

const BOX = 22;

/** Retro checkbox: a bordered square plus a label, matching the options screen. */
export class PixelCheckbox extends Container {
  private box = new Graphics();
  private _checked: boolean;

  onToggle: ((checked: boolean) => void) | null = null;

  constructor(label: string, checked: boolean) {
    super();
    this._checked = checked;

    this.addChild(this.box);

    const text = makeText(label, 0xffffff, 11);
    text.x = BOX + 10;
    text.y = BOX / 2 - 7;
    this.addChild(text);

    this.eventMode = 'static';
    this.cursor = 'pointer';
    this.on('pointertap', () => {
      this._checked = !this._checked;
      this.draw();
      this.onToggle?.(this._checked);
    });

    this.draw();
  }

  get checked(): boolean {
    return this._checked;
  }

  private draw(): void {
    this.box.clear();
    this.box.rect(0, 0, BOX, BOX).fill(0x000000);
    this.box.rect(1, 1, BOX - 2, BOX - 2).fill(0x3a1a00);
    this.box.moveTo(1, BOX - 2).lineTo(1, 1).lineTo(BOX - 2, 1).stroke({ color: 0x9a5a20, width: 1 });
    if (this._checked) {
      this.box.rect(5, 5, BOX - 10, BOX - 10).fill(0xffcc44);
    }
  }
}
