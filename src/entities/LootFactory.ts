import { world } from '../world';
import type { Entity } from '../world';

/** Pull radius, a little wider than the original's reach. */
export const LOOT_PULL_RADIUS = 64;

/** Chance that a coin is drawn from the larger art, so a pile has coins of mixed size. */
const BIG_COIN_CHANCE = 0.35;
const BIG_COIN_SCALE = 0.75;

export function createLoot(
  x: number,
  y: number,
  velX: number,
  velY: number,
  value: number,
): Entity {
  // Higher-value drops use the shinier coin art, matching the original.
  const metal = value >= 10 ? 'gold' : value >= 4 ? 'silver' : 'bronze';
  const big = Math.random() < BIG_COIN_CHANCE;
  const sheet = big ? `pickup_coin_${metal}_16` : `pickup_coin_${metal}_small_8`;

  return world.add({
    position: { x, y },
    loot: { value, velX: velX * 2, velY: velY * 2, suckRadius: LOOT_PULL_RADIUS, glide: 0, age: 0 },
    radius: { x: 4, y: 4 },
    visual: big ? { sheet, scale: BIG_COIN_SCALE } : { sheet },
    animation: {
      sheet,
      frameX: Math.floor(Math.random() * 6),
      frameY: 0,
      frameCount: 6,
      frameTime: 6,
      timer: 0,
      loop: true,
    },
  });
}

/** Scatters a kill's coins in a different pattern every time. */
export function dropLoot(x: number, y: number, value: number): void {
  const count = 3 + Math.floor(Math.random() * 3);
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.4 + Math.random() * 1.1;
    createLoot(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, value);
  }
}
