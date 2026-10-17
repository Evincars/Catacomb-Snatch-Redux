import { world } from '../world';
import type { Level } from '../level/Level';
import { TileType, TILE_WIDTH, TILE_HEIGHT } from '../level/TileType';
import { createSpawner } from '../entities/SpawnerFactory';
import { gameState } from '../game/GameState';

/**
 * Replenishes a bounded set of nests, checking one floor tile every second.
 */
const EDGE_MARGIN = 8;
const CLEAR_OF_PLAYERS_AND_SPAWNERS = 32 * 8;
const CLEAR_OF_TURRETS = 32 * 4;
const CLEAR_OF_BUILDINGS = 32 * 0.5;
/** Upper bound on opening placement attempts while seeding half the nest cap. */
const INITIAL_ATTEMPTS = 500;
const ATTEMPT_INTERVAL = 60;
const nextAttempt = new WeakMap<Level, number>();

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

function liveSpawners(): number {
  return [...world.with('spawner')].filter((s) => !s.removed && (s.health?.current ?? 1) > 0).length;
}

function tryPlaceSpawner(level: Level, tx: number, ty: number, mobType: string): void {
  if (liveSpawners() >= gameState.difficulty.maxSpawners) return;
  const tile = level.getTile(tx, ty);
  if (!tile || tile.type !== TileType.Floor || !tile.buildable) return;

  const x = tx * TILE_WIDTH + TILE_WIDTH / 2;
  const y = ty * TILE_HEIGHT + TILE_HEIGHT / 2 - 4;
  for (const team of [1, 2]) {
    const spawn = level.getRandomSpawnPoint(team);
    if (spawn && Math.hypot(spawn.x - x, spawn.y - y) < CLEAR_OF_PLAYERS_AND_SPAWNERS) return;
  }
  if (!surroundingsClear(x, y)) return;

  createSpawner(x, y, mobType);
}

export function updateRandomSpawner(level: Level): void {
  const ticks = (nextAttempt.get(level) ?? ATTEMPT_INTERVAL) - 1;
  nextAttempt.set(level, ticks > 0 ? ticks : ATTEMPT_INTERVAL);
  if (ticks > 0) return;
  const tx = Math.floor(Math.random() * (level.width - EDGE_MARGIN * 2)) + EDGE_MARGIN;
  const ty = Math.floor(Math.random() * (level.height - EDGE_MARGIN * 2)) + EDGE_MARGIN;
  tryPlaceSpawner(level, tx, ty, pickMobType());
}

/** Scatters opening bat nests until half the nest cap is reached or no clear spot is found. */
export function spawnInitialSpawners(level: Level): void {
  const target = Math.ceil(gameState.difficulty.maxSpawners / 2);
  for (let i = 0; i < INITIAL_ATTEMPTS && liveSpawners() < target; i++) {
    tryPlaceSpawner(
      level,
      Math.floor(Math.random() * level.width),
      Math.floor(Math.random() * level.height),
      'bat',
    );
  }
}
