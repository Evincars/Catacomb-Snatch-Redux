export class Mth {
  static clamp(value: number, min: number, max: number): number {
    return Math.max(min, Math.min(max, value));
  }

  static lerp(a: number, b: number, t: number): number {
    return a + (b - a) * t;
  }

  static sign(x: number): number {
    return x > 0 ? 1 : x < 0 ? -1 : 0;
  }

  static angleToFacing(ax: number, ay: number): number {
    // Returns Facing enum value (0=N,1=E,2=S,3=W)
    const angle = Math.atan2(ay, ax);
    const deg = ((angle * 180) / Math.PI + 360) % 360;
    if (deg >= 315 || deg < 45) return 1;  // East
    if (deg < 135) return 2;               // South
    if (deg < 225) return 3;               // West
    return 0;                              // North
  }

  static facingToVector(facing: number): { x: number; y: number } {
    switch (facing) {
      case 0: return { x: 0, y: -1 };  // North
      case 1: return { x: 1, y: 0 };   // East
      case 2: return { x: 0, y: 1 };   // South
      case 3: return { x: -1, y: 0 };  // West
      default: return { x: 0, y: 0 };
    }
  }
}
