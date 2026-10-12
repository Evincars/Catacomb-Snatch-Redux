import { world } from '../world';
import { spawnFx } from '../entities/FxFactory';
import { frameTexture } from '../render/Sheets';

/** Steps effect sprites through their strips and retires them when finished. */
export function updateFx(): void {
  for (const entity of world.with('fx', 'visual')) {
    if (entity.removed) continue;

    const fx = entity.fx!;
    const visual = entity.visual!;
    const frame = fx.cycle
      ? fx.age % fx.frames
      : Math.min(fx.frames - 1, Math.floor((fx.age * fx.frames) / fx.duration));

    if (visual.col !== frame) {
      visual.col = frame;
      if (entity.sprite) entity.sprite.texture = frameTexture(visual.sheet, frame, 0);
    }
    if (entity.sprite && fx.scale && entity.sprite.scale.x !== fx.scale) {
      entity.sprite.scale.set(fx.scale);
    }

    if (fx.rise) entity.position!.y -= fx.rise;
    if (++fx.age >= fx.duration) world.addComponent(entity, 'removed', true);
  }
}

/**
 * Java's LargeBombExplodeAnimation: for its whole life a blast throws a
 * fireball each tick at a random spot in a ring that widens as it burns out,
 * big ones early and more small ones towards the end.
 */
export function updateExplosions(): void {
  for (const entity of world.with('explosion', 'position')) {
    if (entity.removed) continue;
    const ex = entity.explosion!;
    if (--ex.life < 0) {
      world.addComponent(entity, 'removed', true);
      continue;
    }
    const pos = entity.position!;
    const maxRadius = 32 - (ex.life * 32) / ex.duration + 16;
    const dir = Math.random() * Math.PI * 2;
    const dist = Math.random() * maxRadius;
    const big = Math.floor(Math.random() * ex.duration) <= ex.life;
    spawnFx(
      pos.x + Math.cos(dir) * dist,
      pos.y + Math.sin(dir) * dist,
      big ? 'fx_bombsplosion_big_32' : 'fx_bombsplosion_small_32',
      10,
      20 + Math.floor(Math.random() * 10),
    );
  }
}

export function spawnExplosion(x: number, y: number): void {
  const duration = 30 + Math.floor(Math.random() * 10);
  world.add({ position: { x, y }, explosion: { life: duration, duration } });
}
