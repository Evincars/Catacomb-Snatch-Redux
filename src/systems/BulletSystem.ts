import { world } from '../world';
import type { Entity } from '../world';
import type { Level } from '../level/Level';
import { setVisualFrame } from '../render/AnimatedVisual';

const flying = world.with('position', 'velocity', 'bullet');

/** Java BulletRay: +20% speed, +5 ticks of life and +50% damage per bounce. */
export const BOUNCE_SPEEDUP = 1.2;
export const BOUNCE_EXTRA_TICKS = 5;
const BOUNCE_DAMAGE = 1.5;

export function solidAt(level: Level, x: number, y: number): boolean {
  const tile = level.getTileAt(x, y);
  return !tile || !tile.passable;
}

/**
 * Moves a bouncing shot one step. When the step would enter a wall the shot
 * stays put and the velocity component that ran into it flips, or both do
 * when it hits a corner head-on. Returns whether it bounced.
 */
export function bounce(level: Level, pos: { x: number; y: number }, vel: { x: number; y: number }): boolean {
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

/** Each rebound speeds the ball up, keeps it alive a little longer and makes it hit harder. */
function powerUp(entity: Entity): void {
  const vel = entity.velocity!;
  const data = entity.bullet!;
  data.bounces!--;
  vel.x *= BOUNCE_SPEEDUP;
  vel.y *= BOUNCE_SPEEDUP;
  data.range += Math.hypot(vel.x, vel.y) * BOUNCE_EXTRA_TICKS;
  data.damage *= BOUNCE_DAMAGE;
}

/** Plasma balls pick a random frame of their sheet every tick. */
function flicker(entity: Entity): void {
  const frames = entity.bullet!.randomFrames;
  const visual = entity.visual;
  if (!frames || !visual) return;
  const col = Math.floor(Math.random() * frames);
  if (col === visual.col) return;
  visual.col = col;
  if (entity.sprite) setVisualFrame(entity.sprite, visual.sheet, col);
}

function spent(level: Level, entity: Entity): boolean {
  const pos = entity.position!;
  const data = entity.bullet!;
  return solidAt(level, pos.x, pos.y) || data.traveledRange >= data.range;
}

/**
 * Bullets fly at constant speed, so they are moved here rather than by
 * MovementSystem (which applies friction). They die on walls or at max range.
 */
export function updateBullets(level: Level, _dt: number): void {
  for (const entity of flying) {
    const pos = entity.position!;
    const vel = entity.velocity!;
    const data = entity.bullet!;
    if ((data.bounces ?? 0) > 0 && bounce(level, pos, vel)) {
      powerUp(entity);
    } else {
      pos.x += vel.x;
      pos.y += vel.y;
    }
    data.traveledRange += Math.hypot(vel.x, vel.y);
    // Buckshot loses punch as it flies, down to half a point.
    if (data.damageFalloff && data.damage > 0.5) data.damage -= data.damageFalloff;
    flicker(entity);
    if (!spent(level, entity)) continue;
    world.removeComponent(entity, 'bullet');
    world.addComponent(entity, 'removed', true);
  }
}
