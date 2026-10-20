import { Rectangle } from 'pixi.js';

/** An axis-aligned box centred on (cx, cy) with half-extents (rx, ry), as a Pixi Rectangle; written into `out` when given. */
export function boxAround(cx: number, cy: number, rx: number, ry: number, out = new Rectangle()): Rectangle {
  out.x = cx - rx;
  out.y = cy - ry;
  out.width = rx * 2;
  out.height = ry * 2;
  return out;
}

/** A box spanning two corners, as a Pixi Rectangle; written into `out` when given. */
export function boxBetween(x0: number, y0: number, x1: number, y1: number, out = new Rectangle()): Rectangle {
  out.x = x0;
  out.y = y0;
  out.width = x1 - x0;
  out.height = y1 - y0;
  return out;
}

/**
 * Object pool of Rectangles for collision work done every tick. `reset()` starts a pass; the boxes handed
 * out after it stay valid until the next reset. Once the pool has grown to the busiest pass it allocates
 * nothing at all.
 */
export class BoxPool {
  private readonly boxes: Rectangle[] = [];
  private used = 0;

  reset(): void {
    this.used = 0;
  }

  around(cx: number, cy: number, rx: number, ry: number): Rectangle {
    return boxAround(cx, cy, rx, ry, this.take());
  }

  between(x0: number, y0: number, x1: number, y1: number): Rectangle {
    return boxBetween(x0, y0, x1, y1, this.take());
  }

  private take(): Rectangle {
    if (this.used === this.boxes.length) this.boxes.push(new Rectangle());
    return this.boxes[this.used++];
  }
}
