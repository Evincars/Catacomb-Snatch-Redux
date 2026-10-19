import { world } from '../world';
import type { Entity } from '../world';

/** Pull radius, a little wider than the original's reach. */
export const LOOT_PULL_RADIUS = 64;

/** Ticks a coin lies around (before the difficulty's scaling): 600-699, as in the original. */
const LIFE_MIN = 600;
const LIFE_SPREAD = 100;
export const LOOT_BURST_TICKS = 24;

type LootKind = { sheet: string; frames: number; value: number };

/** The original's nine pickups, from the smallest coin to the diamond. */
export const LOOT_KINDS: readonly LootKind[] = [
  { sheet: 'pickup_coin_bronze_small_8', frames: 6, value: 1 },
  { sheet: 'pickup_coin_silver_small_8', frames: 7, value: 2 },
  { sheet: 'pickup_coin_gold_small_8', frames: 7, value: 5 },
  { sheet: 'pickup_coin_bronze_16', frames: 6, value: 10 },
  { sheet: 'pickup_coin_silver_16', frames: 7, value: 20 },
  { sheet: 'pickup_coin_gold_16', frames: 7, value: 50 },
  { sheet: 'pickup_gem_emerald_12', frames: 7, value: 100 },
  { sheet: 'pickup_gem_ruby_12', frames: 7, value: 200 },
  { sheet: 'pickup_gem_diamond_24', frames: 14, value: 500 },
];

export type PickupSound = 'smallCoin' | 'bigCoin' | 'gem' | 'bigGem';

export function pickupSound(kind: number): PickupSound {
  if (kind >= 8) return 'bigGem';
  if (kind >= 7) return 'gem';
  return kind >= 5 ? 'bigCoin' : 'smallCoin';
}

/**
 * Original Loot constructor: start from the smallest pickup worth at least
 * `value`, then twice with a one-in-three chance step up a tier. That is how a
 * kill occasionally throws a gem.
 */
function rollKind(value: number): number {
  let kind = 0;
  while (kind < LOOT_KINDS.length - 1 && LOOT_KINDS[kind].value < value) kind++;
  if (Math.random() < 1 / 3) kind++;
  if (Math.random() < 1 / 3) kind++;
  return Math.min(kind, LOOT_KINDS.length - 1);
}

/** Largest pickup not worth more than `value`, for coins that must keep their exact worth. */
function exactKind(value: number): number {
  let kind = 0;
  while (kind < LOOT_KINDS.length - 1 && LOOT_KINDS[kind + 1].value <= value) kind++;
  return kind;
}

/** `exact` keeps the stated worth (money spilled by a player or harvester) instead of rolling a tier. */
export function createLoot(
  x: number,
  y: number,
  velX: number,
  velY: number,
  value: number,
  exact = false,
): Entity {
  const kind = exact ? exactKind(value) : rollKind(value);
  const spec = LOOT_KINDS[kind];
  const pow = 1 + Math.random();

  return world.add({
    position: { x, y },
    yOffset: 2,
    loot: {
      value: exact ? value : spec.value,
      kind,
      velX: velX * pow * 2,
      velY: velY * pow * 2,
      suckRadius: LOOT_PULL_RADIUS,
      glide: 0,
      age: 0,
      life: LIFE_MIN + Math.floor(Math.random() * LIFE_SPREAD),
      burstTicks: LOOT_BURST_TICKS,
    },
    radius: { x: 4, y: 4 },
    visual: { sheet: spec.sheet },
    animation: {
      sheet: spec.sheet,
      frameX: Math.floor(Math.random() * spec.frames),
      frameY: 0,
      frameCount: spec.frames,
      frameTime: 3,
      timer: 0,
      loop: true,
    },
  });
}

/** Scatters a kill's loot in a different pattern every time. */
export function dropLoot(x: number, y: number, value: number): void {
  const count = 4;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const speed = 0.4 + Math.random() * 0.8;
    createLoot(x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, value);
  }
}

/**
 * Scatters a purse as the biggest pickups that fit it (diamonds, rubies, emeralds, then coins), so
 * a rich player leaves gems behind. Worth is exact; the last piece takes whatever the cap leaves.
 */
export function spillPurse(x: number, y: number, total: number, maxPieces = 16): number {
  let remaining = Math.floor(total);
  let pieces = 0;
  for (let kind = LOOT_KINDS.length - 1; kind >= 0 && remaining > 0; kind--) {
    const value = LOOT_KINDS[kind].value;
    while (remaining >= value && pieces < maxPieces - 1) {
      const angle = Math.random() * Math.PI * 2;
      createLoot(x, y, Math.cos(angle) * 0.8, Math.sin(angle) * 0.8, value, true);
      remaining -= value;
      pieces++;
    }
  }
  if (remaining > 0) {
    const angle = Math.random() * Math.PI * 2;
    createLoot(x, y, Math.cos(angle) * 0.8, Math.sin(angle) * 0.8, remaining, true);
  }
  return Math.floor(total);
}

/** Spills a sum as a handful of exact-valued pickups, as when a harvester is wrecked. */
export function spillMoney(x: number, y: number, total: number): void {
  let remaining = total;
  for (let i = 0; remaining > 0 && i < 12; i++) {
    const value = i === 11 ? remaining : Math.max(1, Math.ceil(remaining / 2));
    const angle = Math.random() * Math.PI * 2;
    createLoot(x, y, Math.cos(angle), Math.sin(angle), value, true);
    remaining -= value;
  }
}
