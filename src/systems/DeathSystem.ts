import { world } from '../world';
import type { Level } from '../level/Level';
import { createLoot } from '../entities/LootFactory';

export function updateDeath(_level: Level, _dt: number): void {
  for (const entity of world.with('health', 'position')) {
    const h = entity.health!;
    if (h.current > 0) continue;
    if (entity.removed) continue;

    const pos = entity.position!;
    const deathPts = entity.deathPoints ?? 0;

    if (deathPts > 0) {
      const loots = 4;
      for (let i = 0; i < loots; i++) {
        const angle = (i / loots) * Math.PI * 2;
        createLoot(pos.x, pos.y, Math.cos(angle), Math.sin(angle), deathPts);
      }
    }

    world.addComponent(entity, 'removed', true);
  }

  // Flush removed entities
  for (const entity of world.with('removed')) {
    if (entity.sprite) entity.sprite.destroy();
    world.remove(entity);
  }
}
