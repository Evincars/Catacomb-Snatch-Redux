import { q } from '../../world';
import type { Entity } from '../../world';
import type { Level } from '../../level/Level';
import { SHOP_DEFS } from '../../entities/ShopItemFactory';
import type { ShopRole } from '../../entities/ShopItemFactory';
import { INF, LOOT_DETOUR, RICH_LOOT, RICH_LOOT_DETOUR } from '../constants';
import { centreX, centreY } from './geometry';
import { walkDistance } from './navigation';
import { nearby } from './spatial';
import type { Brain } from '../types';

export function roleOfBuilding(e: Entity): ShopRole | null {
  const type = e.building?.type;
  if (!type) return null;
  const def = (SHOP_DEFS as Record<string, { role: ShopRole } | undefined>)[type];
  return def?.role ?? null;
}

export function ownBuildings(entity: Entity, role: ShopRole): Entity[] {
  return [...q.buildings].filter((b) => !b.removed && b.team === entity.team
    && b.carriedBy === undefined && roleOfBuilding(b) === role);
}

export function treasureOf(): Entity | null {
  for (const b of q.buildings) if (b.building!.type === 'treasure' && !b.removed) return b;
  return null;
}

/** Cheapest stall of a role it can afford, preferring the dearest (best) one. */
export function stallFor(entity: Entity, role: ShopRole, budget: number, wanted?: (kind: string) => boolean): Entity | null {
  let best: Entity | null = null;
  for (const stall of q.shopItems) {
    if (stall.team !== entity.team || stall.removed) continue;
    const { kind, cost } = stall.shopItem!;
    if (SHOP_DEFS[kind].role !== role || cost > budget || (wanted && !wanted(kind))) continue;
    if (!best || cost > best.shopItem!.cost) best = stall;
  }
  return best;
}

/** Cheapest stall of a role, to know what to save up for. */
export function cheapestStall(entity: Entity, role: ShopRole): Entity | null {
  let best: Entity | null = null;
  for (const stall of q.shopItems) {
    if (stall.team !== entity.team || stall.removed || SHOP_DEFS[stall.shopItem!.kind].role !== role) continue;
    if (!best || stall.shopItem!.cost < best.shopItem!.cost) best = stall;
  }
  return best;
}

export function nearestLoot(level: Level, brain: Brain): Entity | null {
  let best: Entity | null = null;
  let bestScore = INF;
  const here = brain.field ? { x: centreX(brain.field.origin % level.width), y: centreY(Math.floor(brain.field.origin / level.width)) } : null;
  if (!here) return null;
  for (const coin of nearby(here.x, here.y, RICH_LOOT_DETOUR, ['loot'])) {
    if (coin.removed || (coin.loot!.burstTicks ?? 0) > 0) continue;
    const limit = coin.loot!.value >= RICH_LOOT ? RICH_LOOT_DETOUR : LOOT_DETOUR;
    const d = walkDistance(level, brain.field!, coin.position!.x, coin.position!.y);
    if (d > limit) continue;
    // Prefer worthwhile pickups a little.
    const score = d - Math.min(80, coin.loot!.value / 2);
    if (score < bestScore) {
      bestScore = score;
      best = coin;
    }
  }
  return best;
}
