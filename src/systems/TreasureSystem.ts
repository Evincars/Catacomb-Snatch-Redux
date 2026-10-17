import { world } from '../world';
import type { Level } from '../level/Level';
import { createMob } from '../entities/MobFactory';
import { TileType, TILE_WIDTH } from '../level/TileType';
import { gameState } from '../game/GameState';
import { canSpawnMob } from './SpawnerSystem';

/** Ticks between pharaohs rising from the treasure, before the difficulty's spawn modifier. */
const PHARAOH_INTERVAL = 60 * 15;
/** No more guards than this stand near the pile at once. */
const MAX_GUARDS = 3;
const GUARD_AREA = 8 * TILE_WIDTH;
/** Guards appear in a ring around the pile, clear of its base. */
const MIN_RING = 28;
const MAX_RING = 64;

function guardsNear(x: number, y: number): number {
  let n = 0;
  for (const mob of world.with('position', 'ai')) {
    if (mob.mobType !== 'pharao' || mob.removed) continue;
    if (Math.abs(mob.position!.x - x) < GUARD_AREA && Math.abs(mob.position!.y - y) < GUARD_AREA) n++;
  }
  return n;
}

function spawnGuard(level: Level, x: number, y: number): void {
  for (let attempt = 0; attempt < 12; attempt++) {
    const a = Math.random() * Math.PI * 2;
    const d = MIN_RING + Math.random() * (MAX_RING - MIN_RING);
    const sx = x + Math.cos(a) * d;
    const sy = y + Math.sin(a) * d;
    const tile = level.getTileAt(sx, sy);
    if (!tile || !tile.passable || tile.type === TileType.Hole) continue;
    const r = 10;
    const bb = level.getClipBBs(sx, sy, r, r);
    if (bb.some((c) => c.x0 < sx + r && c.x1 > sx - r && c.y0 < sy + r && c.y1 > sy - r)) continue;
    if (!canSpawnMob(level, 'pharao', sx, sy)) continue;
    createMob(level, 'pharao', sx, sy);
    return;
  }
}

/** The treasure pile at the heart of the catacomb is guarded by pharaohs that keep rising around it. */
export function updateTreasure(level: Level): void {
  for (const pile of world.with('position', 'treasure')) {
    const guard = pile.treasure!;
    if (--guard.timer > 0) continue;
    guard.timer = Math.trunc(PHARAOH_INTERVAL * gameState.difficulty.spawnMod);
    const { x, y } = pile.position!;
    if (guardsNear(x, y) < MAX_GUARDS) spawnGuard(level, x, y);
  }
}
