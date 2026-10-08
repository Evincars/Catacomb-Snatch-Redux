export class Vec2 {
  x: number;
  y: number;

  constructor(x = 0, y = 0) {
    this.x = x;
    this.y = y;
  }

  set(x: number, y: number): this {
    this.x = x;
    this.y = y;
    return this;
  }

  copy(v: Vec2): this {
    this.x = v.x;
    this.y = v.y;
    return this;
  }

  clone(): Vec2 {
    return new Vec2(this.x, this.y);
  }

  add(v: Vec2): Vec2 {
    return new Vec2(this.x + v.x, this.y + v.y);
  }

  sub(v: Vec2): Vec2 {
    return new Vec2(this.x - v.x, this.y - v.y);
  }

  scale(s: number): Vec2 {
    return new Vec2(this.x * s, this.y * s);
  }

  mul(v: Vec2): Vec2 {
    return new Vec2(this.x * v.x, this.y * v.y);
  }

  dot(v: Vec2): number {
    return this.x * v.x + this.y * v.y;
  }

  addSelf(x: number, y: number): this {
    this.x += x;
    this.y += y;
    return this;
  }

  scaleSelf(s: number): this {
    this.x *= s;
    this.y *= s;
    return this;
  }

  lengthSqr(): number {
    return this.x * this.x + this.y * this.y;
  }

  length(): number {
    return Math.sqrt(this.lengthSqr());
  }

  normalizeSelf(): this {
    const len = this.length();
    if (len > 0) {
      this.x /= len;
      this.y /= len;
    }
    return this;
  }

  normal(): Vec2 {
    return this.clone().normalizeSelf();
  }

  rescaleSelf(newLen: number): this {
    const len = this.length();
    if (len > 0) {
      this.x = (this.x / len) * newLen;
      this.y = (this.y / len) * newLen;
    }
    return this;
  }

  distSqr(v: Vec2): number {
    const dx = this.x - v.x;
    const dy = this.y - v.y;
    return dx * dx + dy * dy;
  }

  dist(v: Vec2): number {
    return Math.sqrt(this.distSqr(v));
  }

  floor(): Vec2 {
    return new Vec2(Math.floor(this.x), Math.floor(this.y));
  }

  equals(v: Vec2): boolean {
    return this.x === v.x && this.y === v.y;
  }

  toString(): string {
    return `[${this.x}, ${this.y}]`;
  }
}
