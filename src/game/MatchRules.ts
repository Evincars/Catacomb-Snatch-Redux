/** How a match between two sides is decided: the treasure race, and the team deathmatch that settles a draw. */
import { world, Team } from '../world';
import type { Level } from '../level/Level';
import { treasureCapacity, treasureSpent } from './Treasury';

/** Two treasury points per pot delivered, as in the original versus mode. */
const POINTS_PER_POT = 2;

/** Treasury points a side needs to hold half of all the treasure on the map; `fallback` on a map without a pile. */
export function versusTarget(fallback: number): number {
  const pots = treasureCapacity();
  return pots > 0 ? (pots * POINTS_PER_POT) / 2 : fallback;
}

/** A winning team, 0 for nobody, or 'draw' when the treasure was shared out evenly. */
export type Verdict = Team | 0 | 'draw' | null;

const fighters = world.with('playerInput', 'team');

/**
 * The treasure race: each side's treasury counts the treasure points it brought home, and `targetScore` is
 * half of all the treasure on the map. Bringing home more than half wins outright, since the other side
 * can no longer catch up. Once every pot is gone the larger share wins; an even share is a draw.
 * A map without a treasure pile keeps the plain race to the target.
 */
export function treasureVerdict(level: Level): Verdict {
  const one = level.player1Score;
  const two = level.player2Score;
  if (treasureCapacity() === 0) {
    if (one >= level.targetScore) return Team.One;
    return two >= level.targetScore ? Team.Two : null;
  }
  if (one > level.targetScore) return Team.One;
  if (two > level.targetScore) return Team.Two;
  if (!treasureSpent()) return null;
  if (one === two) return 'draw';
  return one > two ? Team.One : Team.Two;
}

/** In a team deathmatch, the last team with anyone not yet eliminated wins; if both go down together, nobody does. */
export function deathmatchVerdict(): Verdict {
  let one = 0;
  let two = 0;
  for (const fighter of fighters) {
    if (fighter.removed || fighter.eliminated) continue;
    if (fighter.team === Team.One) one++;
    else if (fighter.team === Team.Two) two++;
  }
  if (one > 0 && two > 0) return null;
  if (one > 0) return Team.One;
  return two > 0 ? Team.Two : 0;
}

/**
 * A treasury as a percentage for the HUD: its share of all the treasure on the map (so more than 50 % wins),
 * or, on a map without a pile, how far along the race to the target it is.
 */
export function treasureShare(score: number, level: Level): number {
  const scale = treasureCapacity() > 0 ? 50 : 100;
  return Math.min(100, Math.floor((score * scale) / Math.max(1, level.targetScore)));
}
