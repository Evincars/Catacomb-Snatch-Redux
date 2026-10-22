import { world } from '../../../world';
import { blastCover, besideWall } from '../../perception/demolition';
import { mobsNear } from '../../perception/awareness';
import { placementFor } from '../../perception/placement';
import { usePlan, stashPlan } from '../goals';
import type { Option } from '../utility';

/** What to do with a load in hand, and with a bomb that has been set. */
export const CARRYING: Option[] = [
  {
    // A bomb goes against the wall in the way.
    id: 'bomb the wall',
    ceiling: 82,
    evaluate(s) {
      if (!s.held?.bomb || s.wall < 0) return null;
      const tile = besideWall(s.level, s.field, s.wall);
      return tile >= 0 ? { score: 82, goal: { name: 'place bomb', tile, drop: true, faceTile: s.wall } } : null;
    },
  },
  {
    // The bomb goes beside what is to be wrecked; once it is down the AI backs off and shoots it.
    id: 'bomb the rival',
    ceiling: 81,
    evaluate(s) {
      if (!s.held?.bomb || !s.sabotage) return null;
      return { score: 81, goal: { name: 'place bomb', tile: s.sabotage.stand, drop: true, faceTile: s.sabotage.tile } };
    },
  },
  {
    id: 'place the load',
    ceiling: 79,
    evaluate(s) {
      if (!s.held || s.held.bomb) return null;
      const tile = placementFor(s.level, s.entity, s.brain, s.held);
      return { score: 79, goal: tile >= 0 ? { name: 'place', tile, drop: true } : stashPlan(s.level, s.brain) };
    },
  },
  {
    // No wall to open from here: set the bomb down out of harm's way and keep it.
    id: 'set the bomb aside',
    ceiling: 78,
    evaluate(s) {
      return s.held?.bomb ? { score: 78, goal: stashPlan(s.level, s.brain) } : null;
    },
  },
  {
    // A bomb of ours is set: get clear of it and shoot it.
    id: 'detonate',
    ceiling: 75,
    evaluate(s) {
      if (s.brain.blastId === undefined) return null;
      const tile = blastCover(s.level, s.field, world.entity(s.brain.blastId)!);
      return tile >= 0 ? { score: 75, goal: { name: 'detonate', tile, detonate: true } } : null;
    },
  },
  {
    // A bomb put down to fight is fetched again once things are quiet, not while the rival is still in sight.
    id: 'fetch the bomb',
    ceiling: 74,
    evaluate(s) {
      if (s.brain.looseBombId === undefined || (s.wall < 0 && !s.sabotage) || s.engaged
        || mobsNear(s.level, s.entity, 120) > 0) return null;
      const bomb = world.entity(s.brain.looseBombId);
      return bomb ? { score: 74, goal: usePlan(s.level, s.brain, 'fetch bomb', bomb) } : null;
    },
  },
];
