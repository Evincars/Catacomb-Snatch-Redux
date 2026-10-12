import type { Level } from './Level';
import { TileType } from './TileType';

/** rails.png frames. */
export const RAIL_HORIZONTAL = 0;
export const RAIL_VERTICAL = 1;
/** Corner pieces, indexed by which two sides they join. */
const RAIL_CORNER_SOUTH_EAST = 2;
const RAIL_CORNER_SOUTH_WEST = 3;
const RAIL_CORNER_NORTH_EAST = 4;
const RAIL_CORNER_NORTH_WEST = 5;
/** Junction disc where three or four tracks meet. */
export const RAIL_JUNCTION = 6;

const RAIL_TYPES = new Set([TileType.Rail, TileType.UnbreakableRail, TileType.PlayerRail]);

export function isRailTile(level: Level, tx: number, ty: number): boolean {
  const type = level.getTile(tx, ty)?.type;
  return type !== undefined && RAIL_TYPES.has(type);
}

/**
 * Whether the rail at (tx, ty) joins the neighbour one step away. The fixed
 * side rails at a base entrance are upright posts, so they only join vertically.
 */
export function railJoins(level: Level, tx: number, ty: number, dx: number, dy: number): boolean {
  const there = level.getTile(tx + dx, ty + dy);
  if (!there || !RAIL_TYPES.has(there.type)) return false;
  if (dx === 0) return true;
  return there.type !== TileType.UnbreakableRail && level.getTile(tx, ty)?.type !== TileType.UnbreakableRail;
}

/** Frame for an ordinary track piece, chosen from the pieces around it (Java RailTile.neighbourChanged). */
export function railFrameAt(level: Level, tx: number, ty: number): number {
  const n = railJoins(level, tx, ty, 0, -1);
  const s = railJoins(level, tx, ty, 0, 1);
  const w = railJoins(level, tx, ty, -1, 0);
  const e = railJoins(level, tx, ty, 1, 0);
  const count = (n ? 1 : 0) + (s ? 1 : 0) + (w ? 1 : 0) + (e ? 1 : 0);

  if (count <= 1) return n || s ? RAIL_VERTICAL : RAIL_HORIZONTAL;
  if (count >= 3) return RAIL_JUNCTION;
  if (n && s) return RAIL_VERTICAL;
  if (w && e) return RAIL_HORIZONTAL;
  if (n) return e ? RAIL_CORNER_NORTH_EAST : RAIL_CORNER_NORTH_WEST;
  return e ? RAIL_CORNER_SOUTH_EAST : RAIL_CORNER_SOUTH_WEST;
}

/** True when a new piece at (tx, ty) would touch an existing track. */
export function touchesTrack(level: Level, tx: number, ty: number): boolean {
  return (
    railJoins(level, tx, ty, 0, -1) || railJoins(level, tx, ty, 0, 1) ||
    railJoins(level, tx, ty, -1, 0) || railJoins(level, tx, ty, 1, 0)
  );
}
