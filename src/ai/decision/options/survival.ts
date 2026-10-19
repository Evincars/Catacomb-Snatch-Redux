import { world, Team } from '../../../world';
import { INTERACT_REACH } from '../../../systems/TargetingSystem';
import { TRAPPED_TILES, WALLED_IN_TILES } from '../../constants';
import { enemiesNear } from '../../perception/awareness';
import { blastCover } from '../../perception/demolition';
import { ownBuildings } from '../../perception/economy';
import { alive, dist, tileOf } from '../../perception/geometry';
import { approachTile, nearestOf } from '../../perception/navigation';
import { stashPlan } from '../goals';
import type { Option } from '../utility';

/** Staying alive comes first: these outrank every errand. */
export const SURVIVAL: Option[] = [
  {
    id: 'escape blast',
    ceiling: 100,
    evaluate(s) {
      if (!s.danger) return null;
      const tile = blastCover(s.level, s.field, s.danger, false);
      if (tile < 0) return null;
      return { score: 100, goal: { name: 'escape blast', tile, walk: true }, commit: () => { s.brain.sidestep = null; } };
    },
  },
  {
    id: 'retreat',
    ceiling: 95,
    evaluate(s) {
      const health = s.entity.health!;
      if (s.held || health.current >= health.max * s.profile.retreatHealth || !enemiesNear(s.entity, 160)) return null;
      const turret = nearestOf(s.level, s.brain, ownBuildings(s.entity, 'defense'));
      const spawn = turret?.position ?? s.level.getRandomSpawnPoint(s.entity.team ?? Team.Two);
      if (!spawn) return null;
      return { score: 95, goal: { name: 'retreat', tile: approachTile(s.level, s.field, tileOf(s.level, spawn.x, spawn.y)), walk: true } };
    },
  },
  {
    // Hands full and something biting, or a rival in sight: it cannot shoot while carrying, so down it goes.
    id: 'stash for the fight',
    ceiling: 90,
    evaluate(s) {
      return s.threatened ? { score: 90, goal: stashPlan(s.level, s.brain, true) } : null;
    },
  },
  {
    // The fight is over: pick up what was put down for it, to be set where it belongs.
    id: 'retrieve',
    ceiling: 85,
    evaluate(s) {
      const { brain, entity, field, level } = s;
      if (brain.retrieveId === undefined) return null;
      const lost = world.entity(brain.retrieveId);
      if (!lost || lost.removed || lost.team !== entity.team || lost.carriedBy !== undefined || s.held
        || brain.age > brain.retrieveUntil) {
        brain.retrieveId = undefined;
        return null;
      }
      if (s.engaged) return null;
      const tile = approachTile(level, field, tileOf(level, lost.position!.x, lost.position!.y));
      if (tile >= 0 && Number.isFinite(field.dist[tile])) {
        return { score: 85, goal: { name: 'retrieve', tile, pickupId: world.id(lost)! } };
      }
      brain.retrieveId = undefined;
      return null;
    },
  },
  {
    // Walled in by its own buildings with nothing to fight inside: lift the nearest one and walk out.
    id: 'free self',
    ceiling: 76,
    evaluate(s) {
      if (s.held) return null;
      let open = 0;
      for (const d of s.field.dist) if (Number.isFinite(d) && ++open > TRAPPED_TILES) break;
      if (open > WALLED_IN_TILES && !(open <= TRAPPED_TILES && !enemiesNear(s.entity, 160))) return null;
      const hem = [...ownBuildings(s.entity, 'defense'), ...ownBuildings(s.entity, 'economy')]
        .filter((b) => alive(b) && b.carriedBy === undefined && dist(b.position!, s.pos) < INTERACT_REACH + 8)
        .sort((a, b) => dist(a.position!, s.pos) - dist(b.position!, s.pos));
      return hem[0] ? { score: 76, goal: { name: 'free self', tile: s.field.origin, pickupId: world.id(hem[0])! } } : null;
    },
  },
];
