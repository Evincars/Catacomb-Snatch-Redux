import { world, Team } from '../../world';
import type { Entity } from '../../world';
import type { Level } from '../../level/Level';
import { TileType, TILE_WIDTH, TILE_HEIGHT } from '../../level/TileType';
import { blastHitTiles } from '../../systems/BuildingSystem';
import { BLAST_CLEARANCE, DIRS, INF } from '../constants';
import { centreX, centreY, tileX, tileY } from './geometry';
import { bridgedToRival } from './rails';
import type { Field } from '../types';

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

/**
 * What to blow up next: the spot with the most of the rival's track and machines within reach of one
 * bomb, weighed against the walk. The laid track next to the rival's base is worth most of all: cut
 * there, the rival's carriages cannot get home to deliver, and when our own track has joined theirs, ours
 * carry off the treasure instead. With `cutsOnly` it looks no further than that cut, and only once the
 * two networks are joined.
 */
export function findSabotage(level: Level, entity: Entity, field: Field, cutsOnly = false): SabotageTarget | null {
  const rivalTeam = entity.team === Team.One ? Team.Two : Team.One;
  const bridged = bridgedToRival(level, entity);
  if (cutsOnly && !bridged) return null;
  const spots: Array<{ x: number; y: number; cut: boolean }> = [];
  for (let ty = 0; ty < level.height; ty++) {
    for (let tx = 0; tx < level.width; tx++) {
      const tile = level.getTile(tx, ty);
      if (tile?.type !== TileType.Rail || tile.team !== rivalTeam) continue;
      spots.push({ x: tx, y: ty, cut: linkHome(level, tx, ty, rivalTeam) });
    }
  }
  const machines = cutsOnly ? [] : [...world.with('position', 'health')].filter((e) => !e.removed && e.carriedBy === undefined
    && e.team === rivalTeam && (e.turret !== undefined || e.harvester !== undefined || e.railDroid !== undefined));
  const machineTiles = machines.map((m) => ({ x: tileX(m.position!.x), y: tileY(m.position!.y), cut: false }));
  // One bomb wrecks what lies within about a tile and a half of it.
  const near = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.abs(a.x - b.x) <= 1 && Math.abs(a.y - b.y) <= 1;
  let best: SabotageTarget | null = null;
  let bestScore = -INF;
  for (const spot of cutsOnly ? spots.filter((r) => r.cut) : [...spots, ...machineTiles]) {
    const tile = spot.x + spot.y * level.width;
    const stand = besideWall(level, field, tile);
    if (stand < 0) continue;
    const value = spots.filter((r) => near(r, spot)).length + 4 * machineTiles.filter((m) => near(m, spot)).length
      + (spot.cut ? (bridged ? 40 : 12) : 0);
    // Worth a walk of a few tiles per piece wrecked, but never an expedition for a single rail.
    const score = value * 5 - field.dist[stand];
    if (score > bestScore) {
      bestScore = score;
      best = { tile, stand, value, cut: spot.cut, bridged };
    }
  }
  return best;
}

export function besideWall(level: Level, field: Field, wall: number): number {
  const wx = wall % level.width;
  const wy = (wall - wx) / level.width;
  let best = -1;
  let bestScore = INF;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const tile = level.getTile(wx + dx, wy + dy);
      const t = wx + dx + (wy + dy) * level.width;
      if (!tile?.passable || !Number.isFinite(field.dist[t])) continue;
      // Square to the wall on bare floor is best; the bomb cannot sit on track.
      const score = field.dist[t] + (dx !== 0 && dy !== 0 ? 20 : 0) + (tile.buildable ? 0 : 40);
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }
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

/** A reachable tile outside the actual blast, preferably with extra clearance. */
export function blastCover(level: Level, field: Field, bomb: Entity, needsShot = true): number {
  const bp = bomb.position!;
  const bx = tileX(bp.x);
  const by = tileY(bp.y - (bomb.yOffset ?? 0));
  const reach = Math.ceil(blastHitTiles(bomb.bomb!.blastTiles) - 0.5);
  let best = -1;
  let bestScore = INF;
  for (let ty = by - reach - 6; ty <= by + reach + 6; ty++) {
    for (let tx = bx - reach - 6; tx <= bx + reach + 6; tx++) {
      const clearance = Math.max(Math.abs(tx - bx), Math.abs(ty - by)) - reach;
      if (clearance <= 0) continue;
      if (tx < 0 || ty < 0 || tx >= level.width || ty >= level.height) continue;
      const t = tx + ty * level.width;
      if (!Number.isFinite(field.dist[t])) continue;
      if (needsShot && !level.checkLineOfSight(centreX(tx), centreY(ty), bp.x, bp.y)) continue;
      const score = field.dist[t] + (needsShot ? Math.max(0, BLAST_CLEARANCE - clearance) * 4 : 0);
      if (score < bestScore) {
        best = t;
        bestScore = score;
      }
    }
  }
  return best;
}
