export class BB {
  x0: number;
  y0: number;
  x1: number;
  y1: number;

  constructor(x0: number, y0: number, x1: number, y1: number) {
    this.x0 = x0;
    this.y0 = y0;
    this.x1 = x1;
    this.y1 = y1;
  }

  static fromCenter(cx: number, cy: number, rx: number, ry: number): BB {
    return new BB(cx - rx, cy - ry, cx + rx, cy + ry);
  }

  intersects(other: BB): boolean;
  intersects(x0: number, y0: number, x1: number, y1: number): boolean;
  intersects(a: BB | number, b?: number, c?: number, d?: number): boolean {
    if (a instanceof BB) {
      return !(a.x0 >= this.x1 || a.y0 >= this.y1 || a.x1 <= this.x0 || a.y1 <= this.y0);
    }
    return !(a >= this.x1 || b! >= this.y1 || c! <= this.x0 || d! <= this.y0);
  }

  grow(s: number): BB {
    return new BB(this.x0 - s, this.y0 - s, this.x1 + s, this.y1 + s);
  }

  width(): number { return this.x1 - this.x0; }
  height(): number { return this.y1 - this.y0; }
}
