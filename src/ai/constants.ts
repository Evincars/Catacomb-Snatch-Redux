import { TileType, TILE_WIDTH } from '../level/TileType';

/** Distances, in pixels, at which guns are compared. */
export const RANGE_BANDS = [32, 80, 140, 200, 260];

/** Ticks a goal may take before it is dropped as unreachable. */
export const GOAL_TIMEOUT = 60 * 25;

/** Ticks an entity that could not be reached is ignored for. */
export const BLACKLIST_TICKS = 60 * 20;

/** Ticks of no progress before trying to sidestep. */
export const STUCK_TICKS = 24;

/** Walking this long without getting JAM_DISTANCE anywhere means the way is blocked. */
export const JAM_TICKS = 100;

export const JAM_DISTANCE = 24;

export const JAM_AVOID_TICKS = 60 * 15;

/** Ticks between weapon swaps, so it does not flick through the inventory. */
export const SWAP_DELAY = 40;

/** How far loot may lie, in walking pixels, for a detour to pick it up. */
export const LOOT_DETOUR = 7 * TILE_WIDTH;

/** Nests this close to the spawn or the head of the track get cleared out. */
export const NEST_CLEAR_RANGE = 10 * TILE_WIDTH;

/** Coins worth a long walk (carriage emeralds, chest hoards). */
export const RICH_LOOT = 100;

export const RICH_LOOT_DETOUR = 22 * TILE_WIDTH;

/** Carriage's treasure reach (Java's getBB().grow(32)) and body size. */
export const TREASURE_REACH = 32;

export const CARRIAGE_RADIUS = { x: 10, y: 8 };

export const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;

/** Planner cost of a cracked wall in the way, in tiles of track. */
export const BLAST_STEP = 3;

/** Tiles (on either axis) to keep between itself and a bomb it is about to set off. */
export const BLAST_CLEARANCE = 3;

/** Laid track that earns it a stop to save for an upgrade, how long into the match, and how long it will save. */
export const RAILS_PER_UPGRADE = 5;

export const UPGRADE_AFTER = 60 * 45;

export const UPGRADE_SAVE_TICKS = 60 * 60;

/** A walkable area this small, with nothing to hunt in it, means it has boxed itself in with its own buildings. */
export const TRAPPED_TILES = 80;

/** So few tiles that it cannot be anything but its own buildings hemming it in, fight or no fight. */
export const WALLED_IN_TILES = 6;

export const BASE_DEFENSE_RANGE = 7 * TILE_WIDTH;

/** Uncovered tiles of laid track that call for a turret of their own. */
export const GUARD_SPAN = 4;

export const CARRIAGE_DELAY = 60 * 10;

export const INF = Number.POSITIVE_INFINITY;

export const RAIL_TYPES = new Set([TileType.Rail, TileType.UnbreakableRail, TileType.PlayerRail]);

/** Ticks a direction key is held before it may swap to the opposite one. */
export const FLIP_TICKS = 8;

/** Coins an upgrade may cost for each point of newly covered ground. */
export const COINS_PER_POINT = 40;
