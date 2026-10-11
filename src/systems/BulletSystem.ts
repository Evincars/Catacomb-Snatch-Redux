import { world } from '../world';
import type { Level } from '../level/Level';
import { frameTexture } from '../render/Sheets';

/**
 * Bullets fly at constant speed, so they are moved here rather than by
 * MovementSystem (which applies friction). They die on walls or at max range.
 */
export function updateBullets(level: Level, _dt: number): void {
  for (const entity of world.with('position', 'velocity', 'bullet')) {
    const pos = entity.position!;
    const vel = entity.velocity!;
    const data = entity.bullet!;

    pos.x += vel.x;
    pos.y += vel.y;
    data.traveledRange += Math.hypot(vel.x, vel.y);

    // Buckshot loses punch as it flies, down to half a point.
    if (data.damageFalloff && data.damage > 0.5) data.damage -= data.damageFalloff;

    if (data.randomFrames && entity.visual) {
      const col = Math.floor(Math.random() * data.randomFrames);
      if (col !== entity.visual.col) {
        entity.visual.col = col;
        if (entity.sprite) entity.sprite.texture = frameTexture(entity.visual.sheet, col, 0);
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
