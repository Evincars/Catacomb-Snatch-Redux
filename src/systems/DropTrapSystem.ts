import { world } from '../world';
import type { Level } from '../level/Level';
import { forEachTile } from '../level/Grid';
import { createTile, TileType, TILE_WIDTH, TILE_HEIGHT } from '../level/TileType';
import type { TileData } from '../level/TileType';

/** A trap cracked this many times has started to collapse, and this crumble step is the last before a hole. */
const COLLAPSING = 3;
const LAST_CRUMBLE = 7;
const COLLAPSE_STEP_TICKS = 5;

const walkers = world.with('position', 'playerInput', 'health');

/** Tiles a living player stands on. */
function occupiedTiles(level: Level): Set<number> {
  const occupied = new Set<number>();
  for (const player of walkers) {
    if (player.removed || player.falling || player.health!.current <= 0) continue;
    occupied.add(Math.floor(player.position!.x / TILE_WIDTH) + Math.floor(player.position!.y / TILE_HEIGHT) * level.width);
  }
  return occupied;
}

/** A collapsing trap crumbles a step every few ticks until it gives way to a hole. */
function collapse(level: Level, tile: TileData, x: number, y: number): void {
  const crumble = tile.crumble ?? 0;
  tile.collapseTicks = Math.max(0, (tile.collapseTicks ?? COLLAPSE_STEP_TICKS) - 1);
  if (tile.collapseTicks > 0) return;
  if (crumble === LAST_CRUMBLE) {
    level.setTile(x, y, createTile(TileType.Hole));
  } else {
    tile.crumble = crumble + 1;
    tile.collapseTicks = COLLAPSE_STEP_TICKS;
  }
  level.tilesDirty = true;
}

/** Stepping onto the trap again (not standing on it) cracks it once more. */
function crack(level: Level, tile: TileData, steppedOn: boolean): void {
  if (steppedOn && !tile.steppedOn) {
    tile.crumble = (tile.crumble ?? 0) + 1;
    tile.collapseTicks = COLLAPSE_STEP_TICKS;
    level.tilesDirty = true;
  }
  tile.steppedOn = steppedOn;
}

/** Each new visit cracks the floor; the third starts its irreversible collapse. */
export function updateDropTraps(level: Level): void {
  const occupied = occupiedTiles(level);
  forEachTile(0, 0, level.width - 1, level.height - 1, (x, y) => {
    const tile = level.getTile(x, y);
    if (tile?.type !== TileType.DropTrap) return;
    if ((tile.crumble ?? 0) >= COLLAPSING) collapse(level, tile, x, y);
    else crack(level, tile, occupied.has(x + y * level.width));
  });
}
