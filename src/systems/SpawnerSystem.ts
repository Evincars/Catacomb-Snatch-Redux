import { world } from '../world';
import type { Level } from '../level/Level';
import { createMob } from '../entities/MobFactory';

/** Keeps the mob population bounded regardless of how many spawners a map has. */
const MAX_LIVE_MOBS = 40;

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

    const pos = spawner.position!;
    createMob(level, s.mobType, pos.x, pos.y);
    s.spawnCount++;
    liveMobs++;
  }
}
