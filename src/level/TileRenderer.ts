import { Container, Graphics } from 'pixi.js';
import type { Level } from './Level';
import { forEachTile } from './Grid';
import { TileType, TILE_WIDTH, TILE_HEIGHT } from './TileType';
import type { TileData } from './TileType';
import { RAIL_HORIZONTAL, RAIL_VERTICAL, isRailTile, railJoins, railFrameAt } from './RailLayout';
import { Team } from '../world';
import { gameState } from '../game/GameState';
import { frameTexture } from '../render/Sheets';
import { createAnimatedVisual } from '../render/AnimatedVisual';
import { StaticTileLayer } from '../render/StaticTileLayer';

const FLOOR_COLS = 8;

/** Rail art is 38px tall: the top 6px stand up over the tile above. */
const RAIL_HEIGHT = 38;
const RAIL_RISE = RAIL_HEIGHT - TILE_HEIGHT;

/** Dead-end loop of a base whose exit points north (team 1): left half, right half. */
const RAIL_LOOP_UP = [4, 5];
/** Dead-end loop of a base whose exit points south (team 2). */
const RAIL_LOOP_DOWN = [2, 3];

/** Stone floor with sand blown over one edge: north, east, south, west. */
const SAND_EDGE_NORTH = 8;
const SAND_EDGE_EAST = 9;
const SAND_EDGE_SOUTH = 10;
const SAND_EDGE_WEST = 11;

/**
 * Index into floortiles.png, matching Java's Tile.img:
 * floor variants 0-3, hole 4, sand 5, unpassable sand 6.
 */
function floorImageIndex(type: TileType, variant: number): number {
  switch (type) {
    case TileType.Hole:           return 4;
    case TileType.Sand:           return 5;
    case TileType.PlayerBase:     return 5;
    case TileType.PlayerRail:     return 5;
    case TileType.Barrier:        return 5;
    case TileType.UnpassableSand: return 6;
    default:                      return variant & 3;
  }
}

/**
 * Each team's base is drawn with the base art of the character playing it.
 * Team 2 is unused in single player, so it gets the neutral "no opponent" art.
 */
function baseSheet(team: Team, side: 'left' | 'right'): string {
  const character = teamCharacter(team);
  const stem = character ? BASE_STEMS[character] : 'no_opponent';
  return `start_${stem}_${side}`;
}

/** Who plays a team's base: the chosen character, the computer's, or nobody. */
function teamCharacter(team: Team): string | null {
  if (team === Team.One || gameState.multiplayerMode === 'enemy') return gameState.selectedCharacter;
  return gameState.opponent === 'ai' ? gameState.aiCharacter : null;
}

const BASE_STEMS: Record<string, string> = {
  lord_lard: 'lordlard',
  herr_von_speck: 'herrspeck',
  duchess_donut: 'donut',
  countess_cruller: 'cruller',
};

const SPAWN_SHEET_KEYS: Record<string, string> = {
  lord_lard: 'start_lordlard',
  herr_von_speck: 'start_herrspeck',
  duchess_donut: 'start_donut',
  countess_cruller: 'start_cruller',
};

function spawnSheet(team: Team): string {
  const character = teamCharacter(team);
  return character ? (SPAWN_SHEET_KEYS[character] ?? 'start_no_opponent') : 'start_no_opponent';
}

const SANDY = new Set([
  TileType.Sand,
  TileType.UnpassableSand,
  TileType.PlayerBase,
  TileType.PlayerRail,
  TileType.Barrier,
]);

function isSandy(level: Level, tx: number, ty: number): boolean {
  const tile = level.getTile(tx, ty);
  return tile !== null && SANDY.has(tile.type);
}

/** Frame of a stone floor tile bordering sand, so the two blend instead of meeting in a hard line. */
function sandEdgeImage(level: Level, tx: number, ty: number): number | null {
  if (isSandy(level, tx, ty + 1)) return SAND_EDGE_SOUTH;
  if (isSandy(level, tx, ty - 1)) return SAND_EDGE_NORTH;
  if (isSandy(level, tx + 1, ty)) return SAND_EDGE_EAST;
  if (isSandy(level, tx - 1, ty)) return SAND_EDGE_WEST;
  return null;
}

/** Picks the rails.png frame for a rail piece from the pieces around it. */
function railFrame(level: Level, tx: number, ty: number): number {
  const tile = level.getTile(tx, ty)!;

  if (tile.type === TileType.PlayerRail) {
    const isLeft = !isRailTile(level, tx - 1, ty);
    const isRight = !isRailTile(level, tx + 1, ty);
    const loop = tile.team === Team.Two ? RAIL_LOOP_DOWN : RAIL_LOOP_UP;
    if (isLeft) return loop[0];
    if (isRight) return loop[1];
    return RAIL_HORIZONTAL;
  }

  // Fixed side rails are upright posts that never join sideways.
  if (tile.type === TileType.UnbreakableRail) {
    return railJoins(level, tx, ty, 0, -1) || railJoins(level, tx, ty, 0, 1) ? RAIL_VERTICAL : RAIL_HORIZONTAL;
  }
  return railFrameAt(level, tx, ty);
}

/** Floor art for a tile: a sand-blended edge, the dark rim of a pit under sand, or the plain variant. */
function floorImage(level: Level, tx: number, ty: number, tile: TileData): number {
  if (tile.type === TileType.Floor) return sandEdgeImage(level, tx, ty) ?? floorImageIndex(tile.type, tile.imageVariant);
  if (tile.type === TileType.Hole && level.getTile(tx, ty - 1)?.type === TileType.Sand) return 7;
  return floorImageIndex(tile.type, tile.imageVariant);
}

type TerrainLayers = { holes: Graphics; floors: StaticTileLayer; traps: Container; rails: StaticTileLayer; bases: StaticTileLayer };

/** One tile of ground: a crumbling trap, the black inside of a pit, or a floor frame. */
function drawGround(level: Level, layers: TerrainLayers, tx: number, ty: number): void {
  const tile = level.getTile(tx, ty);
  if (!tile || tile.type === TileType.Wall) return;
  const x = tx * TILE_WIDTH;
  const y = ty * TILE_HEIGHT;
  if (tile.type === TileType.DropTrap) {
    const row = level.getTile(tx, ty - 1)?.type === TileType.Hole ? 0 : 1;
    const trap = createAnimatedVisual('droptrap', tile.crumble ?? 0, row);
    trap.position.set(x, y);
    layers.traps.addChild(trap);
    return;
  }
  if (tile.type === TileType.Hole && level.getTile(tx, ty - 1)?.type === TileType.Hole) {
    layers.holes.rect(x, y, TILE_WIDTH, TILE_HEIGHT).fill(0x000000);
    return;
  }
  const img = floorImage(level, tx, ty, tile);
  layers.floors.addTile(frameTexture('floortiles', img % FLOOR_COLS, Math.floor(img / FLOOR_COLS)), x, y);
}

function drawRail(level: Level, layers: TerrainLayers, tx: number, ty: number): void {
  if (!level.getTile(tx, ty) || !isRailTile(level, tx, ty)) return;
  layers.rails.addTile(frameTexture('rails', railFrame(level, tx, ty), 0), tx * TILE_WIDTH, ty * TILE_HEIGHT - RAIL_RISE);
}

/** Spawn platforms sit above the floor, below base pieces; base platforms above the floor but below walls. */
function drawBases(level: Level, layers: TerrainLayers): void {
  for (const sp of level.spawnTiles) {
    const texture = frameTexture(spawnSheet(sp.team), sp.img % 4, Math.floor(sp.img / 4));
    layers.bases.addTile(texture, sp.tileX * TILE_WIDTH + sp.offsetX, sp.tileY * TILE_HEIGHT);
  }
  for (const base of level.baseTiles) {
    const texture = frameTexture(baseSheet(base.team, base.side), base.img % 2, Math.floor(base.img / 2));
    layers.bases.addTile(texture, base.tileX * TILE_WIDTH, base.tileY * TILE_HEIGHT);
  }
}

/**
 * Batches the static terrain into Pixi v8 ParticleContainers (see StaticTileLayer); moving actors and
 * walls keep their own depth-sorted sprites. Floors come first so wall overhang draws over them, and
 * rails sit on top of the floor.
 */
export function buildLevelView(level: Level): Container {
  const container = new Container();
  const layers: TerrainLayers = {
    holes: new Graphics(),
    floors: new StaticTileLayer(),
    traps: new Container(),
    rails: new StaticTileLayer(),
    bases: new StaticTileLayer(),
  };
  container.addChild(layers.holes, layers.floors, layers.traps, layers.rails, layers.bases);
  const right = level.width - 1;
  const bottom = level.height - 1;
  forEachTile(0, 0, right, bottom, (tx, ty) => drawGround(level, layers, tx, ty));
  forEachTile(0, 0, right, bottom, (tx, ty) => drawRail(level, layers, tx, ty));
  drawBases(level, layers);
  return container;
}
