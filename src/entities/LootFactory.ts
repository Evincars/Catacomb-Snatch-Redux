import { world } from '../world';
import type { Entity } from '../world';

export function createLoot(
  x: number,
  y: number,
  velX: number,
  velY: number,
  value: number,
): Entity {
  // Higher-value drops use the shinier coin art, matching the original.
  const sheet =
    value >= 10 ? 'pickup_coin_gold_16'
    : value >= 4 ? 'pickup_coin_silver_16'
    : 'pickup_coin_bronze_16';

  return world.add({
    position: { x, y },
    loot: { value, velX: velX * 2, velY: velY * 2, suckRadius: 20 },
    radius: { x: 4, y: 4 },
    visual: { sheet },
    animation: { sheet, frameX: 0, frameY: 0, frameCount: 7, frameTime: 6, timer: 0, loop: true },
  });
}
