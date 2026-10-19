import type { Entity } from '../../world';
import type { Level } from '../../level/Level';
import type { AIDifficulty } from '../../game/GameState';
import { BLACKLIST_TICKS, GOAL_TIMEOUT } from '../constants';
import { setGoal } from '../brain';
import { routeFor } from '../perception/navigation';
import type { Brain } from '../types';
import { goalStillValid } from './goals';
import { CARRYING } from './options/carrying';
import { ERRANDS } from './options/errands';
import { OFFENSE } from './options/offense';
import { SHOPPING } from './options/shopping';
import { SURVIVAL } from './options/survival';
import { assess } from './situation';
import { choose } from './utility';
import type { Option } from './utility';

/**
 * Decision: what a computer player does next, by Utility AI. Perception hands over a Situation; every
 * option scores itself against it; the best score becomes the goal that Execution then carries out.
 * The options are listed roughly from most to least pressing, which also settles ties.
 */
export const OPTIONS: readonly Option[] = [...SURVIVAL, ...CARRYING, ...SHOPPING, ...OFFENSE, ...ERRANDS];

/** Dangers that interrupt anything, even an errand under way. */
const URGENT: readonly Option[] = SURVIVAL.filter((o) => o.id === 'escape blast' || o.id === 'retreat');

export function think(level: Level, entity: Entity, brain: Brain, profile: AIDifficulty): void {
  const s = assess(level, entity, brain, profile);

  const urgent = choose(URGENT, s);
  if (urgent) {
    urgent.proposal.commit?.();
    setGoal(brain, level, urgent.proposal.goal);
    return;
  }

  // Keep going with an interaction that is under way.
  const g = brain.goal;
  if (g && brain.age - g.since < GOAL_TIMEOUT && !g.walk && !g.huntId && !(s.threatened && !g.stash)
    && !(s.engaged && g.name === 'retrieve')
    && !(s.needsBaseDefense && g.build)
    && goalStillValid(level, entity, brain, g)) {
    brain.path = routeFor(level, s.field, g.tile);
    if (brain.path.length > 0 || s.field.dist[g.tile] === 0) return;
  }
  if (g && brain.age - g.since >= GOAL_TIMEOUT) {
    const id = g.useId ?? g.upgradeId ?? g.huntId;
    if (id !== undefined) brain.blacklist.set(id, brain.age + BLACKLIST_TICKS);
  }
  brain.goal = null;

  const pick = choose(OPTIONS, s);
  if (!pick) return;
  pick.proposal.commit?.();
  setGoal(brain, level, pick.proposal.goal);
}
