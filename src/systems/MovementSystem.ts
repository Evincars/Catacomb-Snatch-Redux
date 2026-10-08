import { q, world, Facing } from '../world';
import type { Entity } from '../world';
import type { Level } from '../level/Level';
import { BB } from '../math/BB';
import { TILE_WIDTH, TILE_HEIGHT } from '../level/TileType';

const EPSILON = 0.01;

function partMove(
  pos: { x: number; y: number },
  radius: { x: number; y: number },
  bbs: BB[],
  xa: number,
  ya: number,
  slide: boolean,
): boolean {
  const from = BB.fromCenter(pos.x, pos.y, radius.x, radius.y);
  let closest: BB | null = null;

  for (const to of bbs) {
    if (from.intersects(to)) continue;

    if (ya === 0) {
      if (to.y0 >= from.y1 || to.y1 <= from.y0) continue;
      if (xa > 0) {
        const d = to.x0 - from.x1;
        if (d >= 0 && xa > d) { closest = to; xa = Math.max(0, d - EPSILON); }
      } else if (xa < 0) {
        const d = to.x1 - from.x0;
        if (d <= 0 && xa < d) { closest = to; xa = Math.min(0, d + EPSILON); }
      }
    }

    if (xa === 0) {
      if (to.x0 >= from.x1 || to.x1 <= from.x0) continue;
      if (ya > 0) {
        const d = to.y0 - from.y1;
        if (d >= 0 && ya > d) { closest = to; ya = Math.max(0, d - EPSILON); }
      } else if (ya < 0) {
        const d = to.y1 - from.y0;
        if (d <= 0 && ya < d) { closest = to; ya = Math.min(0, d + EPSILON); }
      }
    }
  }

  if (xa !== 0 || ya !== 0) {
    pos.x += xa;
    pos.y += ya;
    return true;
  }
  return false;
}

export function move(
  pos: { x: number; y: number },
  radius: { x: number; y: number },
  xa: number,
  ya: number,
  bbs: BB[],
  physicsSlide = true,
): boolean {
  let moved = false;
  if (physicsSlide || xa === 0 || ya === 0) {
    moved = partMove(pos, radius, bbs, xa, 0, physicsSlide) || moved;
    moved = partMove(pos, radius, bbs, 0, ya, physicsSlide) || moved;
  } else {
    moved = partMove(pos, radius, bbs, xa, 0, physicsSlide) && moved;
    moved = partMove(pos, radius, bbs, 0, ya, physicsSlide) && moved;
  }
  return moved;
}

export function updateMovement(level: Level, _dt: number): void {
  const allPhysical = world.with('position', 'velocity', 'radius');

  for (const entity of allPhysical) {
    const { position, velocity, radius } = entity;
    if (!position || !velocity || !radius) continue;

    const bbs = level.getClipBBs(position.x, position.y, radius.x, radius.y);
    move(position, radius, velocity.x, velocity.y, bbs, entity.physicsSlide !== undefined);

    // Dampen velocity slightly
    velocity.x *= 0.85;
    velocity.y *= 0.85;
    if (Math.abs(velocity.x) < 0.01) velocity.x = 0;
    if (Math.abs(velocity.y) < 0.01) velocity.y = 0;
  }

  // Player-specific movement from input
  const players = world.with('position', 'playerInput', 'playerStats', 'health', 'velocity');
  for (const entity of players) {
    const { playerInput: pi, velocity: vel, position: pos, playerStats } = entity;
    if (!pi || !vel || !pos || !playerStats) continue;

    const spd = entity.speed ?? 1.0;

    if (pi.up)    vel.y -= spd;
    if (pi.down)  vel.y += spd;
    if (pi.left)  vel.x -= spd;
    if (pi.right) vel.x += spd;

    // Update facing from aim vector or movement direction
    if (pi.mouseAiming && entity.aimVector) {
      const dx = pi.mouseX - pos.x;
      const dy = pi.mouseY - pos.y;
      const len = Math.sqrt(dx * dx + dy * dy);
      if (len > 0) {
        entity.aimVector.x = dx / len;
        entity.aimVector.y = dy / len;
      }
    }
  }
}
