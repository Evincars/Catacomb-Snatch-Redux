import { world } from '../world';
import type { Level } from '../level/Level';
import { BB } from '../math/BB';
import { Mth } from '../math/Mth';
import { isKeyDown } from './InputSystem';
import { screenToWorld } from '../render/Camera';

const angleToFacing = (x: number, y: number) => Mth.angleToFacing(x, y);

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
  // Bullets are excluded — BulletSystem moves them at constant speed.
  const allPhysical = world.with('position', 'velocity', 'radius').without('bullet');

  for (const entity of allPhysical) {
    const { position, velocity, radius } = entity;
    if (!position || !velocity || !radius) continue;

    // Knockback from a hit is folded into this frame's motion.
    const bump = entity.bump;
    let xa = velocity.x;
    let ya = velocity.y;
    if (bump) {
      xa += bump.x;
      ya += bump.y;
      bump.x *= 0.8;
      bump.y *= 0.8;
      if (Math.abs(bump.x) < 0.01) bump.x = 0;
      if (Math.abs(bump.y) < 0.01) bump.y = 0;
    }

    const bbs = level.getClipBBs(position.x, position.y, radius.x, radius.y);
    move(position, radius, xa, ya, bbs, entity.physicsSlide !== undefined);

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

    if ((entity.freezeTime ?? 0) > 0) continue;

    let spd = entity.speed ?? 1.0;

    // Holding shift drains the sprint meter for extra speed; it refills when idle.
    const sprinting = isKeyDown('ShiftLeft') && playerStats.sprint > 0 && (pi.up || pi.down || pi.left || pi.right);
    if (sprinting) {
      spd *= 1.6;
      playerStats.sprint = Math.max(0, playerStats.sprint - 1);
    } else if (playerStats.sprint < playerStats.maxSprint) {
      playerStats.sprint = Math.min(playerStats.maxSprint, playerStats.sprint + 0.35);
    }

    if (pi.up)    vel.y -= spd;
    if (pi.down)  vel.y += spd;
    if (pi.left)  vel.x -= spd;
    if (pi.right) vel.x += spd;

    const moving = pi.up || pi.down || pi.left || pi.right;
    entity.walkTime = moving ? (entity.walkTime ?? 0) + 1 : 0;

    // Aim at the cursor, converting from screen space to world space.
    if (pi.mouseAiming && entity.aimVector) {
      const target = screenToWorld(pi.mouseX, pi.mouseY);
      const dx = target.x - pos.x;
      const dy = target.y - pos.y;
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        entity.aimVector.x = dx / len;
        entity.aimVector.y = dy / len;
      }
    }

    // Face the aim direction, falling back to the movement direction.
    const aim = entity.aimVector;
    if (aim && (aim.x !== 0 || aim.y !== 0)) {
      entity.facing = angleToFacing(aim.x, aim.y);
    } else if (moving) {
      entity.facing = angleToFacing(vel.x, vel.y);
    }
  }
}
