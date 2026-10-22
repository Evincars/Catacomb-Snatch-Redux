import { world, Team } from '../world';
import type { Level } from '../level/Level';
import { TileType, TILE_WIDTH, TILE_HEIGHT } from '../level/TileType';
import { createBuilding } from '../entities/BuildingFactory';
import { tileGraphOf } from '../level/TileGraph';
import { costField } from '../level/TileSearch';
import type { StepCost } from '../level/TileGraph';

/** Treasure chests hidden on every map when it opens, on top of any the map itself places. */
export const HIDDEN_CHESTS = 2;
/** Tiles (on either axis) a hidden chest keeps from either camp, so finding one means going exploring. */
export const CHEST_CAMP_CLEARANCE = 10;
/** Tiles two hidden chests keep apart, so they are not found together. */
const CHEST_SPACING = 8;
/** Tiles kept clear between a chest and any building, stall or nest already there. */
const CHEST_ELBOW_ROOM = 1;

const placed = world.with('position', 'building');
const nests = world.with('position', 'spawner');

type Spot = { tx: number; ty: number };

function tileOfPoint(x: number, y: number): Spot {
  return { tx: Math.floor(x / TILE_WIDTH), ty: Math.floor(y / TILE_HEIGHT) };
}

/** Whether two tiles lie within `reach` of each other on both axes. */
function within(a: Spot, b: Spot, reach: number): boolean {
  return Math.abs(a.tx - b.tx) <= reach && Math.abs(a.ty - b.ty) <= reach;
}

/** Where each camp stands; a map without a second camp has one. */
function camps(level: Level): Spot[] {
  const found: Spot[] = [];
  for (const team of [Team.One, Team.Two]) {
    const spawn = level.getRandomSpawnPoint(team);
    if (spawn) found.push(tileOfPoint(spawn.x, spawn.y));
  }
  return found;
}

/** Tiles the first camp can get to on foot, counting cracked walls as open since a bomb clears them. */
function reachableFrom(level: Level, start: Spot): Float64Array {
  const passable: StepCost = (_from, to) => {
    const tile = level.getTile(to % level.width, Math.floor(to / level.width));
    return tile && (tile.passable || tile.destroyable) ? 1 : Infinity;
  };
  return costField(tileGraphOf(level), [start.tx + start.ty * level.width], passable).dist;
}

/** Nothing already stands on or right beside the tile. */
function crowded(spot: Spot): boolean {
  for (const e of placed) if (!e.removed && within(spot, tileOfPoint(e.position!.x, e.position!.y), CHEST_ELBOW_ROOM)) return true;
  for (const e of nests) if (!e.removed && within(spot, tileOfPoint(e.position!.x, e.position!.y), CHEST_ELBOW_ROOM)) return true;
  return false;
}

/** Plain open floor, away from both camps and from the other chests, that someone can walk to. */
function suitable(level: Level, spot: Spot, camps: readonly Spot[], chosen: readonly Spot[], reach: Float64Array): boolean {
  const tile = level.getTile(spot.tx, spot.ty);
  if (!tile || tile.type !== TileType.Floor || !tile.buildable || level.inBaseArea(spot.tx, spot.ty)) return false;
  if (!Number.isFinite(reach[spot.tx + spot.ty * level.width])) return false;
  if (camps.some((camp) => within(spot, camp, CHEST_CAMP_CLEARANCE))) return false;
  if (chosen.some((other) => within(spot, other, CHEST_SPACING))) return false;
  return !crowded(spot);
}

/**
 * Hides `count` treasure chests at random spots on a freshly opened map: open floor that can be walked
 * to, well away from both camps and from each other. Nobody is told where they are; they are found by
 * exploring (computer players included) and opened with the use key like any chest.
 */
export function scatterChests(level: Level, count = HIDDEN_CHESTS): number {
  const homes = camps(level);
  if (homes.length === 0) return 0;
  const reach = reachableFrom(level, homes[0]);
  const candidates: Spot[] = [];
  for (let ty = 0; ty < level.height; ty++) {
    for (let tx = 0; tx < level.width; tx++) candidates.push({ tx, ty });
  }
  const chosen: Spot[] = [];
  while (chosen.length < count && candidates.length > 0) {
    const [spot] = candidates.splice(Math.floor(Math.random() * candidates.length), 1);
    if (!suitable(level, spot, homes, chosen, reach)) continue;
    chosen.push(spot);
    createBuilding(spot.tx * TILE_WIDTH + TILE_WIDTH / 2, spot.ty * TILE_HEIGHT + TILE_HEIGHT / 2, 'chest');
  }
  return chosen.length;
}
