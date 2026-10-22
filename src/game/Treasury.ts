/** The treasure pile: a finite store of pots that the carriages carry off, drawn emptier as it is mined. */
import { world } from '../world';
import type { Entity } from '../world';

/** Pots one pile holds: enough for each side to bring home half of it (a hundred treasury points apiece). */
export const TREASURE_POTS = 100;

/** treasure.png columns, from brimming to scraped bare. */
const PILE_FRAMES = 4;

const piles = world.with('treasure');
const carriages = world.with('railDroid');

export function pileCapacity(pile: Entity): number {
  return pile.treasure?.capacity ?? TREASURE_POTS;
}

/** Pots still in a pile; a pile from an older save is still full. */
export function potsLeft(pile: Entity): number {
  return pile.treasure?.left ?? pileCapacity(pile);
}

/**
 * treasure.png column for how much of a pile is left: full, about two thirds, about a third, and
 * empty. Any treasure at all keeps a glint in the pot; only a pile mined to nothing shows bare.
 */
export function pileFrame(left: number, capacity: number): number {
  if (left <= 0 || capacity <= 0) return PILE_FRAMES - 1;
  const mined = 1 - left / capacity;
  return Math.min(PILE_FRAMES - 2, Math.floor(mined * (PILE_FRAMES - 1)));
}

/** Takes one pot from the pile for a carriage, if there is one left, and shows the pile that much emptier. */
export function takePot(pile: Entity): boolean {
  const treasure = pile.treasure;
  const left = potsLeft(pile);
  if (!treasure || left <= 0) return false;
  treasure.capacity = pileCapacity(pile);
  treasure.left = left - 1;
  pile.frame = pileFrame(treasure.left, treasure.capacity);
  return true;
}

/** Pots in every pile on the map when it opened. */
export function treasureCapacity(): number {
  let total = 0;
  for (const pile of piles) if (!pile.removed) total += pileCapacity(pile);
  return total;
}

/** Pots still to be mined across the map. */
export function treasureRemaining(): number {
  let total = 0;
  for (const pile of piles) if (!pile.removed) total += potsLeft(pile);
  return total;
}

/** Every pot has been mined and delivered (or lost with its carriage): the treasury can change no more. */
export function treasureSpent(): boolean {
  if (treasureRemaining() > 0) return false;
  for (const carriage of carriages) if (!carriage.removed && carriage.railDroid!.full) return false;
  return true;
}
