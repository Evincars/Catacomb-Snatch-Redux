import { world, Team } from '../world';
import type { Entity } from '../world';

/** Java SpawnerEntity.SPAWN_INTERVAL: one mob every four seconds before the difficulty modifier. */
export const SPAWNER_INTERVAL = 60 * 4;

/** Experience a nest is worth, from the SpawnerFor* subclasses. */
const SPAWNER_DEATH_POINTS: Record<string, number> = {
  bat: 5,
  snake: 10,
  mummy: 15,
  scarab: 20,
};

/** A destructible sarcophagus that keeps producing `mobType` until it is shot to pieces. */
export function createSpawner(x: number, y: number, mobType: string): Entity {
  return world.add({
    position: { x, y },
    radius: { x: 10, y: 10 },
    blocking: true,
    team: Team.Neutral,
    health: { current: 20, max: 20 },
    healthBarOffset: 22,
    hurtTime: 0,
    // Nests ignore damage for their first ten ticks, as in Java.
    freezeTime: 10,
    deathPoints: SPAWNER_DEATH_POINTS[mobType] ?? 5,
    yOffset: 0,
    visual: { sheet: 'spawner' },
    spawner: {
      mobType,
      interval: SPAWNER_INTERVAL,
      timer: Math.floor(Math.random() * SPAWNER_INTERVAL),
      spawnCount: 0,
      maxSpawns: Number.MAX_SAFE_INTEGER,
    },
    tooltip: { title: 'Spawner', lines: [`Spawns ${mobType}s.`, 'Can be picked up and moved.'] },
    minimapColor: 0xff4400,
  });
}
