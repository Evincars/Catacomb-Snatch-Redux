import { q, world } from '../../../world';
import { TILE_HEIGHT } from '../../../level/TileType';
import { LOOT_DETOUR, RICH_LOOT_DETOUR } from '../../constants';
import { weaponGain } from '../../perception/arsenal';
import { knownChests, nearestLoot, ownBuildings, treasureOf } from '../../perception/economy';
import { tileOf } from '../../perception/geometry';
import { approachTile, nearestOf } from '../../perception/navigation';
import { onTrack } from '../../perception/rails';
import { usePlan } from '../goals';
import type { Option } from '../utility';

const droppedGuns = world.with('position', 'weaponPickup');

/** Collecting what lies about, and what to do with nothing else to do. */
export const ERRANDS: Option[] = [
  {
    // A harvester with a good haul.
    id: 'drain a harvester',
    ceiling: 62,
    evaluate(s) {
      const full = nearestOf(s.level, s.brain, ownBuildings(s.entity, 'economy').filter((h) => h.harvester
        && !h.harvester.emptying && (h.harvester.collected >= s.profile.drainThreshold
          || h.harvester.collected >= h.harvester.capacity * 0.9)));
      return full ? { score: 62, goal: usePlan(s.level, s.brain, 'drain', full) } : null;
    },
  },
  {
    // A gun a fallen player left lying about, if it would improve the arsenal.
    id: 'pick up a dropped gun',
    ceiling: 38,
    evaluate(s) {
      const dropped = nearestOf(s.level, s.brain, [...droppedGuns].filter((g) => !g.removed
        && !s.entity.weaponInventory!.weapons.includes(g.weaponPickup!.kind) && weaponGain(s.entity, g.weaponPickup!.kind) > 2),
      LOOT_DETOUR * 2);
      return dropped
        ? { score: 38, goal: { name: 'pick up gun', tile: tileOf(s.level, dropped.position!.x, dropped.position!.y), walk: true } }
        : null;
    },
  },
  {
    // Close coins, or rich drops further away.
    id: 'loot',
    ceiling: 36,
    evaluate(s) {
      const loot = nearestLoot(s.level, s.brain);
      return loot ? { score: 36, goal: { name: 'loot', tile: tileOf(s.level, loot.position!.x, loot.position!.y), walk: true } } : null;
    },
  },
  {
    // A chest it has come across: a hoard worth going back for, though it never knows where unseen ones are.
    id: 'open a chest',
    ceiling: 44,
    evaluate(s) {
      const chest = nearestOf(s.level, s.brain, knownChests(s.level, s.entity, s.brain), RICH_LOOT_DETOUR);
      return chest ? { score: 44, goal: usePlan(s.level, s.brain, 'chest', chest) } : null;
    },
  },
  {
    // Wait by the treasure.
    id: 'roam',
    ceiling: 26,
    evaluate(s) {
      const treasure = treasureOf();
      if (!treasure) return null;
      const tile = approachTile(s.level, s.field, tileOf(s.level, treasure.position!.x, treasure.position!.y + TILE_HEIGHT));
      return tile >= 0 && s.field.dist[tile] > 0 ? { score: 26, goal: { name: 'roam', tile, walk: true } } : null;
    },
  },
  {
    // Idle: never stand on the track, where carriages would be held up.
    id: 'clear the track',
    ceiling: 24,
    evaluate(s) {
      const { field, level } = s;
      if (!onTrack(level, field.origin)) return null;
      let best = -1;
      for (let t = 0; t < field.dist.length; t++) {
        if (!Number.isFinite(field.dist[t]) || onTrack(level, t)) continue;
        if (best < 0 || field.dist[t] < field.dist[best]) best = t;
      }
      return best >= 0 ? { score: 24, goal: { name: 'clear track', tile: best, walk: true } } : null;
    },
  },
];
