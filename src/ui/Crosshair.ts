import { Graphics } from 'pixi.js';
import { pointer } from '../systems/InputSystem';

const SIZE = 15;
const HALF = Math.floor(SIZE / 2);
/** Pixels either side of centre left blank, as in the Java crosshair. */
const GAP = 1;

/** Replaces the OS pointer with the original's white crosshair while playing. */
export class Crosshair {
  readonly graphics = new Graphics();

  constructor() {
    const g = this.graphics;
    g.rect(-HALF, 0, HALF - GAP, 1).fill(0xffffff);
    g.rect(GAP + 1, 0, HALF - GAP, 1).fill(0xffffff);
    g.rect(0, -HALF, 1, HALF - GAP).fill(0xffffff);
    g.rect(0, GAP + 1, 1, HALF - GAP).fill(0xffffff);
  }

  update(): void {
    const p = pointer();
    this.graphics.x = Math.round(p.x);
    this.graphics.y = Math.round(p.y);
  }

  destroy(): void {
    this.graphics.destroy();
  }
}
