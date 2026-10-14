import { world } from '../world';
import type { Level } from '../level/Level';
import { TileType, TILE_WIDTH, TILE_HEIGHT } from '../level/TileType';
import { createSpawner } from '../entities/SpawnerFactory';

/**
 * Port of Java's RandomSpawner: every tick it tries one random floor tile and
 * drops a mob spawner there if the surroundings are clear.
 */
const EDGE_MARGIN = 8;
const CLEAR_OF_PLAYERS_AND_SPAWNERS = 32 * 8;
const CLEAR_OF_TURRETS = 32 * 4;
const CLEAR_OF_BUILDINGS = 32 * 0.5;
/** Nests made at level start, as in Java's GameModeVanilla. */
const INITIAL_SPAWNERS = 11;

/** Bats nest far more often than the tougher kinds, which stay rare. */
const MOB_WEIGHTS: ReadonlyArray<readonly [string, number]> = [
  ['bat', 10],
  ['snake', 2],
  ['mummy', 2],
  ['scarab', 1],
];
const WEIGHT_TOTAL = MOB_WEIGHTS.reduce((sum, [, w]) => sum + w, 0);

function pickMobType(): string {
  let roll = Math.random() * WEIGHT_TOTAL;
  for (const [type, weight] of MOB_WEIGHTS) {
    if ((roll -= weight) < 0) return type;
  }
  return 'bat';
}

/** Java checks an axis-aligned box of radius `r` against each entity's own box. */
function near(e: { position?: { x: number; y: number }; radius?: { x: number; y: number } }, x: number, y: number, r: number): boolean {
  const p = e.position!;
  const er = e.radius ?? { x: 0, y: 0 };
  return Math.abs(p.x - x) < r + er.x && Math.abs(p.y - y) < r + er.y;
}

function surroundingsClear(x: number, y: number): boolean {
  for (const e of world.with('position', 'playerInput')) {
    if (near(e, x, y, CLEAR_OF_PLAYERS_AND_SPAWNERS)) return false;
  }
  for (const e of world.with('position', 'spawner')) {
    if (near(e, x, y, CLEAR_OF_PLAYERS_AND_SPAWNERS)) return false;
  }
  for (const e of world.with('position', 'turret')) {
    if (near(e, x, y, CLEAR_OF_TURRETS)) return false;
  }
  for (const e of world.with('position', 'building')) {
    if (near(e, x, y, CLEAR_OF_BUILDINGS)) return false;
  }
  for (const e of world.with('position', 'shopItem')) {
    if (near(e, x, y, CLEAR_OF_BUILDINGS)) return false;
  }
  return true;
}

function tryPlaceSpawner(level: Level, tx: number, ty: number, mobType: string): void {
  const tile = level.getTile(tx, ty);
  if (!tile || tile.type !== TileType.Floor || !tile.buildable) return;

  const x = tx * TILE_WIDTH + TILE_WIDTH / 2;
  const y = ty * TILE_HEIGHT + TILE_HEIGHT / 2 - 4;
  if (!surroundingsClear(x, y)) return;

  createSpawner(x, y, mobType);
}

export function updateRandomSpawner(level: Level): void {
  const tx = Math.floor(Math.random() * (level.width - EDGE_MARGIN * 2)) + EDGE_MARGIN;
  const ty = Math.floor(Math.random() * (level.height - EDGE_MARGIN * 2)) + EDGE_MARGIN;
  tryPlaceSpawner(level, tx, ty, pickMobType());
}

/** Scatters the opening set of bat nests; each attempt is dropped if the spot is taken. */
export function spawnInitialSpawners(level: Level): void {
  for (let i = 0; i < INITIAL_SPAWNERS; i++) {
    tryPlaceSpawner(
      level,
      Math.floor(Math.random() * level.width),
      Math.floor(Math.random() * level.height),
      'bat',
    );
  }
}
