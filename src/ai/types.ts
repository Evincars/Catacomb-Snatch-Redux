import type { BankShot } from './perception/ricochet';

export type Goal = {
  name: string;
  /** Tile to walk to. */
  tile: number;
  /** Entity to reach and press `use` on (stall, harvester, chest). */
  useId?: number;
  upgradeId?: number;
  /** Lift this building of its own (to get out from between them). */
  pickupId?: number;
  /** Press build on this very tile (rail) or on a free base-track tile (carriage). */
  build?: 'rail' | 'carriage';
  /** Put down the building being carried here. */
  drop?: boolean;
  /** Tile to face while putting it down (a bomb is tossed against this wall). */
  faceTile?: number;
  /** Put down at once to free the hands for fighting (a bomb is kept, not lit). */
  stash?: true;
  /** Stand clear of our bomb and shoot it. */
  detonate?: true;
  /** Just walk there (loot, retreat, roaming, hunting). */
  walk?: true;
  /** Close in on this entity until it is in sight and range. */
  huntId?: number;
  /** Tick the goal was set at. */
  since: number;
};

export type Field = { dist: Float64Array; parent: Int32Array; origin: number; cost: Float32Array };

export type Brain = {
  age: number;
  think: number;
  field: Field | null;
  goal: Goal | null;
  path: number[];
  enemyId?: number;
  /** Ticks left before it reacts to the current enemy. */
  reaction: number;
  jitter: number;
  trigger: boolean;
  triggerTicks: number;
  swapTicks: number;
  lastX: number;
  lastY: number;
  stuck: number;
  /** Where it stood when it last set out along a path, and for how many ticks it has been walking since. */
  walkWatch: { x: number; y: number; ticks: number } | null;
  /** Tiles that turned out to be blocked (a carriage in a tunnel, a crowd) and until what age to route around them. */
  avoid: Map<number, number>;
  /** Track laid since the last upgrade, and when it began saving up for the next one. */
  railsSinceUpgrade: number;
  upgradeSince: number | null;
  sidestep: { x: number; y: number; ticks: number } | null;
  /** Tiles of track to lay, from the base outward, and tiles reserved for it. */
  railPlan: number[];
  railDone: boolean;
  lastCarriageAt: number;
  /** Our own explosive, put down to clear a wall, waiting to be shot. */
  blastId?: number;
  /** Bomb put down in a hurry to fight, to be picked up again. */
  looseBombId?: number;
  /** Head of the track while mobs hold it: the next turret goes there. */
  front?: { x: number; y: number };
  blacklist: Map<number, number>;
  /** Which way each axis key was last held and for how many ticks, so a key never flips back and forth. */
  held: { x: { dir: number; ticks: number }; y: { dir: number; ticks: number } };
  /** Whether it is steering back to the middle of the lane it walks along. */
  lane: boolean;
  /** A building put down to fight, to be picked up and put to use once the fight is over; and until when to try. */
  retrieveId?: number;
  retrieveUntil: number;
  /** A ricochet that reaches an enemy it cannot see, worked out at tick `at`. */
  bank: { targetId: number; shot: BankShot; at: number } | null;
  bankCool: number;
  /** Treasure chests it has set eyes on; the only ones it knows to go and open. */
  seenChests: Set<number>;
};

export type Controls = { up: boolean; down: boolean; left: boolean; right: boolean; sprint: boolean };

/** What the target does that decides which gun suits: how fast it moves, and whether the shot must bank off a wall. */
export type Aim = { speed: number; bank: boolean };

export const STRAIGHT: Aim = { speed: 0, bank: false };
