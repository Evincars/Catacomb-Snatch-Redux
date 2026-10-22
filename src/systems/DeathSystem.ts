import { world, Team } from '../world';
import type { Entity } from '../world';
import type { Level } from '../level/Level';
import { createLoot, dropLoot, spillMoney } from '../entities/LootFactory';
import { spawnDeathFx, spawnFx } from '../entities/FxFactory';
import { sound } from '../audio/SoundPlayer';
import type { SfxName } from '../audio/SoundPlayer';
import { xpForLevel } from '../ui/HudPanel';
import { destroyAttachments } from './BarSystem';
import { coop } from '../network/CoopSession';
import { dropOnDeath } from './DeathDropSystem';
import { isVersus } from '../game/GameState';
import { RESPAWN_TICKS } from './RespawnSystem';
import { AI_DEATH_GOLD } from '../ai/constants';

/** Worth of the emerald every pharaoh drops. */
const PHARAOH_GEM = 100;

/** Death cries as in each Java mob's getDeathSound(). */
const DEATH_SOUNDS: Record<string, SfxName> = {
  bat: 'explosion',
  scarab: 'enemyDeath1',
  mummy: 'enemyDeath2',
  snake: 'enemyDeath2',
  pharao: 'pharaoDies',
};

const mortals = world.with('health', 'position');
const levellers = world.with('playerStats', 'health');
const doomed = world.with('removed');

/** Splits a kill's experience across living players and handles level-ups. */
function awardExperience(points: number): void {
  if (points <= 0) return;
  for (const player of levellers) {
    if (player.health!.current <= 0) continue;
    player.playerStats!.exp += points;
    levelUp(player);
  }
}

function levelUp(player: Entity): void {
  const stats = player.playerStats!;
  while (stats.exp >= xpForLevel(stats.level)) {
    stats.exp -= xpForLevel(stats.level);
    stats.level++;
    player.health!.max += 2;
    player.health!.current = player.health!.max;
    sound.playSound('levelUp');
  }
}

/**
 * Anyone who can come back (a match against another side, or a co-op game) sits out a countdown at home.
 * A lone player's death ends the run.
 */
function comesBack(entity: Entity): boolean {
  if (entity.aiPlayer !== undefined) return true;
  if (entity.playerSlot === undefined) return false;
  return coop.role === 'host' || isVersus();
}

/**
 * A player who comes back leaves their coins and guns where they fell and waits out the countdown at home,
 * where they return. A computer player is handed AI_DEATH_GOLD to rebuild with each time it dies.
 */
function sendHome(level: Level, entity: Entity): void {
  const pos = entity.position!;
  dropOnDeath(entity);
  if (entity.aiPlayer && entity.playerStats) entity.playerStats.score += AI_DEATH_GOLD;
  spawnDeathFx(entity);
  const home = level.getRandomSpawnPoint(entity.team ?? Team.One);
  if (home) {
    pos.x = home.x;
    pos.y = home.y;
  }
  world.removeComponent(entity, 'falling');
  world.addComponent(entity, 'respawnTicks', RESPAWN_TICKS);
  world.removeComponent(entity, 'buffs');
  if (entity.velocity) entity.velocity.x = entity.velocity.y = 0;
  if (entity.bump) entity.bump.x = entity.bump.y = 0;
}

/** Wrecked machines blow up; a harvester spills everything it had stored, as in the original. */
function wreck(entity: Entity): void {
  const pos = entity.position!;
  sound.playSound('explosion', pos.x, pos.y);
  spawnFx(pos.x, pos.y, 'fx_bombsplosion_small_32', 10, 24, { yOffset: 8 });
  if (!entity.harvester || entity.harvester.collected <= 0) return;
  spillMoney(pos.x, pos.y, entity.harvester.collected);
  entity.harvester.collected = 0;
}

/** The sound and effect of something dying, and the experience it is worth. */
function mourn(entity: Entity): void {
  const pos = entity.position!;
  if (entity.chest) {
    sound.playSound('explosion', pos.x, pos.y);
    spawnDeathFx(entity);
  } else if (entity.turret || entity.harvester || entity.railDroid) {
    wreck(entity);
  } else if (entity.spawner) {
    // Clearing a nest is a milestone, so it reads louder than a mob death.
    sound.playSound('explosion', pos.x, pos.y);
    spawnDeathFx(entity);
    awardExperience(entity.deathPoints ?? 0);
  } else if (entity.ai) {
    sound.playSound(DEATH_SOUNDS[entity.mobType ?? ''] ?? 'enemyDeath1', pos.x, pos.y);
    spawnDeathFx(entity);
    awardExperience(entity.deathPoints ?? 0);
  }
}

/** What the dead leave behind: their worth in coins, and a pharaoh's emerald. */
function leaveLoot(entity: Entity): void {
  const pos = entity.position!;
  const deathPts = entity.deathPoints ?? 0;
  if (deathPts > 0) dropLoot(pos.x, pos.y, deathPts);
  // A pharaoh guards the treasure and always leaves at least one emerald behind.
  if (entity.mobType !== 'pharao') return;
  const angle = Math.random() * Math.PI * 2;
  createLoot(pos.x, pos.y, Math.cos(angle) * 0.6, Math.sin(angle) * 0.6, PHARAOH_GEM, true);
}

/** Handles one death; returns false when the entity stays in the world (a player waiting to respawn). */
function die(level: Level, entity: Entity): boolean {
  const pos = entity.position!;
  if (entity.playerInput) {
    if (entity.aiPlayer) sound.playSound('death', pos.x, pos.y);
    else sound.playSound('death');
    if (comesBack(entity)) {
      sendHome(level, entity);
      return false;
    }
  } else {
    mourn(entity);
  }
  leaveLoot(entity);
  return true;
}

export function updateDeath(level: Level, _dt: number): void {
  for (const entity of mortals) {
    if (entity.health!.current > 0 || entity.removed || entity.respawnTicks !== undefined) continue;
    if (die(level, entity)) world.addComponent(entity, 'removed', true);
  }
  flushRemoved();
}

/** Whoever was holding something that is now gone (a bomb that went off overhead) has empty hands again. */
function freeCarrier(entity: Entity): void {
  if (entity.carriedBy === undefined) return;
  const carrier = world.entity(entity.carriedBy);
  if (carrier && carrier.carryingId === world.id(entity)) world.removeComponent(carrier, 'carryingId');
}

export function flushRemoved(): void {
  for (const entity of doomed) {
    freeCarrier(entity);
    destroyAttachments(entity);
    if (entity.sprite) entity.sprite.destroy({ children: true });
    world.remove(entity);
  }
}
