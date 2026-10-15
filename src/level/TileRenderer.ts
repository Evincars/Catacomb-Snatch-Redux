import { Container, Graphics } from 'pixi.js';
import { CompositeTilemap } from '@pixi/tilemap';
import type { Level } from './Level';
import { TileType, TILE_WIDTH, TILE_HEIGHT } from './TileType';
import { RAIL_HORIZONTAL, RAIL_VERTICAL, isRailTile, railJoins, railFrameAt } from './RailLayout';
import { getTexture } from '../assets/AssetLoader';
import { Team } from '../world';
import { gameState } from '../game/GameState';
import { frameTexture } from '../render/Sheets';
import { createAnimatedVisual } from '../render/AnimatedVisual';

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
  const character = team === Team.One || gameState.multiplayerMode === 'enemy' ? gameState.selectedCharacter : null;
  const stem = character ? BASE_STEMS[character] : 'no_opponent';
  return `start_${stem}_${side}`;
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
  const character = team === Team.One || gameState.multiplayerMode === 'enemy' ? gameState.selectedCharacter : null;
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

/** Batches terrain with tilemap; moving actors and walls keep their own depth sorting. */
export function buildLevelView(level: Level): Container {
  const container = new Container();
  const holes = new Graphics();
  const floors = new CompositeTilemap([getTexture('floortiles').source]);
  const traps = new Container();
  const rails = new CompositeTilemap([getTexture('rails').source]);
  const bases = new CompositeTilemap();
  container.addChild(holes, floors, traps, rails, bases);

  // Floors first so wall overhang draws on top of them.
  for (let ty = 0; ty < level.height; ty++) {
    for (let tx = 0; tx < level.width; tx++) {
      const tile = level.getTile(tx, ty);
      if (!tile || tile.type === TileType.Wall) continue;

      if (tile.type === TileType.DropTrap) {
        const row = level.getTile(tx, ty - 1)?.type === TileType.Hole ? 0 : 1;
        const s = createAnimatedVisual('droptrap', tile.crumble ?? 0, row);
        s.x = tx * TILE_WIDTH;
        s.y = ty * TILE_HEIGHT;
        traps.addChild(s);
        continue;
      }
      const above = level.getTile(tx, ty - 1);
      const img = tile.type === TileType.Floor
        ? sandEdgeImage(level, tx, ty) ?? floorImageIndex(tile.type, tile.imageVariant)
        : tile.type === TileType.Hole && above?.type === TileType.Sand ? 7
        : floorImageIndex(tile.type, tile.imageVariant);
      const interiorHole = tile.type === TileType.Hole && above?.type === TileType.Hole;
      if (interiorHole) {
        holes.rect(tx * TILE_WIDTH, ty * TILE_HEIGHT, TILE_WIDTH, TILE_HEIGHT).fill(0x000000);
      } else {
        floors.tile(getTexture('floortiles'), tx * TILE_WIDTH, ty * TILE_HEIGHT, {
          u: (img % FLOOR_COLS) * TILE_WIDTH,
          v: Math.floor(img / FLOOR_COLS) * TILE_HEIGHT,
          tileWidth: TILE_WIDTH,
          tileHeight: TILE_HEIGHT,
        });
      }
    }
  }

  // Rails sit on top of the floor.
  for (let ty = 0; ty < level.height; ty++) {
    for (let tx = 0; tx < level.width; tx++) {
      const tile = level.getTile(tx, ty);
      if (!tile || !isRailTile(level, tx, ty)) continue;

      rails.tile(frameTexture('rails', railFrame(level, tx, ty), 0),
        tx * TILE_WIDTH, ty * TILE_HEIGHT - RAIL_RISE);
    }
  }

  // Spawn platform art sits above the floor, below base pieces.
  for (const sp of level.spawnTiles) {
    const sheet = spawnSheet(sp.team);
    const col = sp.img % 4;
    const row = Math.floor(sp.img / 4);
    bases.tile(frameTexture(sheet, col, row),
      sp.tileX * TILE_WIDTH + sp.offsetX, sp.tileY * TILE_HEIGHT);
  }

  // Player base platforms sit above the floor but below walls.
  for (const base of level.baseTiles) {
    const sheet = baseSheet(base.team, base.side);
    bases.tile(frameTexture(sheet, base.img % 2, Math.floor(base.img / 2)),
      base.tileX * TILE_WIDTH, base.tileY * TILE_HEIGHT);
  }

  return container;
}
