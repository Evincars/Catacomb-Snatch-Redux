import { world } from '../world';
import type { Level } from '../level/Level';

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

    const tile = level.getTileAt(pos.x, pos.y);
    const hitWall = !tile || !tile.passable;

    if (hitWall || data.traveledRange >= data.range) {
      world.removeComponent(entity, 'bullet');
      world.addComponent(entity, 'removed', true);
    }
  }
}
