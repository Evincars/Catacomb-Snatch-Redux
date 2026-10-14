import { world } from '../world';
import type { Level } from '../level/Level';
import { setVisualFrame } from '../render/AnimatedVisual';

/** Java BulletRay: +20% speed, +5 ticks of life and +50% damage per bounce. */
const BOUNCE_SPEEDUP = 1.2;
const BOUNCE_EXTRA_TICKS = 5;
const BOUNCE_DAMAGE = 1.5;

function solidAt(level: Level, x: number, y: number): boolean {
  const tile = level.getTileAt(x, y);
  return !tile || !tile.passable;
}

/**
 * Moves a bouncing shot one step. When the step would enter a wall the shot
 * stays put and the velocity component that ran into it flips, or both do
 * when it hits a corner head-on. Returns whether it bounced.
 */
function bounce(level: Level, pos: { x: number; y: number }, vel: { x: number; y: number }): boolean {
  if (!solidAt(level, pos.x + vel.x, pos.y + vel.y)) return false;
  const blockX = solidAt(level, pos.x + vel.x, pos.y);
  const blockY = solidAt(level, pos.x, pos.y + vel.y);
  if (blockX) vel.x = -vel.x;
  if (blockY) vel.y = -vel.y;
  if (!blockX && !blockY) {
    vel.x = -vel.x;
    vel.y = -vel.y;
  }
  return true;
}

/**
 * Bullets fly at constant speed, so they are moved here rather than by
 * MovementSystem (which applies friction). They die on walls or at max range.
 */
export function updateBullets(level: Level, _dt: number): void {
  for (const entity of world.with('position', 'velocity', 'bullet')) {
    const pos = entity.position!;
    const vel = entity.velocity!;
    const data = entity.bullet!;

    const bounced = (data.bounces ?? 0) > 0 && bounce(level, pos, vel);
    if (bounced) {
      // Each rebound speeds the ball up, keeps it alive a little longer and makes it hit harder.
      data.bounces!--;
      vel.x *= BOUNCE_SPEEDUP;
      vel.y *= BOUNCE_SPEEDUP;
      data.range += Math.hypot(vel.x, vel.y) * BOUNCE_EXTRA_TICKS;
      data.damage *= BOUNCE_DAMAGE;
    } else {
      pos.x += vel.x;
      pos.y += vel.y;
    }
    data.traveledRange += Math.hypot(vel.x, vel.y);

    // Buckshot loses punch as it flies, down to half a point.
    if (data.damageFalloff && data.damage > 0.5) data.damage -= data.damageFalloff;

    if (data.randomFrames && entity.visual) {
      const col = Math.floor(Math.random() * data.randomFrames);
      if (col !== entity.visual.col) {
        entity.visual.col = col;
        if (entity.sprite) setVisualFrame(entity.sprite, entity.visual.sheet, col);
      }
    }

    const tile = level.getTileAt(pos.x, pos.y);
    const hitWall = !tile || !tile.passable;

    if (hitWall || data.traveledRange >= data.range) {
      world.removeComponent(entity, 'bullet');
      world.addComponent(entity, 'removed', true);
    }
  }
}
