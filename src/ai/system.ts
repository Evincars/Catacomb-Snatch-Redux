import { world, q, Team } from '../world';
import type { Level } from '../level/Level';
import type { AIDifficulty } from '../game/GameState';
import { SHOP_DEFS } from '../entities/ShopItemFactory';
import { brainOf, profileOf } from './brain';
import { think } from './decision/think';
import { clearIntents, control } from './execution/control';
import { enemiesNear, mobsNear, pickEnemy, pickHidden, rivalsInSight } from './perception/awareness';
import { clearOfBlast } from './perception/demolition';
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

/**
 * Plays every computer-controlled player: re-plans every few ticks (how often
 * depends on its difficulty), then steers, aims and presses keys each tick.
 * Runs right after keyboard input, before targeting and interaction read it.
 */
export function updateAIPlayers(level: Level): void {
  beginPerception();
  for (const entity of world.with('aiPlayer', 'playerInput', 'position', 'playerStats', 'weaponInventory', 'health')) {
    if (entity.removed) continue;
    const brain = brainOf(entity);
    const pi = entity.playerInput!;
    clearIntents(entity);
    pi.up = pi.down = pi.left = pi.right = pi.shoot = pi.sprint = false;

    if (entity.respawnTicks !== undefined || entity.falling || entity.health!.current <= 0) {
      // Plans made before dying are stale.
      brain.goal = null;
      brain.path = [];
      brain.enemyId = undefined;
      brain.think = 0;
      continue;
    }
    brain.age++;
    const profile = profileOf(entity);

    const blastDanger = [...world.with('position', 'bomb')].some((b) => !b.removed && b.carriedBy === undefined
      && b.bomb!.lit && !clearOfBlast(entity, b));
    if (blastDanger && brain.goal?.name !== 'escape blast') brain.think = 0;
    if (entity.carryingId === undefined && entity.health!.current < entity.health!.max * profile.retreatHealth
      && enemiesNear(entity, 160) && brain.goal?.name !== 'retreat') brain.think = 0;
    // Carrying something when a rival or a mob closes in: down it goes at once, rather than at the next plan.
    if (entity.carryingId !== undefined && brain.age % 4 === 0 && brain.goal?.name !== 'stash fight'
      && world.entity(entity.carryingId)?.bomb === undefined
      && (mobsNear(level, entity, 72) > 0 || rivalsInSight(level, entity, profile.engageRange) > 0)) brain.think = 0;
    if (--brain.think <= 0) {
      think(level, entity, brain, profile);
      brain.think = profile.thinkTicks;
    }

    // Spotting enemies happens more often than planning, but still with a reaction delay.
    if (brain.age % 4 === 0 || (brain.enemyId !== undefined && !alive(world.entity(brain.enemyId)))) {
      let enemy = pickEnemy(level, entity, profile, brain.goal?.huntId);
      if (enemy) brain.bank = null;
      else {
        const hidden = pickHidden(level, entity, brain, profile);
        enemy = hidden;
      }
      const id = enemy ? world.id(enemy) : undefined;
      if (id !== brain.enemyId) {
        brain.enemyId = id;
        brain.reaction = profile.reactionTicks;
      }
    }

    control(level, entity, brain, profile);
  }
}
