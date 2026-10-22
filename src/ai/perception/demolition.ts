import { world, Team } from '../../world';
import { forEachTile } from '../../level/Grid';
import type { Entity } from '../../world';
import type { Level } from '../../level/Level';
import { TileType, TILE_WIDTH, TILE_HEIGHT } from '../../level/TileType';
import { blastHitTiles } from '../../systems/BuildingSystem';
import { BLAST_CLEARANCE, DIRS, INF, SABOTAGE_WALK_PER_PIECE } from '../constants';
import { centreX, centreY, tileX, tileY } from './geometry';
import { bridgedToRival } from './rails';
import type { Field } from '../types';

const damageable = world.with('position', 'health');
const placedBombs = world.with('position', 'bomb');

/** Something worth a bomb: the tile to blast, where to stand to set it, and what it is worth. */
export type SabotageTarget = {
  tile: number;
  stand: number;
  /** Pieces of the rival's track and machines one bomb there would wreck, counting the link home heavily. */
  value: number;
  /** The laid track joining the rival's base track: cut there, their carriages cannot get home. */
  cut: boolean;
  /** Whether our own track is joined to the rival's, which makes a cut worth far more. */
  bridged: boolean;
};

/** A piece of the rival's laid track touching their base track: the link every carriage of theirs must use. */
function linkHome(level: Level, tx: number, ty: number, rival: Team): boolean {
  return DIRS.some(([dx, dy]) => {
    const there = level.getTile(tx + dx, ty + dy);
    if (!there || (there.type !== TileType.PlayerRail && there.type !== TileType.UnbreakableRail)) return false;
    return there.team === rival || level.inOwnBase(centreX(tx + dx), centreY(ty + dy), rival);
  });
}

type Spot = { x: number; y: number; cut: boolean };

/** Ring of tiles around a tile, as [dx, dy], row by row (the order settles ties). */
const RING = [[-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-1, 1], [0, 1], [1, 1]] as const;

/** Every piece of the rival's laid track, marking the ones that link it to their base. */
function rivalTrack(level: Level, rival: Team): Spot[] {
  const spots: Spot[] = [];
  forEachTile(0, 0, level.width - 1, level.height - 1, (tx, ty) => {
    const tile = level.getTile(tx, ty);
    if (tile?.type === TileType.Rail && tile.team === rival) spots.push({ x: tx, y: ty, cut: linkHome(level, tx, ty, rival) });
  });
  return spots;
}

/** Tiles of the rival's turrets, harvesters and carriages. */
function rivalMachines(rival: Team): Spot[] {
  const tiles: Spot[] = [];
  for (const e of damageable) {
    if (e.removed || e.carriedBy !== undefined || e.team !== rival) continue;
    if (e.turret || e.harvester || e.railDroid) tiles.push({ x: tileX(e.position!.x), y: tileY(e.position!.y), cut: false });
  }
  return tiles;
}

/** How many of `spots` one bomb at `at` would wreck: everything within about a tile and a half. */
function countNear(spots: readonly Spot[], at: Spot): number {
  let count = 0;
  for (const spot of spots) if (Math.abs(spot.x - at.x) <= 1 && Math.abs(spot.y - at.y) <= 1) count++;
  return count;
}

/**
 * What to blow up next: the spot with the most of the rival's track and machines within reach of one
 * bomb, weighed against the walk. The laid track next to the rival's base is worth most of all: cut
 * there, the rival's carriages cannot get home to deliver, and when our own track has joined theirs, ours
 * carry off the treasure instead. With `cutsOnly` it looks no further than that cut, and only once the
 * two networks are joined.
 */
export function findSabotage(level: Level, entity: Entity, field: Field, cutsOnly = false,
  walkPerPiece = SABOTAGE_WALK_PER_PIECE): SabotageTarget | null {
  const rivalTeam = entity.team === Team.One ? Team.Two : Team.One;
  const bridged = bridgedToRival(level, entity);
  if (cutsOnly && !bridged) return null;
  const track = rivalTrack(level, rivalTeam);
  const machines = cutsOnly ? [] : rivalMachines(rivalTeam);
  const candidates = cutsOnly ? track.filter((r) => r.cut) : [...track, ...machines];
  let best: SabotageTarget | null = null;
  let bestScore = -INF;
  for (const spot of candidates) {
    const tile = spot.x + spot.y * level.width;
    const stand = besideWall(level, field, tile);
    if (stand < 0) continue;
    const value = countNear(track, spot) + 4 * countNear(machines, spot) + (spot.cut ? (bridged ? 40 : 12) : 0);
    // Worth a walk of a few tiles per piece wrecked; only a saboteur makes an expedition of it.
    const score = value * walkPerPiece - field.dist[stand];
    if (score <= bestScore) continue;
    bestScore = score;
    best = { tile, stand, value, cut: spot.cut, bridged };
  }
  return best;
}

/** Where to stand to set a bomb against `wall`: square to it on bare floor is best; the bomb cannot sit on track. */
export function besideWall(level: Level, field: Field, wall: number): number {
  const wx = wall % level.width;
  const wy = (wall - wx) / level.width;
  let best = -1;
  let bestScore = INF;
  for (const [dx, dy] of RING) {
    const tile = level.getTile(wx + dx, wy + dy);
    const t = wx + dx + (wy + dy) * level.width;
    if (!tile?.passable || !Number.isFinite(field.dist[t])) continue;
    const score = field.dist[t] + (dx !== 0 && dy !== 0 ? 20 : 0) + (tile.buildable ? 0 : 40);
    if (score >= bestScore) continue;
    bestScore = score;
    best = t;
  }
  return best;
}

export function clearOfBlast(entity: Entity, bomb: Entity): boolean {
  const bx = tileX(bomb.position!.x);
  const by = tileY(bomb.position!.y - (bomb.yOffset ?? 0));
  const reach = bomb.bomb!.blastTiles;
  const r = entity.radius ?? { x: 10, y: 10 };
  return Math.abs(entity.position!.x - centreX(bx)) >= blastHitTiles(reach) * TILE_WIDTH + r.x
    || Math.abs(entity.position!.y - centreY(by)) >= blastHitTiles(reach) * TILE_HEIGHT + r.y;
}

/** A lit bomb lying on the floor whose blast would catch the entity where it stands, if any. */
export function threateningBomb(entity: Entity): Entity | undefined {
  for (const b of placedBombs) {
    if (!b.removed && b.carriedBy === undefined && b.bomb!.lit && !clearOfBlast(entity, b)) return b;
  }
  return undefined;
}

/** Tiles searched around a bomb, beyond its blast, for cover. */
const COVER_SEARCH = 6;

/** A reachable tile outside the actual blast, preferably with extra clearance. */
export function blastCover(level: Level, field: Field, bomb: Entity, needsShot = true): number {
  const bp = bomb.position!;
  const bx = tileX(bp.x);
  const by = tileY(bp.y - (bomb.yOffset ?? 0));
  const reach = Math.ceil(blastHitTiles(bomb.bomb!.blastTiles) - 0.5);
  const span = reach + COVER_SEARCH;
  let best = -1;
  let bestScore = INF;
  const x0 = Math.max(0, bx - span);
  const y0 = Math.max(0, by - span);
  const x1 = Math.min(level.width - 1, bx + span);
  const y1 = Math.min(level.height - 1, by + span);
  forEachTile(x0, y0, x1, y1, (tx, ty) => {
    const clearance = Math.max(Math.abs(tx - bx), Math.abs(ty - by)) - reach;
    const t = tx + ty * level.width;
    if (clearance <= 0 || !Number.isFinite(field.dist[t])) return;
    if (needsShot && !level.checkLineOfSight(centreX(tx), centreY(ty), bp.x, bp.y)) return;
    const score = field.dist[t] + (needsShot ? Math.max(0, BLAST_CLEARANCE - clearance) * 4 : 0);
    if (score >= bestScore) return;
    best = t;
    bestScore = score;
  });
  return best;
}
