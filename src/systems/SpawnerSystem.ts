import { world } from '../world';
import type { Entity } from '../world';
import type { Level } from '../level/Level';
import { createMob, mobRadius } from '../entities/MobFactory';
import { TileType, TILE_WIDTH, TILE_HEIGHT } from '../level/TileType';
import { gameState } from '../game/GameState';

/** Mob cap for the whole level: 1500 plus 500 scaled by difficulty strength (Java maxMonsters). */
const BASE_MOB_CAP = 1500;
const MOB_CAP_PER_STRENGTH = 500;
/** Side, in tiles, of the square regions the per-difficulty density limit applies to. */
const DENSITY_TILES = 5;
/** No mob of the same kind may already stand this close to a new one. */
const SAME_KIND_CLEARANCE = 8;
/** Mobs appear within a couple of pixels of their nest. */
const SPAWN_JITTER = 5;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function canSpawnAt(level: Level, type: string, x: number, y: number): boolean {
  const tile = level.getTileAt(x, y);
  if (!tile || !tile.passable || tile.type === TileType.Hole) return false;

  const r = mobRadius(type);
  const cellW = DENSITY_TILES * TILE_WIDTH;
  const cellH = DENSITY_TILES * TILE_HEIGHT;
  const cellX = Math.floor(x / cellW);
  const cellY = Math.floor(y / cellH);

  let total = 0;
  let inRegion = 0;
  for (const mob of world.with('position', 'radius', 'ai')) {
    total++;
    const mp = mob.position;
    if (
      mob.mobType === type &&
      Math.abs(mp.x - x) < r.x + SAME_KIND_CLEARANCE + mob.radius.x &&
      Math.abs(mp.y - y) < r.y + SAME_KIND_CLEARANCE + mob.radius.y
    ) {
      return false;
    }
    if (Math.floor(mp.x / cellW) === cellX && Math.floor(mp.y / cellH) === cellY) inRegion++;
  }

  const difficulty = gameState.difficulty;
  if (total >= BASE_MOB_CAP + MOB_CAP_PER_STRENGTH * difficulty.strengthMod) return false;
  return inRegion < difficulty.mobDensity;
}

function spawnFrom(level: Level, nest: Entity): void {
  const s = nest.spawner!;
  const pos = nest.position!;
  const x = clamp(pos.x + (Math.random() - 0.5) * SPAWN_JITTER, 0, level.width * TILE_WIDTH);
  const y = clamp(pos.y + (Math.random() - 0.5) * SPAWN_JITTER, 0, level.height * TILE_HEIGHT);

  if (!canSpawnAt(level, s.mobType, x, y)) return;
  createMob(level, s.mobType, x, y);
  s.spawnCount++;
}

/**
 * Nests pop out a mob every SPAWN_INTERVAL ticks, stretched or squeezed by the
 * difficulty's spawn modifier. A hit nest pauses for its freeze time.
 */
export function updateSpawners(level: Level, _dt: number): void {
  for (const nest of world.with('position', 'spawner')) {
    const s = nest.spawner!;
    if (s.spawnCount >= s.maxSpawns) continue;
    if ((nest.freezeTime ?? 0) > 0) continue;

    if (--s.timer > 0) continue;
    s.timer = Math.trunc(s.interval * gameState.difficulty.spawnMod);
    spawnFrom(level, nest);
  }
}
