import { world, Team } from '../../world';
import type { Entity } from '../../world';
import type { Level } from '../../level/Level';
import { TileType } from '../../level/TileType';
import type { TileData } from '../../level/TileType';
import { railJoins } from '../../level/RailLayout';
import { forEachTile } from '../../level/Grid';
import { tileGraphOf } from '../../level/TileGraph';
import type { StepCost } from '../../level/TileGraph';
import { findRouteToAny } from '../../level/TileSearch';
import { isVersus } from '../../game/GameState';
import type { AIDifficulty } from '../../game/GameState';
import { INTERACT_REACH } from '../../systems/TargetingSystem';
import { canSpawnRailDroid } from '../../systems/RailDroidSystem';
import { turretRadiusAt } from '../../entities/BuildingFactory';
import { BASE_DEFENSE_RANGE, BLAST_STEP, CARRIAGE_RADIUS, DIRS, INF, RAIL_TYPES, TREASURE_REACH } from '../constants';
import { ownBuildings, treasureOf } from './economy';
import { alive, centreX, centreY, dist, tileAt, tileX, tileY } from './geometry';
import { obstacles } from './navigation';
import type { Field } from '../types';

const carriages = world.with('railDroid');
const placed = world.with('position');

type Point = { x: number; y: number };

/** Tiny extra cost per step that keeps planned lines straight, which reads better and confuses carriages less. */
const STRAIGHTNESS = 0.001;
/** Rival laid track to join: far cheaper than a line of our own, and our carriages then collect from it. */
const RIVAL_TRACK_STEP = 0.4;

export function treasureReachTiles(level: Level, treasure: Entity): Set<number> {
  const result = new Set<number>();
  const p = treasure.position!;
  const r = treasure.radius ?? { x: 10, y: 10 };
  const reachX = CARRIAGE_RADIUS.x + TREASURE_REACH + r.x - 2;
  const reachY = CARRIAGE_RADIUS.y + TREASURE_REACH + r.y - 2;
  forEachTile(tileX(p.x - reachX), tileY(p.y - reachY), tileX(p.x + reachX), tileY(p.y + reachY), (tx, ty) => {
    const within = Math.abs(centreX(tx) - p.x) < reachX && Math.abs(centreY(ty) - p.y) < reachY;
    if (within && level.getTile(tx, ty)) result.add(tx + ty * level.width);
  });
  return result;
}

/** Tiles of a team's base track, where every line it lays starts. */
function baseTrack(level: Level, team: Team): number[] {
  const tiles: number[] = [];
  for (let t = 0; t < level.width * level.height; t++) {
    const tile = tileAt(level, t);
    if (tile?.type === TileType.PlayerRail && tile.team === team) tiles.push(t);
  }
  return tiles;
}

/** Planner cost of track that is already down: free if ours, cheap to join if the rival laid it in versus play. */
function existingTrackStep(tile: TileData, team: Team): number {
  if (tile.team === undefined || tile.team === team) return 0;
  // The rival's base track is theirs and stays off limits.
  if (!isVersus()) return 0;
  return tile.type === TileType.Rail ? RIVAL_TRACK_STEP : INF;
}

/** What the track planner pays to run the line onto a tile. */
function railStep(level: Level, team: Team, blocked: ReadonlySet<number>, t: number): number {
  const tile = tileAt(level, t);
  if (!tile) return INF;
  if (RAIL_TYPES.has(tile.type)) return existingTrackStep(tile, team);
  const tx = t % level.width;
  if (level.inBaseArea(tx, (t - tx) / level.width)) return INF;
  // A cracked wall can be blasted open, at the price of a bomb.
  if (tile.destroyable) return BLAST_STEP;
  return tile.buildable && !blocked.has(t) ? 1 : INF;
}

/** The original's fixed track only joins up and down. */
function sidewaysOffFixedTrack(level: Level, from: number, to: number): boolean {
  if (Math.abs(to - from) !== 1) return false;
  return tileAt(level, from)?.type === TileType.UnbreakableRail || tileAt(level, to)?.type === TileType.UnbreakableRail;
}

/** Tiles of track still to be laid, in order from the base, or null when there is no way through. */
export function planRails(level: Level, team: Team): number[] | null {
  const treasure = treasureOf();
  if (!treasure) return null;
  const { blocked } = obstacles(level);
  const step: StepCost = (from, to) => {
    if (sidewaysOffFixedTrack(level, from, to)) return INF;
    return railStep(level, team, blocked, to) + STRAIGHTNESS;
  };
  const route = findRouteToAny(tileGraphOf(level), baseTrack(level, team), treasureReachTiles(level, treasure), step);
  if (route.length === 0) return null;
  return route.filter((t) => !RAIL_TYPES.has(tileAt(level, t)!.type));
}

/** Laid track of this team that a walker can reach, as tile centres. */
function reachableTrack(level: Level, entity: Entity, field: Field): Point[] {
  const points: Point[] = [];
  for (let t = 0; t < level.width * level.height; t++) {
    const tile = tileAt(level, t);
    if (!tile || !RAIL_TYPES.has(tile.type) || tile.team !== entity.team || !Number.isFinite(field.dist[t])) continue;
    points.push({ x: centreX(t % level.width), y: centreY(Math.floor(t / level.width)) });
  }
  return points;
}

/** How many of `points` a turret at `at` would cover in clear sight. */
function coverageAt(level: Level, at: Point, points: readonly Point[], reach: number): number {
  let count = 0;
  for (const p of points) if (dist(at, p) <= reach && level.checkLineOfSight(at.x, at.y, p.x, p.y)) count++;
  return count;
}

/**
 * Laid track of ours beyond the home defences that no turret of ours covers: its
 * length in tiles and the stretch farthest from home, where the next turret goes.
 */
export function unguardedTrack(level: Level, entity: Entity, field: Field): { x: number; y: number; count: number } | null {
  const home = level.getRandomSpawnPoint(entity.team ?? Team.Two);
  if (!home) return null;
  const turrets = ownBuildings(entity, 'defense').filter((b) => b.turret && alive(b) && b.carriedBy === undefined);
  const covered = (p: Point) => turrets.some((b) => dist(b.position!, p) < b.turret!.radius * 0.85
    && level.checkLineOfSight(b.position!.x, b.position!.y, p.x, p.y));
  const open = reachableTrack(level, entity, field).filter((p) => dist(p, home) > BASE_DEFENSE_RANGE && !covered(p));
  if (open.length === 0) return null;
  // The post goes where one turret covers the most bare track in clear sight (a bend or a junction beats
  // a long straight), and among equals the farthest from home, where the line is thinnest.
  const reach = turretRadiusAt(1) * 0.85;
  let best = open[0];
  let bestScore = -INF;
  for (const a of open) {
    const score = coverageAt(level, a, open, reach) * 100 + dist(a, home) / 10;
    if (score <= bestScore) continue;
    bestScore = score;
    best = a;
  }
  return { ...best, count: open.length };
}

/** Track, or a tile touching it, where anything set down would hold up carriages. */
export function besideTrack(level: Level, t: number): boolean {
  if (onTrack(level, t)) return true;
  const tx = t % level.width;
  const ty = (t - tx) / level.width;
  for (const [dx, dy] of DIRS) {
    const nx = tx + dx;
    const ny = ty + dy;
    if (nx >= 0 && ny >= 0 && nx < level.width && ny < level.height && onTrack(level, nx + ny * level.width)) return true;
  }
  return false;
}

export function onTrack(level: Level, t: number): boolean {
  const type = tileAt(level, t)?.type;
  return type === TileType.Rail || type === TileType.PlayerRail || type === TileType.UnbreakableRail;
}

/**
 * Floods along joined track from a team's base track. `follow` says whether the flood may continue onto a
 * joined tile; `stop` ends the flood early (and makes it return true) when a joined tile settles the question.
 */
function floodTrack(
  level: Level,
  team: Team,
  follow: (tile: TileData) => boolean,
  stop: (tile: TileData) => boolean = () => false,
): { reached: Set<number>; order: number[]; stopped: boolean } {
  const order = baseTrack(level, team);
  const reached = new Set(order);
  for (let i = 0; i < order.length; i++) {
    if (spreadAlongTrack(level, order[i], reached, order, follow, stop)) return { reached, order, stopped: true };
  }
  return { reached, order, stopped: false };
}

/** One step of floodTrack: queues the joined neighbours of `t`; true as soon as one of them meets `stop`. */
function spreadAlongTrack(
  level: Level,
  t: number,
  reached: Set<number>,
  order: number[],
  follow: (tile: TileData) => boolean,
  stop: (tile: TileData) => boolean,
): boolean {
  const x = t % level.width;
  const y = Math.floor(t / level.width);
  for (const [dx, dy] of DIRS) {
    if (!railJoins(level, x, y, dx, dy)) continue;
    const there = level.getTile(x + dx, y + dy)!;
    if (stop(there)) return true;
    const next = x + dx + (y + dy) * level.width;
    if (!follow(there) || reached.has(next)) continue;
    reached.add(next);
    order.push(next);
  }
  return false;
}

/** Whether our base track is joined, through track the rival laid, to the rival's network. */
export function bridgedToRival(level: Level, entity: Entity): boolean {
  const team = entity.team ?? Team.Two;
  const rival = team === Team.One ? Team.Two : Team.One;
  const follow = (tile: TileData) => tile.team === undefined || tile.team === team;
  return floodTrack(level, team, follow, (tile) => tile.type === TileType.Rail && tile.team === rival).stopped;
}

export function ownCarriages(entity: Entity): number {
  let count = 0;
  for (const d of carriages) if (!d.removed && d.team === entity.team) count++;
  return count;
}

export function carriageDemand(level: Level, entity: Entity, profile: AIDifficulty): number {
  const team = entity.team ?? Team.Two;
  // Track the rival laid counts once we have joined it; their base track never does.
  const follow = (tile: TileData) => tile.team === undefined || tile.team === team
    || (tile.type === TileType.Rail && isVersus());
  const { reached, order } = floodTrack(level, team, follow);
  const outward = order.filter((t) => tileAt(level, t)?.type === TileType.Rail).length;
  const treasure = treasureOf();
  const reachesTreasure = treasure !== null && [...treasureReachTiles(level, treasure)].some((t) => reached.has(t));
  if (!reachesTreasure && outward < 6) return 0;
  return Math.min(profile.maxCarriages, reachesTreasure ? profile.maxCarriages : 2, Math.max(1, Math.ceil(outward / 12)));
}

/** Whether a stall or building stands close enough to a tile to take the key press instead of the track. */
function propInReach(props: readonly Entity[], at: Point): boolean {
  return props.some((b) => dist(b.position!, at) < INTERACT_REACH + (b.radius?.x ?? 10) + 8);
}

/** A tile of the team's own base track with no carriage on it. */
export function carriageSpot(level: Level, entity: Entity, field: Field): number {
  const props = [...placed].filter((e) => !e.removed && e.carriedBy === undefined
    && (e.shopItem !== undefined || e.building !== undefined));
  let best = -1;
  for (let t = 0; t < field.dist.length; t++) {
    if (!Number.isFinite(field.dist[t]) || (best >= 0 && field.dist[t] >= field.dist[best])) continue;
    const tile = tileAt(level, t);
    if (tile?.type !== TileType.PlayerRail || tile.team !== entity.team) continue;
    const at = { x: centreX(t % level.width), y: centreY(Math.floor(t / level.width)) };
    if (!canSpawnRailDroid(level, at.x, at.y) || propInReach(props, at)) continue;
    best = t;
  }
  return best;
}
