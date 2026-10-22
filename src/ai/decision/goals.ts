import { world } from '../../world';
import type { Entity } from '../../world';
import type { Level } from '../../level/Level';
import { experiencedEnough, upgradeCostOf } from '../../entities/BuildingFactory';
import { railCost, carriageCost } from '../../systems/InteractionSystem';
import { INF } from '../constants';
import { besideTrack } from '../perception/rails';
import { tileAt, tileOf } from '../perception/geometry';
import { approachTile, reachableCount } from '../perception/navigation';
import type { Brain, Goal } from '../types';

/** A goal before it is set: the same fields, without the tick it was set at. */
export type Plan = Omit<Goal, 'since'>;

/** Walk to a stall, building or chest and press `use` (or `upgrade`) on it. */
export function usePlan(level: Level, brain: Brain, name: string, target: Entity, key: 'useId' | 'upgradeId' = 'useId'): Plan {
  const tile = approachTile(level, brain.field!, tileOf(level, target.position!.x, target.position!.y));
  return { name, tile, [key]: world.id(target)! };
}

/** Walk to the tile nearest a moving or walled-off target and close in on it until it is in sight and range. */
export function huntPlan(level: Level, brain: Brain, name: string, target: Entity): Plan {
  const tile = approachTile(level, brain.field!, tileOf(level, target.position!.x, target.position!.y));
  return { name, tile, huntId: world.id(target)! };
}

/**
 * Puts the load down. In a fight it goes down right here, to be picked up again afterwards; otherwise on a
 * clear tile, never on or against the track (or its planned route) and never where it would wall the
 * computer in, falling back on the spot it stands on.
 */
export function stashPlan(level: Level, brain: Brain, fight = false): Plan {
  const field = brain.field!;
  if (fight) return { name: 'stash fight', tile: field.origin, drop: true, stash: true };
  const planned = new Set(brain.railPlan);
  let open = 0;
  for (const d of field.dist) if (Number.isFinite(d)) open++;
  // Setting it down must not wall the computer in, so a tile that cuts off the way out does not count.
  const keepsOpen = (t: number) => reachableCount(level, field.origin, t) >= Math.min(open - 2, open * 0.9);
  const clear = (t: number) => tileAt(level, t)?.buildable === true && !besideTrack(level, t) && !planned.has(t)
    && keepsOpen(t);
  if (clear(field.origin)) return { name: 'stash', tile: field.origin, drop: true, stash: true };
  let best = -1;
  for (let t = 0; t < field.dist.length; t++) {
    if (field.dist[t] > 8 || !clear(t)) continue;
    if (best < 0 || field.dist[t] < field.dist[best]) best = t;
  }
  return best >= 0 ? { name: 'stash', tile: best, drop: true } : { name: 'stash', tile: field.origin, drop: true, stash: true };
}

/** Whether a goal that is under way can still be carried out. */
export function goalStillValid(level: Level, entity: Entity, brain: Brain, g: Goal): boolean {
  if (g.drop) return entity.carryingId !== undefined && !g.faceTile;
  if (entity.carryingId !== undefined) return false;
  if (g.pickupId !== undefined) {
    const target = world.entity(g.pickupId);
    return !!target && !target.removed && target.carriedBy === undefined;
  }
  const id = g.useId ?? g.upgradeId;
  if (id !== undefined) {
    const target = world.entity(id);
    if (!target || target.removed || target.carriedBy !== undefined) return false;
    if (target.shopItem) return entity.playerStats!.score >= target.shopItem.cost;
    if (target.harvester && g.useId !== undefined) return target.harvester.collected > 0 && !target.harvester.emptying;
    if (target.chest) return !target.chest.opened;
    if (g.upgradeId !== undefined) return experiencedEnough(entity, target) && (upgradeCostOf(target) ?? INF) <= entity.playerStats!.score;
    return true;
  }
  if (g.build === 'rail') {
    const tile = level.getTile(g.tile % level.width, Math.floor(g.tile / level.width));
    return brain.railPlan[0] === g.tile && tile?.buildable === true && entity.playerStats!.score >= railCost();
  }
  if (g.build === 'carriage') return entity.playerStats!.score >= carriageCost();
  return false;
}
