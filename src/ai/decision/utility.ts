import type { Goal } from '../types';
import type { Situation } from './situation';

/** A goal an option proposes, with how much it is wanted right now. */
export type Proposal = {
  /** Utility: higher wins. Fixed ladder of needs plus what the situation adds to it. */
  score: number;
  goal: Omit<Goal, 'since'>;
  /** Bookkeeping to do only if this proposal is the one chosen. */
  commit?: () => void;
};

/**
 * One thing a computer player may want to do. Utility AI: every option scores itself against the same
 * snapshot of the situation and the best-scoring one becomes the goal. `ceiling` is the most it can
 * ever score, so a costly option is not even looked at once something better is already in hand.
 */
export type Option = {
  id: string;
  ceiling: number;
  evaluate(s: Situation): Proposal | null;
};

/** The best proposal over all options, skipping those whose ceiling cannot beat what is already found. */
export function choose(options: readonly Option[], s: Situation): { option: Option; proposal: Proposal } | null {
  let best: { option: Option; proposal: Proposal } | null = null;
  for (const option of [...options].sort((a, b) => b.ceiling - a.ceiling)) {
    if (best && option.ceiling <= best.proposal.score) continue;
    const proposal = option.evaluate(s);
    if (proposal && (!best || proposal.score > best.proposal.score)) best = { option, proposal };
  }
  return best;
}
