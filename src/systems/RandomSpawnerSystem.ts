import { world } from '../world';
import type { Level } from '../level/Level';
import { TileType, TILE_WIDTH, TILE_HEIGHT } from '../level/TileType';
import { createSpawner } from '../entities/SpawnerFactory';
import { gameState } from '../game/GameState';

const nests = world.with('spawner');
const players = world.with('position', 'playerInput');
const placedNests = world.with('position', 'spawner');
const turrets = world.with('position', 'turret');
const buildings = world.with('position', 'building');
const stalls = world.with('position', 'shopItem');

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

/** Every kind nests regularly; bats are simply the most common. */
const MOB_WEIGHTS: ReadonlyArray<readonly [string, number]> = [
  ['bat', 4],
  ['snake', 3],
  ['mummy', 3],
  ['scarab', 3],
];
/** Picks the kind furthest below its share of the live nests, so every kind keeps turning up. */
function pickMobType(): string {
  const counts = new Map<string, number>();
  for (const nest of nests) {
    if (nest.removed || (nest.health?.current ?? 1) <= 0) continue;
    counts.set(nest.spawner!.mobType, (counts.get(nest.spawner!.mobType) ?? 0) + 1);
  }
  let best: string[] = [];
  let bestFill = Infinity;
  for (const [type, weight] of MOB_WEIGHTS) {
    const fill = (counts.get(type) ?? 0) / weight;
    if (fill < bestFill - 1e-9) {
      bestFill = fill;
      best = [type];
    } else if (Math.abs(fill - bestFill) < 1e-9) best.push(type);
  }
  return best[Math.floor(Math.random() * best.length)];
}

/** Java checks an axis-aligned box of radius `r` against each entity's own box. */
function near(e: { position?: { x: number; y: number }; radius?: { x: number; y: number } }, x: number, y: number, r: number): boolean {
  const p = e.position!;
  const er = e.radius ?? { x: 0, y: 0 };
  return Math.abs(p.x - x) < r + er.x && Math.abs(p.y - y) < r + er.y;
}

function surroundingsClear(x: number, y: number): boolean {
  for (const e of players) {
    if (near(e, x, y, CLEAR_OF_PLAYERS_AND_SPAWNERS)) return false;
  }
  for (const e of placedNests) {
    if (near(e, x, y, CLEAR_OF_PLAYERS_AND_SPAWNERS)) return false;
  }
  for (const e of turrets) {
    if (near(e, x, y, CLEAR_OF_TURRETS)) return false;
  }
  for (const e of buildings) {
    if (near(e, x, y, CLEAR_OF_BUILDINGS)) return false;
  }
  for (const e of stalls) {
    if (near(e, x, y, CLEAR_OF_BUILDINGS)) return false;
  }
  return true;
}

function liveSpawners(): number {
  return [...nests].filter((s) => !s.removed && (s.health?.current ?? 1) > 0).length;
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

/** Scatters opening nests of every kind until half the nest cap is reached or no clear spot is found. */
export function spawnInitialSpawners(level: Level): void {
  const target = Math.ceil(gameState.difficulty.maxSpawners / 2);
  for (let i = 0; i < INITIAL_ATTEMPTS && liveSpawners() < target; i++) {
    tryPlaceSpawner(
      level,
      Math.floor(Math.random() * level.width),
      Math.floor(Math.random() * level.height),
      pickMobType(),
    );
  }
}
