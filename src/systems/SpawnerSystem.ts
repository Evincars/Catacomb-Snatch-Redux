import { world } from '../world';
import type { Level } from '../level/Level';
import { createMob } from '../entities/MobFactory';

export function updateSpawners(level: Level, _dt: number): void {
  for (const spawner of world.with('position', 'spawner')) {
    const s = spawner.spawner!;
    if (s.spawnCount >= s.maxSpawns) continue;

    s.timer--;
    if (s.timer > 0) continue;

    s.timer = s.interval;

    const pos = spawner.position!;
    createMob(level, s.mobType, pos.x, pos.y);
    s.spawnCount++;
  }
}
