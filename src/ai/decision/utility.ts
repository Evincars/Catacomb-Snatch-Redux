import { GameEntity, GoalEvaluator, Think } from 'yuka';
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

export type Choice = { option: Option; proposal: Proposal };

/**
 * The computer player as Yuka's goal-driven design sees it: the agent whose Think brain arbitrates
 * between goal evaluators. It carries the Situation being judged and the evaluator that won.
 */
export class Planner extends GameEntity {
  situation: Situation | null = null;
  chosen: OptionEvaluator | null = null;
}

/** An option as a Yuka GoalEvaluator: its desirability is the option's utility score in the situation. */
export class OptionEvaluator extends GoalEvaluator<Planner> {
  readonly option: Option;
  /** What the option proposed at the last evaluation. */
  proposal: Proposal | null = null;

  constructor(option: Option) {
    super(1);
    this.option = option;
  }

  override calculateDesirability(owner: Planner): number {
    this.proposal = owner.situation ? this.option.evaluate(owner.situation) : null;
    return this.proposal ? this.proposal.score * this.characterBias : -Infinity;
  }

  override setGoal(owner: Planner): void {
    owner.chosen = this;
  }
}

/**
 * Yuka's Think arbitration over a set of options. It differs from the stock `arbitrate()` in two ways that
 * keep the planner's behaviour exact and cheap: a tie goes to the option listed first, and evaluators are
 * kept ranked by ceiling so one that cannot beat the best proposal so far is never evaluated at all.
 */
export class OptionArbiter extends Think<Planner> {
  private readonly ranked: OptionEvaluator[];

  constructor(owner: Planner, options: readonly Option[]) {
    super(owner);
    // A stable sort, so equal ceilings keep the order they were listed in.
    this.ranked = [...options].sort((a, b) => b.ceiling - a.ceiling).map((option) => new OptionEvaluator(option));
    for (const evaluator of this.ranked) this.addEvaluator(evaluator);
  }

  override arbitrate(): this {
    const owner = this.owner!;
    let best: OptionEvaluator | null = null;
    let bestScore = -Infinity;
    for (const evaluator of this.ranked) {
      if (best && evaluator.option.ceiling <= bestScore) continue;
      const score = evaluator.calculateDesirability(owner);
      if (score <= bestScore) continue;
      best = evaluator;
      bestScore = score;
    }
    owner.chosen = null;
    best?.setGoal(owner);
    return this;
  }

  /** The best option for the situation and what it proposes, or null when none applies. */
  decide(s: Situation): Choice | null {
    const owner = this.owner!;
    owner.situation = s;
    this.arbitrate();
    owner.situation = null;
    const chosen = owner.chosen;
    return chosen?.proposal ? { option: chosen.option, proposal: chosen.proposal } : null;
  }
}
