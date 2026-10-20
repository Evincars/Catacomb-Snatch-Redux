/** Which row or column of a directional sprite sheet a direction picks. Ported from the Java original. */

/**
 * 8-way sprite index for a direction vector, matching the Java original:
 * `(8 + (int)((atan2(y,x) + PI*1.625) / PI * 4)) & 7`.
 */
export function angleTo8(dx: number, dy: number): number {
  const angle = Math.atan2(dy, dx) + Math.PI * 1.625;
  return (8 + Math.trunc((angle / Math.PI) * 4)) & 7;
}

/**
 * Player sprite row for an aim vector. Ported from Java's Player.updateFacing:
 * `(int)(atan2(-x, y) * 8 / (2*PI) + 8.5) & 7`.
 */
export function aimToFacing8(ax: number, ay: number): number {
  return Math.trunc((Math.atan2(-ax, ay) * 8) / (Math.PI * 2) + 8.5) & 7;
}
