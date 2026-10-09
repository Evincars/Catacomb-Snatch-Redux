import { world } from '../world';
import type { Level } from '../level/Level';
import { TileType, TILE_WIDTH, TILE_HEIGHT } from '../level/TileType';

/**
 * Port of Java's RandomSpawner: every tick it tries one random floor tile and
 * drops a mob spawner there if the surroundings are clear.
 */
const EDGE_MARGIN = 8;
const CLEAR_OF_PLAYERS_AND_SPAWNERS = 32 * 8;
const CLEAR_OF_TURRETS = 32 * 4;
const CLEAR_OF_BUILDINGS = 16;

/** Caps how many spawners a level accumulates; the Java cap was effectively unbounded. */
const MAX_SPAWNERS = 12;

const MOB_TYPES = ['bat', 'snake', 'mummy', 'scarab'] as const;

const SPAWNER_INTERVAL = 60 * 4;

function surroundingsClear(x: number, y: number): boolean {
  for (const e of world.with('position', 'playerInput')) {
    if (Math.hypot(e.position!.x - x, e.position!.y - y) < CLEAR_OF_PLAYERS_AND_SPAWNERS) return false;
  }
  for (const e of world.with('position', 'spawner')) {
    if (Math.hypot(e.position!.x - x, e.position!.y - y) < CLEAR_OF_PLAYERS_AND_SPAWNERS) return false;
  }
  for (const e of world.with('position', 'turret')) {
    if (Math.hypot(e.position!.x - x, e.position!.y - y) < CLEAR_OF_TURRETS) return false;
  }
  for (const e of world.with('position', 'building')) {
    if (Math.hypot(e.position!.x - x, e.position!.y - y) < CLEAR_OF_BUILDINGS) return false;
  }
  for (const e of world.with('position', 'shopItem')) {
    if (Math.hypot(e.position!.x - x, e.position!.y - y) < CLEAR_OF_BUILDINGS) return false;
  }
  return true;
}

export function updateRandomSpawner(level: Level): void {
  let spawners = 0;
  for (const _ of world.with('spawner')) spawners++;
  if (spawners >= MAX_SPAWNERS) return;

  const tx = Math.floor(Math.random() * (level.width - EDGE_MARGIN * 2)) + EDGE_MARGIN;
  const ty = Math.floor(Math.random() * (level.height - EDGE_MARGIN * 2)) + EDGE_MARGIN;

  const tile = level.getTile(tx, ty);
  if (!tile || tile.type !== TileType.Floor) return;

  const x = tx * TILE_WIDTH + TILE_WIDTH / 2;
  const y = ty * TILE_HEIGHT + TILE_HEIGHT / 2 - 4;
  if (!surroundingsClear(x, y)) return;

  world.add({
    position: { x, y },
    radius: { x: 10, y: 10 },
    blocking: true,
    health: { current: 20, max: 20 },
    hurtTime: 0,
    yOffset: 12,
    visual: { sheet: 'spawner' },
    spawner: {
      mobType: MOB_TYPES[Math.floor(Math.random() * MOB_TYPES.length)],
      interval: SPAWNER_INTERVAL,
      timer: Math.floor(Math.random() * SPAWNER_INTERVAL),
      spawnCount: 0,
      maxSpawns: Number.MAX_SAFE_INTEGER,
    },
    minimapColor: 0xff4400,
  });
}
