import { world } from '../world';
import type { Level } from '../level/Level';
import { createMob } from '../entities/MobFactory';
import { TileType, TILE_WIDTH, TILE_HEIGHT } from '../level/TileType';

/** Keeps the mob population bounded regardless of how many spawners a map has. */
const MAX_LIVE_MOBS = 40;

/** Nearest walkable tile centre to a point, searched in a small ring. */
function findOpenSpot(level: Level, x: number, y: number): { x: number; y: number } | null {
  const tx = Math.floor(x / TILE_WIDTH);
  const ty = Math.floor(y / TILE_HEIGHT);

  for (let r = 0; r <= 2; r++) {
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const tile = level.getTile(tx + dx, ty + dy);
        if (!tile || !tile.passable || tile.type === TileType.Hole) continue;
        return {
          x: (tx + dx) * TILE_WIDTH + TILE_WIDTH / 2,
          y: (ty + dy) * TILE_HEIGHT + TILE_HEIGHT / 2,
        };
      }
    }
  }
  return null;
}

export function updateSpawners(level: Level, _dt: number): void {
  let liveMobs = 0;
  for (const _ of world.with('ai', 'health')) liveMobs++;

  for (const spawner of world.with('position', 'spawner')) {
    const s = spawner.spawner!;
    if (s.spawnCount >= s.maxSpawns) continue;

    s.timer--;
    if (s.timer > 0) continue;

    s.timer = s.interval;
    if (liveMobs >= MAX_LIVE_MOBS) continue;

    // Spawn onto open ground, otherwise mobs appear embedded in a wall where
    // they cannot be reached or shot.
    const pos = spawner.position!;
    const spot = findOpenSpot(level, pos.x, pos.y);
    if (!spot) continue;

    createMob(level, s.mobType, spot.x, spot.y);
    s.spawnCount++;
    liveMobs++;
  }
}
