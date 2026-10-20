import { world } from '../world';
import type { Entity } from '../world';
import { spawnFx } from '../entities/FxFactory';
import { setVisualFrame } from '../render/AnimatedVisual';

const effects = world.with('fx', 'visual');
const blasts = world.with('explosion', 'position');

/** Shows the strip frame for the effect's age, at the effect's scale. */
function showFrame(entity: Entity): void {
  const fx = entity.fx!;
  const visual = entity.visual!;
  const frame = fx.cycle ? fx.age % fx.frames : Math.min(fx.frames - 1, Math.floor((fx.age * fx.frames) / fx.duration));
  const sprite = entity.sprite;
  if (visual.col !== frame) {
    visual.col = frame;
    if (sprite) setVisualFrame(sprite, visual.sheet, frame);
  }
  if (sprite && fx.scale && sprite.scale.x !== fx.scale) sprite.scale.set(fx.scale);
}

/** Steps effect sprites through their strips and retires them when finished. */
export function updateFx(): void {
  for (const entity of effects) {
    if (entity.removed) continue;
    const fx = entity.fx!;
    showFrame(entity);
    if (fx.rise) entity.position!.y -= fx.rise;
    if (++fx.age >= fx.duration) world.addComponent(entity, 'removed', true);
  }
}

/** Fireballs are drawn larger than their 32px art, so a blast reads as big as the area it clears. */
const BIG_FIREBALL_SCALE = 1.75;
const SMALL_FIREBALL_SCALE = 1.25;
/** Fireballs thrown per tick. */
const FIREBALLS_PER_TICK = 2;

/**
 * Adapted from Java's LargeBombExplodeAnimation: for its whole life a blast
 * throws fireballs at random spots, big ones early and more small ones towards
 * the end. They spread over the whole square the blast clears, from the middle
 * outward, so every tile it reaches is filled with fire.
 */
export function updateExplosions(): void {
  for (const entity of blasts) {
    if (entity.removed) continue;
    const ex = entity.explosion!;
    if (--ex.life < 0) {
      world.addComponent(entity, 'removed', true);
      continue;
    }
    const pos = entity.position!;
    const age = 1 - ex.life / ex.duration;
    // Fireballs are centred up to this far in, so their edges just reach the blast's rim.
    const spread = (ex.radius - 12) * Math.min(1, 0.6 + age);
    for (let i = 0; i < FIREBALLS_PER_TICK; i++) {
      const big = Math.floor(Math.random() * ex.duration) <= ex.life;
      spawnFx(
        pos.x + (Math.random() * 2 - 1) * spread,
        pos.y + (Math.random() * 2 - 1) * spread,
        big ? 'fx_bombsplosion_big_32' : 'fx_bombsplosion_small_32',
        10,
        20 + Math.floor(Math.random() * 10),
        { scale: big ? BIG_FIREBALL_SCALE : SMALL_FIREBALL_SCALE },
      );
    }
  }
}

export function spawnExplosion(x: number, y: number, radius: number): void {
  const duration = 30 + Math.floor(Math.random() * 10);
  world.add({ position: { x, y }, explosion: { life: duration, duration, radius } });
}
