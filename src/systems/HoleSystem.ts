import { world, Team } from '../world';
import type { Entity } from '../world';
import type { Level } from '../level/Level';
import { TileType } from '../level/TileType';
import { createLoot } from '../entities/LootFactory';
import { sound } from '../audio/SoundPlayer';
import { spawnFx } from '../entities/FxFactory';

/** Ticks from stepping off the edge to landing at the spawn; matches the falling cry's length. */
export const FALL_TICKS = 60;
const FEMALE_CHARACTERS = ['countess_cruller', 'duchess_donut'];
/** Half-size of the support box under the feet that must be all hole for a fall. */
const SUPPORT = 6;
/** Most coin piles a fall scatters. */
const SPILL_PILES = 8;

const grounded = world.with('position', 'health');

function holeAt(level: Level, x: number, y: number): boolean {
  return level.getTileAt(x, y)?.type === TileType.Hole;
}

/** Feet can overhang an edge while any part of their small support box has floor under it. */
export function overHole(level: Level, entity: Entity): boolean {
  const p = entity.position!;
  const rx = Math.min(SUPPORT, entity.radius?.x ?? 0);
  const ry = Math.min(SUPPORT, entity.radius?.y ?? 0);
  return holeAt(level, p.x - rx, p.y - ry) && holeAt(level, p.x - rx, p.y + ry)
    && holeAt(level, p.x + rx, p.y - ry) && holeAt(level, p.x + rx, p.y + ry);
}

/**
 * Anything that walks onto a hole falls in. Mobs and buildings are simply lost;
 * a player drops what they carry, scatters half their coins and respawns.
 */
export function updateHoles(level: Level): void {
  for (const entity of grounded) {
    if (entity.removed || entity.carriedBy !== undefined || entity.mobType === 'bat' || entity.respawnTicks !== undefined) continue;
    if (!overHole(level, entity)) continue;
    if (!entity.playerInput) world.addComponent(entity, 'removed', true);
    else if (!entity.falling) startFall(entity);
  }
}

/** The player slips over the edge: input stops, a "!" pops up over their head and a cry plays. */
function startFall(player: Entity): void {
  const pos = player.position!;
  world.addComponent(player, 'falling', { age: 0, duration: FALL_TICKS });
  const female = FEMALE_CHARACTERS.some((c) => player.visual?.sheet.startsWith(c));
  sound.playSound(female ? 'fallingFemale' : 'fallingMale', pos.x, pos.y);
  spawnFx(pos.x, pos.y, 'exclamation_mark', 1, FALL_TICKS, {
    yOffset: 36,
    orderId: world.id(player),
    orderBias: 0.5,
  });
}

/** Half the purse scatters where they fell, as in Java's dropAllMoney(). */
function spillHalfPurse(player: Entity): void {
  const pos = player.position!;
  const stats = player.playerStats;
  if (!stats || stats.score <= 0) return;
  let remaining = Math.floor(stats.score / 2);
  stats.score -= remaining;
  for (let i = 0; remaining > 0 && i < SPILL_PILES; i++) {
    const value = Math.max(1, Math.floor(remaining / 2));
    const dir = Math.random() * Math.PI * 2;
    createLoot(pos.x, pos.y, Math.cos(dir), Math.sin(dir), value, true);
    remaining -= value;
  }
}

export function respawnPlayer(player: Entity, level: Level, reason: 'fall' | 'death' = 'fall'): void {
  const pos = player.position!;
  const health = player.health!;

  if (reason === 'fall') sound.playSound('fall', pos.x, pos.y);

  // Whatever the player was carrying falls in with them.
  const carriedId = player.carryingId;
  if (reason === 'fall' && carriedId !== undefined) {
    const carried = world.entity(carriedId);
    if (carried) world.addComponent(carried, 'removed', true);
    world.removeComponent(player, 'carryingId');
  }

  if (reason === 'fall') spillHalfPurse(player);

  const spawn = level.getRandomSpawnPoint(player.team ?? Team.One);
  if (spawn) {
    pos.x = spawn.x;
    pos.y = spawn.y;
  }

  // Falling costs a point of health rather than being a free teleport.
  if (reason === 'fall') health.max = Math.max(1, health.max - 1);
  health.current = health.max;

  if (player.velocity) player.velocity.x = player.velocity.y = 0;
  if (player.bump) player.bump.x = player.bump.y = 0;
  player.hurtTime = reason === 'death' ? 60 : 0;
  player.freezeTime = 0;
}
