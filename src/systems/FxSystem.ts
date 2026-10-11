import { world } from '../world';
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

    if (++fx.age >= fx.duration) world.addComponent(entity, 'removed', true);
  }
}
