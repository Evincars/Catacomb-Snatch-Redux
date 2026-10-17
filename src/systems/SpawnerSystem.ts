import { world } from '../world';
import type { Entity } from '../world';
import type { Level } from '../level/Level';
import { createMob, mobRadius } from '../entities/MobFactory';
import { TileType, TILE_WIDTH, TILE_HEIGHT } from '../level/TileType';
import { gameState } from '../game/GameState';

const DENSITY_RADIUS = 5 * TILE_WIDTH;
const PLAYER_PRESSURE_RADIUS = 6 * TILE_WIDTH;
/** No mob of the same kind may already stand this close to a new one. */
const SAME_KIND_CLEARANCE = 8;
/** A nest stops producing while this many of its own mobs are alive, wherever they have wandered to. */
export const MAX_PER_NEST = 3;
/** Mobs appear within a couple of pixels of their nest. */
const SPAWN_JITTER = 5;

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

export function canSpawnMob(level: Level, type: string, x: number, y: number): boolean {
  const tile = level.getTileAt(x, y);
  if (!tile || !tile.passable || tile.type === TileType.Hole) return false;

  const r = mobRadius(type);
  const mobs = [...world.with('position', 'radius', 'ai')].filter((m) => !m.removed && (m.health?.current ?? 1) > 0);

  let total = 0;
  let inRegion = 0;
  for (const mob of mobs) {
    total++;
    const mp = mob.position;
    if (
      mob.mobType === type &&
      Math.abs(mp.x - x) < r.x + SAME_KIND_CLEARANCE + mob.radius.x &&
      Math.abs(mp.y - y) < r.y + SAME_KIND_CLEARANCE + mob.radius.y
    ) {
      return false;
    }
    if (Math.hypot(mp.x - x, mp.y - y) < DENSITY_RADIUS) inRegion++;
  }

  const difficulty = gameState.difficulty;
  if (total >= difficulty.maxMobs) return false;
  for (const player of world.with('position', 'playerInput')) {
    const p = player.position!;
    if (Math.hypot(p.x - x, p.y - y) > PLAYER_PRESSURE_RADIUS * 2) continue;
    if (mobs.filter((m) => Math.hypot(m.position.x - p.x, m.position.y - p.y) < PLAYER_PRESSURE_RADIUS).length
      >= difficulty.mobDensity * 2) return false;
  }
  return inRegion < difficulty.mobDensity;
}

function spawnFrom(level: Level, nest: Entity): void {
  const s = nest.spawner!;
  const pos = nest.position!;
  const x = clamp(pos.x + (Math.random() - 0.5) * SPAWN_JITTER, 0, level.width * TILE_WIDTH);
  const y = clamp(pos.y + (Math.random() - 0.5) * SPAWN_JITTER, 0, level.height * TILE_HEIGHT);

  const nestId = world.id(nest);
  let brood = 0;
  for (const mob of world.with('ai', 'spawnedBy')) {
    if (mob.spawnedBy === nestId && !mob.removed && (mob.health?.current ?? 1) > 0) brood++;
  }
  if (brood >= MAX_PER_NEST) return;

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
  for (const nest of world.with('position', 'spawner')) {
    if (nest.removed || (nest.health?.current ?? 1) <= 0) continue;
    const s = nest.spawner!;
    if (s.spawnCount >= s.maxSpawns) continue;
    // A nest being carried around stays shut.
    if (nest.carriedBy !== undefined) continue;
    if ((nest.freezeTime ?? 0) > 0) continue;

    if (--s.timer > 0) continue;
    s.timer = Math.trunc(s.interval * gameState.difficulty.spawnMod);
    spawnFrom(level, nest);
  }
}
