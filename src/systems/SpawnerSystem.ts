import { MathUtils } from 'yuka';
import { world } from '../world';
import type { Entity } from '../world';
import type { Level } from '../level/Level';
import { createMob, mobRadius } from '../entities/MobFactory';
import { TileType, TILE_WIDTH, TILE_HEIGHT } from '../level/TileType';
import { gameState } from '../game/GameState';

const mobs = world.with('position', 'radius', 'ai');
const players = world.with('position', 'playerInput');
const offspring = world.with('ai', 'spawnedBy');
const nests = world.with('position', 'spawner');

const DENSITY_RADIUS = 5 * TILE_WIDTH;
const PLAYER_PRESSURE_RADIUS = 6 * TILE_WIDTH;
/** No mob of the same kind may already stand this close to a new one. */
const SAME_KIND_CLEARANCE = 8;
/** A nest stops producing while this many of its own mobs are alive, wherever they have wandered to. */
export const MAX_PER_NEST = 6;
/** Mobs appear within a couple of pixels of their nest. */
const SPAWN_JITTER = 5;

function isAlive(e: Entity): boolean {
  return !e.removed && (e.health?.current ?? 1) > 0;
}

/** Living mobs within `radius` pixels of a point. */
function mobsWithin(x: number, y: number, radius: number): number {
  let count = 0;
  for (const mob of mobs) {
    if (isAlive(mob) && Math.hypot(mob.position!.x - x, mob.position!.y - y) < radius) count++;
  }
  return count;
}

/** Whether a mob of the same kind already stands where a new one would appear. */
function kinTooClose(mob: Entity, type: string, x: number, y: number, r: { x: number; y: number }): boolean {
  if (mob.mobType !== type) return false;
  return Math.abs(mob.position!.x - x) < r.x + SAME_KIND_CLEARANCE + mob.radius!.x
    && Math.abs(mob.position!.y - y) < r.y + SAME_KIND_CLEARANCE + mob.radius!.y;
}

/** A player near the spot already has more than enough mobs around them. */
function pressured(player: Entity, x: number, y: number, limit: number): boolean {
  const p = player.position!;
  if (Math.hypot(p.x - x, p.y - y) > PLAYER_PRESSURE_RADIUS * 2) return false;
  return mobsWithin(p.x, p.y, PLAYER_PRESSURE_RADIUS) >= limit;
}

export function canSpawnMob(level: Level, type: string, x: number, y: number): boolean {
  const tile = level.getTileAt(x, y);
  if (!tile || !tile.passable || tile.type === TileType.Hole) return false;
  const r = mobRadius(type);
  let total = 0;
  let inRegion = 0;
  for (const mob of mobs) {
    if (!isAlive(mob)) continue;
    total++;
    if (kinTooClose(mob, type, x, y, r)) return false;
    if (Math.hypot(mob.position!.x - x, mob.position!.y - y) < DENSITY_RADIUS) inRegion++;
  }
  const difficulty = gameState.difficulty;
  if (total >= difficulty.maxMobs) return false;
  for (const player of players) if (pressured(player, x, y, difficulty.mobDensity * 2)) return false;
  return inRegion < difficulty.mobDensity;
}

/** Living mobs this nest has produced. */
function broodOf(nestId: number | undefined): number {
  let brood = 0;
  for (const mob of offspring) if (mob.spawnedBy === nestId && isAlive(mob)) brood++;
  return brood;
}

function spawnFrom(level: Level, nest: Entity): void {
  const s = nest.spawner!;
  const pos = nest.position!;
  const x = MathUtils.clamp(pos.x + (Math.random() - 0.5) * SPAWN_JITTER, 0, level.width * TILE_WIDTH);
  const y = MathUtils.clamp(pos.y + (Math.random() - 0.5) * SPAWN_JITTER, 0, level.height * TILE_HEIGHT);
  const nestId = world.id(nest);
  if (broodOf(nestId) >= MAX_PER_NEST) return;

  if (!canSpawnMob(level, s.mobType, x, y)) return;
  const mob = createMob(level, s.mobType, x, y);
  if (nestId !== undefined) world.addComponent(mob, 'spawnedBy', nestId);
  s.spawnCount++;
}

/**
 * Nests pop out a mob every SPAWN_INTERVAL ticks, stretched or squeezed by the
 * difficulty's spawn modifier. A hit nest pauses for its freeze time.
 */
export function updateSpawners(level: Level, _dt: number): void {
  for (const nest of nests) {
    const s = nest.spawner!;
    // A nest being carried around stays shut, and so does a hit one.
    const shut = nest.carriedBy !== undefined || (nest.freezeTime ?? 0) > 0;
    if (!isAlive(nest) || s.spawnCount >= s.maxSpawns || shut || --s.timer > 0) continue;
    s.timer = Math.trunc(s.interval * gameState.difficulty.spawnMod);
    spawnFrom(level, nest);
  }
}
