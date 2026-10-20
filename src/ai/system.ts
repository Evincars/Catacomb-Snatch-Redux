import { world, q, Team } from '../world';
import type { Level } from '../level/Level';
import type { AIDifficulty } from '../game/GameState';
import type { Entity } from '../world';
import type { Brain } from './types';
import { SHOP_DEFS } from '../entities/ShopItemFactory';
import { brainOf, profileOf } from './brain';
import { think } from './decision/think';
import { clearIntents, control } from './execution/control';
import { enemiesNear, mobsNear, pickEnemy, pickHidden, rivalsInSight } from './perception/awareness';
import { threateningBomb } from './perception/demolition';
import { alive } from './perception/geometry';
import { beginPerception } from './perception/spatial';

/** What every computer player starts with, enough to buy the plasma gun first and then fortify. */
export const STARTING_GOLD = 5000;

/**
 * Coins the computer starts a match with: its opening defence, a harvester, a bomb for the
 * first wall and the best gun on its side's stalls, so it is never the underdog for lack of a start.
 * The player is not told.
 */
export function openingCoins(profile: AIDifficulty): number {
  let gun = 0;
  let turret = 0;
  let harvester = 0;
  let bomb = 0;
  for (const stall of q.shopItems) {
    if (stall.team !== Team.Two || stall.removed) continue;
    const { kind, cost } = stall.shopItem!;
    const role = SHOP_DEFS[kind].role;
    if (role === 'weapon') gun = Math.max(gun, cost);
    else if (role === 'defense') turret = turret === 0 ? cost : Math.min(turret, cost);
    else if (role === 'economy') harvester = harvester === 0 ? cost : Math.min(harvester, cost);
    else if (role === 'explosive') bomb = bomb === 0 ? cost : Math.min(bomb, cost);
  }
  const needed = gun + harvester + bomb + turret * Math.min(3, profile.maxTurrets) + profile.reserve + 25;
  return Math.max(STARTING_GOLD, needed);
}

const computers = world.with('aiPlayer', 'playerInput', 'position', 'playerStats', 'weaponInventory', 'health');

function releaseKeys(entity: Entity): void {
  const pi = entity.playerInput!;
  clearIntents(entity);
  pi.up = pi.down = pi.left = pi.right = pi.shoot = pi.sprint = false;
}

/** Dead, respawning or falling: it plays no part this tick. */
function outOfPlay(entity: Entity): boolean {
  return entity.respawnTicks !== undefined || entity.falling !== undefined || entity.health!.current <= 0;
}

/** Plans made before dying are stale. */
function forgetPlans(brain: Brain): void {
  brain.goal = null;
  brain.path = [];
  brain.enemyId = undefined;
  brain.think = 0;
}

/**
 * Something that cannot wait for the next plan: a lit bomb about to catch it, health low with enemies
 * close, or a load in hand when a rival or a mob closes in (down it goes at once).
 */
function needsReplan(level: Level, entity: Entity, brain: Brain, profile: AIDifficulty): boolean {
  if (threateningBomb(entity) && brain.goal?.name !== 'escape blast') return true;
  const health = entity.health!;
  const carrying = entity.carryingId !== undefined;
  if (!carrying && health.current < health.max * profile.retreatHealth && enemiesNear(entity, 160)
    && brain.goal?.name !== 'retreat') return true;
  if (!carrying || brain.age % 4 !== 0 || brain.goal?.name === 'stash fight') return false;
  if (world.entity(entity.carryingId!)?.bomb !== undefined) return false;
  return mobsNear(level, entity, 72) > 0 || rivalsInSight(level, entity, profile.engageRange) > 0;
}

/** Spotting enemies happens more often than planning, but still with a reaction delay. */
function spotEnemy(level: Level, entity: Entity, brain: Brain, profile: AIDifficulty): void {
  const lost = brain.enemyId !== undefined && !alive(world.entity(brain.enemyId));
  if (brain.age % 4 !== 0 && !lost) return;
  const seen = pickEnemy(level, entity, profile, brain.goal?.huntId);
  if (seen) brain.bank = null;
  const enemy = seen ?? pickHidden(level, entity, brain, profile);
  const id = enemy ? world.id(enemy) : undefined;
  if (id === brain.enemyId) return;
  brain.enemyId = id;
  brain.reaction = profile.reactionTicks;
}

function play(level: Level, entity: Entity): void {
  const brain = brainOf(entity);
  releaseKeys(entity);
  if (outOfPlay(entity)) {
    forgetPlans(brain);
    return;
  }
  brain.age++;
  const profile = profileOf(entity);
  if (needsReplan(level, entity, brain, profile)) brain.think = 0;
  if (--brain.think <= 0) {
    think(level, entity, brain, profile);
    brain.think = profile.thinkTicks;
  }
  spotEnemy(level, entity, brain, profile);
  control(level, entity, brain, profile);
}

/**
 * Plays every computer-controlled player: re-plans every few ticks (how often
 * depends on its difficulty), then steers, aims and presses keys each tick.
 * Runs right after keyboard input, before targeting and interaction read it.
 */
export function updateAIPlayers(level: Level): void {
  beginPerception();
  for (const entity of computers) {
    if (!entity.removed) play(level, entity);
  }
}
