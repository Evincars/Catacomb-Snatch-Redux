import { world, q, Team } from '../../world';
import type { Entity, AIRole } from '../../world';
import type { Level } from '../../level/Level';
import { TILE_WIDTH } from '../../level/TileType';
import type { AIDifficulty } from '../../game/GameState';
import { upgradeCostOf } from '../../entities/BuildingFactory';
import { railCost } from '../../systems/InteractionSystem';
import { roleOf } from '../brain';
import { GUARD_SPAN, INF, NEST_CLEAR_RANGE, RAILS_PER_UPGRADE, UPGRADE_AFTER, UPGRADE_SAVE_TICKS } from '../constants';
import { mobsNear, rivalsInSight } from '../perception/awareness';
import { besideWall, findSabotage, threateningBomb } from '../perception/demolition';
import type { SabotageTarget } from '../perception/demolition';
import { cheapestStall, ownBuildings } from '../perception/economy';
import { centreX, centreY, tileAt, tileOf } from '../perception/geometry';
import { reachable, walkDistance, walkField } from '../perception/navigation';
import { baseDefenseSpot, baseTurrets } from '../perception/placement';
import { planRails, unguardedTrack } from '../perception/rails';
import { worthUpgrading } from '../perception/upgrades';
import type { Brain, Field } from '../types';

/**
 * Everything a computer player knows when it decides what to do next: one snapshot of the world seen
 * from its position, built by Perception and read by every option of the Decision layer.
 */
export type Situation = {
  level: Level;
  entity: Entity;
  brain: Brain;
  profile: AIDifficulty;
  field: Field;
  pos: { x: number; y: number };
  role: AIRole;
  /** Never lays track: it leaves that, and the treasure, to its partner. */
  saboteur: boolean;
  money: number;
  held: Entity | undefined;
  /** Track still to be laid to the treasure, from the base outward; null when it is not building. */
  plan: number[] | null;
  /** Tile of a cracked wall on the planned route that a bomb could open from here, or -1. */
  wall: number;
  /** The best thing to blow up: any kind for a saboteur or a lone computer, only cuts for a builder. */
  sabotage: SabotageTarget | null;
  engaged: boolean;
  threatened: boolean;
  danger: Entity | undefined;
  explosive: Entity | null;
  /** Coins put by for a bomb that would open the way. */
  saving: number;
  spare: number;
  needsBaseDefense: boolean;
  home: { x: number; y: number } | null;
  railHead: { x: number; y: number } | null;
  guards: Entity[];
  turrets: Entity[];
  harvesters: Entity[];
  trackBudget: number;
  frontBusy: boolean;
  unguarded: { x: number; y: number; count: number } | null;
  /** Track laying waits while it saves up for a turret to guard the line. */
  savingForGuard: boolean;
  atHome: boolean;
  /** Coins beyond what the rest of the track needs; minus infinity when it should not spend now. */
  surplus: number;
  /** The upgrade it has been saving for and can now afford, if any. */
  upgradeDue: Entity | null;
  savingForUpgrade: boolean;
};

type UpgradePlan = { upgradeDue: Entity | null; savingForUpgrade: boolean };
const NO_UPGRADE: UpgradePlan = { upgradeDue: null, savingForUpgrade: false };

/** The cheapest of its own buildings it could and would upgrade, or null. */
function cheapestUpgrade(level: Level, entity: Entity, brain: Brain, profile: AIDifficulty): Entity | null {
  const candidates = [...q.upgradables].filter((b) => !b.removed && b.team === entity.team && b.carriedBy === undefined
    && b.upgradable!.level < profile.maxUpgrade && reachable(level, brain, b) < INF
    && worthUpgrading(level, entity, brain, b))
    .sort((a, b) => (upgradeCostOf(a) ?? INF) - (upgradeCostOf(b) ?? INF));
  return candidates[0] ?? null;
}

/**
 * Every few tiles of track it stops to save for an upgrade, so turrets and harvesters keep up. It saves
 * for a while; once it can afford the upgrade it is due, and if it never can, it gives up and lays on.
 */
function upgradeSavings(level: Level, entity: Entity, brain: Brain, profile: AIDifficulty): UpgradePlan {
  if (brain.age < UPGRADE_AFTER || brain.railsSinceUpgrade < RAILS_PER_UPGRADE) return NO_UPGRADE;
  const pick = cheapestUpgrade(level, entity, brain, profile);
  const cost = pick ? upgradeCostOf(pick) ?? INF : INF;
  if (!pick || !Number.isFinite(cost)) {
    brain.railsSinceUpgrade = 0;
    return NO_UPGRADE;
  }
  brain.upgradeSince ??= brain.age;
  if (entity.playerStats!.score - profile.reserve >= cost) return { upgradeDue: pick, savingForUpgrade: false };
  if (brain.age - brain.upgradeSince < UPGRADE_SAVE_TICKS) return { upgradeDue: null, savingForUpgrade: true };
  brain.railsSinceUpgrade = 0;
  brain.upgradeSince = null;
  return NO_UPGRADE;
}

/** Reads the world into a Situation, tidying the brain's bookkeeping on the way. */
export function assess(level: Level, entity: Entity, brain: Brain, profile: AIDifficulty): Situation {
  const pos = entity.position!;
  for (const [t, until] of brain.avoid) if (until <= brain.age) brain.avoid.delete(t);
  const field = walkField(level, tileOf(level, pos.x, pos.y), new Set(brain.avoid.keys()));
  brain.field = field;
  const money = entity.playerStats!.score;
  const held = entity.carryingId !== undefined ? world.entity(entity.carryingId) : undefined;
  const role = roleOf(entity);
  const saboteur = role === 'saboteur';

  // A builder only cuts the rival's link home once it has joined their track; the others wreck freely.
  const sabotage = findSabotage(level, entity, field, role === 'builder');
  const plan = saboteur ? null : planRails(level, entity.team ?? Team.Two);
  brain.railPlan = plan ?? [];
  brain.railDone = plan !== null && plan.length === 0;
  // Opening a reachable barrier is exploration, not rail construction: it is done even before laying
  // the intervening track or waiting out the rail delay.
  const wall = plan?.find((t) => tileAt(level, t)?.destroyable && besideWall(level, field, t) >= 0) ?? -1;
  const bomb = brain.blastId !== undefined ? world.entity(brain.blastId) : undefined;
  if (!bomb || bomb.removed || bomb.carriedBy !== undefined) brain.blastId = undefined;
  const loose = brain.looseBombId !== undefined ? world.entity(brain.looseBombId) : undefined;
  if (!loose || loose.removed || loose.carriedBy !== undefined || loose.bomb?.lit) brain.looseBombId = undefined;

  // Hands full and something biting within reach: put it down here and fight. A bomb is never let go
  // of in a fight: on the floor any stray shot sets it off, and it stays in hand across a respawn anyway.
  const engaged = mobsNear(level, entity, 72) > 0 || rivalsInSight(level, entity, profile.engageRange) > 0;
  const threatened = held !== undefined && !held.bomb && engaged;
  const explosive = cheapestStall(entity, 'explosive');
  const saving = wall >= 0 && brain.blastId === undefined && brain.looseBombId === undefined && !held?.bomb && explosive
    ? explosive.shopItem!.cost : 0;
  const spare = money - profile.reserve - saving;
  const defenseStall = cheapestStall(entity, 'defense');
  const needsBaseDefense = !!defenseStall && reachable(level, brain, defenseStall) < INF
    && baseTurrets(level, entity).length < Math.min(3, profile.maxTurrets)
    && baseDefenseSpot(level, entity, brain) >= 0;
  const danger = threateningBomb(entity);

  const home = level.getRandomSpawnPoint(entity.team ?? Team.Two);
  const railHead = plan && plan.length > 0
    ? { x: centreX(plan[0] % level.width), y: centreY(Math.floor(plan[0] / level.width)) } : null;
  const turrets = ownBuildings(entity, 'defense');
  const harvesters = ownBuildings(entity, 'economy');
  const guards = turrets.filter((b) => b.turret);
  const trackBudget = railCost() * (plan?.length ?? 0) + (saving > 0 ? 0 : wall >= 0 && explosive ? explosive.shopItem!.cost : 0);
  const frontBusy = railHead !== null && wall < 0 && !brain.railDone
    && mobsNear(level, entity, 3 * TILE_WIDTH, railHead) >= 3
    && !guards.some((g) => Math.hypot(g.position!.x - railHead.x, g.position!.y - railHead.y) < g.turret!.radius);

  // The laid track gets turrets of its own, so the line is held as it grows; track laying pauses to save for one.
  const unguarded = needsBaseDefense ? null : unguardedTrack(level, entity, field);
  let savingForGuard = false;
  if (unguarded && unguarded.count >= GUARD_SPAN && turrets.length < profile.maxTurrets + profile.trackTurrets) {
    const stall = cheapestStall(entity, 'defense');
    if (stall && reachable(level, brain, stall) < INF && spare < stall.shopItem!.cost) savingForGuard = true;
  }

  const atHome = home !== null && walkDistance(level, field, home.x, home.y) < NEST_CLEAR_RANGE;
  const surplus = atHome || frontBusy || brain.railDone ? spare - trackBudget : -INF;

  const { upgradeDue, savingForUpgrade } = needsBaseDefense ? NO_UPGRADE : upgradeSavings(level, entity, brain, profile);

  return {
    level, entity, brain, profile, field, pos, role, saboteur, money, held, plan, wall, sabotage, engaged, threatened,
    danger, explosive, saving, spare, needsBaseDefense, home: home ?? null, railHead, guards, turrets, harvesters,
    trackBudget, frontBusy, unguarded, savingForGuard, atHome, surplus, upgradeDue, savingForUpgrade,
  };
}
