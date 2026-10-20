import { Rectangle } from 'pixi.js';
import { world } from '../world';
import { boxAround } from '../core/geometry';
import type { Level } from '../level/Level';
import { createMob } from '../entities/MobFactory';
import { TileType, TILE_WIDTH } from '../level/TileType';
import { gameState } from '../game/GameState';

const GUARD_AREA = 8 * TILE_WIDTH;
/** Guards stand in a ring around the pile, clear of its base. */
const MIN_RING = 28;
const MAX_RING = 64;
const GUARD_RADIUS = 10;

const mobs = world.with('position', 'ai');
const piles = world.with('position', 'treasure');
const guardBox = new Rectangle();

function guardsNear(x: number, y: number): number {
  let n = 0;
  for (const mob of mobs) {
    if (mob.mobType !== 'pharao' || mob.removed) continue;
    if (Math.abs(mob.position!.x - x) < GUARD_AREA && Math.abs(mob.position!.y - y) < GUARD_AREA) n++;
  }
  return n;
}

function placeGuard(level: Level, x: number, y: number): void {
  for (let attempt = 0; attempt < 30; attempt++) {
    const a = Math.random() * Math.PI * 2;
    const d = MIN_RING + Math.random() * (MAX_RING - MIN_RING);
    const sx = x + Math.cos(a) * d;
    const sy = y + Math.sin(a) * d;
    const tile = level.getTileAt(sx, sy);
    if (!tile || !tile.passable || tile.type === TileType.Hole) continue;
    const body = boxAround(sx, sy, GUARD_RADIUS, GUARD_RADIUS, guardBox);
    if (level.getClipBBs(sx, sy, GUARD_RADIUS, GUARD_RADIUS).some((clip) => clip.intersects(body))) continue;
    createMob(level, 'pharao', sx, sy);
    return;
  }
}

/**
 * The treasure pile is guarded by a fixed number of pharaohs, set by the
 * difficulty and placed once when the level opens. A guard that falls is gone
 * for good, so no pharaoh ever rises again.
 */
export function spawnTreasureGuards(level: Level): void {
  for (const pile of piles) {
    const { x, y } = pile.position!;
    const missing = gameState.difficulty.pharaohs - guardsNear(x, y);
    for (let i = 0; i < missing; i++) placeGuard(level, x, y);
  }
}
