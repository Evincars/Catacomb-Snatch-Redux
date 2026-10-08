import { world } from '../world';
import type { Entity } from '../world';

export function createLoot(
  x: number,
  y: number,
  velX: number,
  velY: number,
  value: number,
): Entity {
  return world.add({
    position: { x, y },
    loot: { value, velX: velX * 2, velY: velY * 2, suckRadius: 20 },
    radius: { x: 4, y: 4 },
  });
}
