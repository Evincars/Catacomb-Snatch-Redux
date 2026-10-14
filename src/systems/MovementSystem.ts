import { world } from '../world';
import type { Level } from '../level/Level';
import { BB } from '../math/BB';
import { Mth } from '../math/Mth';
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

/** Solid things a player walks around: buildings, nests and carriages, unless they are being carried. */
function structureBBs(x: number, y: number, rx: number, ry: number, except?: object): BB[] {
  const area = BB.fromCenter(x, y, rx, ry).grow(32);
  const out: BB[] = [];
  for (const e of world.with('position', 'radius', 'blocking')) {
    if (!e.building && !e.spawner && !e.railDroid) continue;
    if (e.carriedBy !== undefined || e.removed || e === except) continue;
    const bb = BB.fromCenter(e.position!.x, e.position!.y, e.radius!.x, e.radius!.y);
    if (bb.intersects(area)) out.push(bb);
  }
  return out;
}

/** Speed lost per tick by a sliding building, and the speed below which it settles. */
export const SLIDE_DRAG = 0.8;
const SLIDE_REST = 0.05;

/**
 * A building just put down glides to a stop. It stops short of walls, other
 * structures and anything it may not stand on, such as track or holes.
 */
export function updateSlides(level: Level): void {
  for (const entity of world.with('position', 'radius', 'slide')) {
    const slide = entity.slide!;
    const pos = entity.position!;
    const r = entity.radius!;
    const from = { x: pos.x, y: pos.y };
    const bbs = level.getClipBBs(pos.x, pos.y, r.x, r.y);
    bbs.push(...structureBBs(pos.x, pos.y, r.x, r.y, entity));
    move(pos, r, slide.x, slide.y, bbs, true);
    if (!level.getTileAt(pos.x, pos.y)?.buildable) {
      pos.x = from.x;
      pos.y = from.y;
      slide.x = slide.y = 0;
    }
    slide.x *= SLIDE_DRAG;
    slide.y *= SLIDE_DRAG;
    if (Math.abs(slide.x) < SLIDE_REST && Math.abs(slide.y) < SLIDE_REST) world.removeComponent(entity, 'slide');
  }
}

export function updateMovement(level: Level, _dt: number): void {
  // Bullets are excluded — BulletSystem moves them at constant speed.
  const allPhysical = world.with('position', 'velocity', 'radius').without('bullet');

  for (const entity of allPhysical) {
    const { position, velocity, radius } = entity;
    if (!position || !velocity || !radius) continue;

    const bump = entity.bump;
    const frozen = (entity.freezeTime ?? 0) > 0;

    // While frozen the entity is only carried by knockback, never by its own
    // input — this is what pushes a player out of a mob instead of locking them.
    let xa = frozen ? 0 : velocity.x;
    let ya = frozen ? 0 : velocity.y;
    if (bump) {
      xa += bump.x;
      ya += bump.y;
    }

    const bbs = level.getClipBBs(position.x, position.y, radius.x, radius.y);
    if (entity.playerInput) bbs.push(...structureBBs(position.x, position.y, radius.x, radius.y));
    move(position, radius, xa, ya, bbs, entity.physicsSlide !== undefined);

    const friction = entity.friction ?? 0.4;
    velocity.x *= friction;
    velocity.y *= friction;
    if (Math.abs(velocity.x) < 0.01) velocity.x = 0;
    if (Math.abs(velocity.y) < 0.01) velocity.y = 0;

    if (bump) {
      bump.x *= 0.8;
      bump.y *= 0.8;
      if (Math.abs(bump.x) < 0.01) bump.x = 0;
      if (Math.abs(bump.y) < 0.01) bump.y = 0;
    }
  }

  // Player-specific movement from input
  const players = world.with('position', 'playerInput', 'playerStats', 'health', 'velocity');
  for (const entity of players) {
    const { playerInput: pi, velocity: vel, position: pos, playerStats } = entity;
    if (!pi || !vel || !pos || !playerStats) continue;

    if ((entity.freezeTime ?? 0) > 0) continue;

    let spd = entity.speed ?? 1.0;

    // Java's sprint: holding the key burns up to maxSprint ticks at 1.5x speed (1.0x
    // while carrying), then locks out until the key is released. The meter refills
    // one tick at a time whenever the player is not sprinting.
    const moving = pi.up || pi.down || pi.left || pi.right;
    const sprintHeld = pi.sprint;
    if (!sprintHeld) playerStats.sprintLocked = false;

    playerStats.sprinting = false;
    if (moving && sprintHeld && !playerStats.sprintLocked && playerStats.sprint < playerStats.maxSprint) {
      playerStats.sprinting = true;
      playerStats.sprint++;
      spd *= entity.carryingId !== undefined ? 1.0 : 1.5;
    } else {
      if (moving && sprintHeld) playerStats.sprintLocked = true;
      if (playerStats.sprint > 0) playerStats.sprint--;
    }

    if (pi.up)    vel.y -= spd;
    if (pi.down)  vel.y += spd;
    if (pi.left)  vel.x -= spd;
    if (pi.right) vel.x += spd;

    entity.walkTime = moving ? (entity.walkTime ?? 0) + 1 : 0;

    // The directional fire keys aim without the cursor, which is left alone.
    if (pi.keyAim && entity.aimVector) {
      entity.aimVector.x = pi.keyAim.x;
      entity.aimVector.y = pi.keyAim.y;
    } else if (pi.mouseAiming && entity.aimVector) {
      // Aim at the cursor, converting from screen space to world space.
      const target = entity.aimWorld ?? screenToWorld(pi.mouseX, pi.mouseY);
      const dx = target.x - pos.x;
      const dy = target.y - pos.y;
      const len = Math.hypot(dx, dy);
      if (len > 0) {
        entity.aimVector.x = dx / len;
        entity.aimVector.y = dy / len;
      }
    }

    // The player sheet has 8 directional rows, so aim maps to one of eight.
    const aim = entity.aimVector;
    if (aim && (aim.x !== 0 || aim.y !== 0)) {
      entity.facing = Mth.aimToFacing8(aim.x, aim.y);
    } else if (moving) {
      entity.facing = Mth.aimToFacing8(vel.x, vel.y);
    }
  }
}
