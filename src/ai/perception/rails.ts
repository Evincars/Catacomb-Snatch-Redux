import { world, Team } from '../../world';
import type { Entity } from '../../world';
import type { Level } from '../../level/Level';
import { TileType } from '../../level/TileType';
import { railJoins } from '../../level/RailLayout';
import { isVersus } from '../../game/GameState';
import type { AIDifficulty } from '../../game/GameState';
import { INTERACT_REACH } from '../../systems/TargetingSystem';
import { canSpawnRailDroid } from '../../systems/RailDroidSystem';
import { turretRadiusAt } from '../../entities/BuildingFactory';
import { BASE_DEFENSE_RANGE, BLAST_STEP, CARRIAGE_RADIUS, DIRS, INF, RAIL_TYPES, TREASURE_REACH } from '../constants';
import { ownBuildings, treasureOf } from './economy';
import { alive, centreX, centreY, dist, tileAt, tileX, tileY } from './geometry';
import { Heap, obstacles } from './navigation';
import type { Field } from '../types';

export function treasureReachTiles(level: Level, treasure: Entity): Set<number> {
  const result = new Set<number>();
  const p = treasure.position!;
  const r = treasure.radius ?? { x: 10, y: 10 };
  const reachX = CARRIAGE_RADIUS.x + TREASURE_REACH + r.x - 2;
  const reachY = CARRIAGE_RADIUS.y + TREASURE_REACH + r.y - 2;
  for (let ty = tileY(p.y - reachY); ty <= tileY(p.y + reachY); ty++) {
    for (let tx = tileX(p.x - reachX); tx <= tileX(p.x + reachX); tx++) {
      if (Math.abs(centreX(tx) - p.x) < reachX && Math.abs(centreY(ty) - p.y) < reachY
        && level.getTile(tx, ty)) result.add(tx + ty * level.width);
    }
  }
  return result;
}

/** Tiles of track still to be laid, in order from the base, or null when there is no way through. */
export function planRails(level: Level, team: Team): number[] | null {
  const treasure = treasureOf();
  if (!treasure) return null;
  const targets = treasureReachTiles(level, treasure);
  const { blocked } = obstacles(level);
  const n = level.width * level.height;
  const cost = new Float64Array(n).fill(INF);
  const parent = new Int32Array(n).fill(-1);
  const heap = new Heap();

  for (let ty = 0; ty < level.height; ty++) {
    for (let tx = 0; tx < level.width; tx++) {
      const tile = level.getTile(tx, ty);
      if (tile?.type === TileType.PlayerRail && tile.team === team) {
        const t = tx + ty * level.width;
        cost[t] = 0;
        heap.push(0, t);
      }
    }
  }

  const stepCost = (tx: number, ty: number): number => {
    const tile = level.getTile(tx, ty);
    if (!tile) return INF;
    if (RAIL_TYPES.has(tile.type)) {
      if (tile.team !== undefined && tile.team !== team) {
        // The rival's laid track already runs to the treasure: joining it is far cheaper than a line of
        // our own, and our carriages then collect from it. Their base track is theirs and stays off limits.
        if (!isVersus()) return 0;
        return tile.type === TileType.Rail ? 0.4 : INF;
      }
      return 0;
    }
    const t = tx + ty * level.width;
    if (level.inBaseArea(tx, ty)) return INF;
    // A cracked wall can be blasted open, at the price of a bomb.
    if (tile.destroyable) return BLAST_STEP;
    if (!tile.buildable || blocked.has(t)) return INF;
    return 1;
  };

  let end = -1;
  while (heap.size > 0) {
    const [c, cur] = heap.pop();
    if (c > cost[cur]) continue;
    if (targets.has(cur)) {
      end = cur;
      break;
    }
    const cx = cur % level.width;
    const cy = (cur - cx) / level.width;
    const here = level.getTile(cx, cy);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      const there = level.getTile(nx, ny);
      if (!there) continue;
      // The original's fixed track only joins up and down.
      if (dx !== 0 && (here?.type === TileType.UnbreakableRail || there.type === TileType.UnbreakableRail)) continue;
      const step = stepCost(nx, ny);
      if (!Number.isFinite(step)) continue;
      const next = nx + ny * level.width;
      // Tiny tie-break keeps lines straight, which reads better and confuses carriages less.
      if (c + step + 0.001 < cost[next]) {
        cost[next] = c + step + 0.001;
        parent[next] = cur;
        heap.push(cost[next], next);
      }
    }
  }
  if (end < 0) return null;

  const route: number[] = [];
  for (let t = end; t >= 0 && cost[t] > 0; t = parent[t]) route.push(t);
  route.reverse();
  return route.filter((t) => !RAIL_TYPES.has(level.getTile(t % level.width, Math.floor(t / level.width))!.type));
}

/**
 * Laid track of ours beyond the home defences that no turret of ours covers: its
 * length in tiles and the stretch farthest from home, where the next turret goes.
 */
export function unguardedTrack(level: Level, entity: Entity, field: Field): { x: number; y: number; count: number } | null {
  const home = level.getRandomSpawnPoint(entity.team ?? Team.Two);
  if (!home) return null;
  const turrets = ownBuildings(entity, 'defense').filter((b) => b.turret && alive(b) && b.carriedBy === undefined);
  const covered = (p: { x: number; y: number }) => turrets.some((b) => dist(b.position!, p) < b.turret!.radius * 0.85
    && level.checkLineOfSight(b.position!.x, b.position!.y, p.x, p.y));
  const open: Array<{ x: number; y: number }> = [];
  for (let t = 0; t < level.width * level.height; t++) {
    const tile = tileAt(level, t);
    if (!tile || !RAIL_TYPES.has(tile.type) || tile.team !== entity.team || !Number.isFinite(field.dist[t])) continue;
    const p = { x: centreX(t % level.width), y: centreY(Math.floor(t / level.width)) };
    if (dist(p, home) <= BASE_DEFENSE_RANGE || covered(p)) continue;
    open.push(p);
  }
  if (open.length === 0) return null;
  // The post goes where one turret covers the most bare track in clear sight (a bend or a junction beats
  // a long straight), and among equals the farthest from home, where the line is thinnest.
  const reach = turretRadiusAt(1) * 0.85;
  let best = open[0];
  let bestScore = -INF;
  for (const a of open) {
    let cluster = 0;
    for (const b of open) if (dist(a, b) <= reach && level.checkLineOfSight(a.x, a.y, b.x, b.y)) cluster++;
    const score = cluster * 100 + dist(a, home) / 10;
    if (score > bestScore) {
      bestScore = score;
      best = a;
    }
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

/** Whether our base track is joined, through track the rival laid, to the rival's network. */
export function bridgedToRival(level: Level, entity: Entity): boolean {
  const rival = entity.team === Team.One ? Team.Two : Team.One;
  const seen = new Set<number>();
  const queue: number[] = [];
  for (let ty = 0; ty < level.height; ty++) {
    for (let tx = 0; tx < level.width; tx++) {
      const tile = level.getTile(tx, ty);
      if (tile?.type === TileType.PlayerRail && tile.team === entity.team) {
        seen.add(tx + ty * level.width);
        queue.push(tx + ty * level.width);
      }
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const x = queue[i] % level.width;
    const y = Math.floor(queue[i] / level.width);
    for (const [dx, dy] of DIRS) {
      if (!railJoins(level, x, y, dx, dy)) continue;
      const there = level.getTile(x + dx, y + dy)!;
      if (there.type === TileType.Rail && there.team === rival) return true;
      if (there.team !== undefined && there.team !== entity.team) continue;
      const t = x + dx + (y + dy) * level.width;
      if (!seen.has(t)) {
        seen.add(t);
        queue.push(t);
      }
    }
  }
  return false;
}

export function ownCarriages(entity: Entity): number {
  let count = 0;
  for (const d of world.with('railDroid')) if (!d.removed && d.team === entity.team) count++;
  return count;
}

export function carriageDemand(level: Level, entity: Entity, profile: AIDifficulty): number {
  const connected = new Set<number>();
  const queue: number[] = [];
  for (let ty = 0; ty < level.height; ty++) {
    for (let tx = 0; tx < level.width; tx++) {
      const tile = level.getTile(tx, ty);
      if (tile?.type !== TileType.PlayerRail || tile.team !== entity.team) continue;
      const t = tx + ty * level.width;
      connected.add(t);
      queue.push(t);
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    const x = cur % level.width;
    const y = Math.floor(cur / level.width);
    for (const [dx, dy] of DIRS) {
      if (!railJoins(level, x, y, dx, dy)) continue;
      const tile = level.getTile(x + dx, y + dy)!;
      // Track the rival laid counts once we have joined it; their base track never does.
      if (tile.team !== undefined && tile.team !== entity.team && (tile.type !== TileType.Rail || !isVersus())) continue;
      const t = x + dx + (y + dy) * level.width;
      if (!connected.has(t)) {
        connected.add(t);
        queue.push(t);
      }
    }
  }
  const outward = queue.filter((t) => tileAt(level, t)?.type === TileType.Rail).length;
  const treasure = treasureOf();
  const reachesTreasure = treasure !== null && [...treasureReachTiles(level, treasure)].some((t) => connected.has(t));
  if (!reachesTreasure && outward < 6) return 0;
  return Math.min(profile.maxCarriages, reachesTreasure ? profile.maxCarriages : 2, Math.max(1, Math.ceil(outward / 12)));
}

/** A tile of the team's own base track with no carriage on it. */
export function carriageSpot(level: Level, entity: Entity, field: Field): number {
  const props = [...world.with('position')].filter((e) => !e.removed && e.carriedBy === undefined
    && (e.shopItem !== undefined || e.building !== undefined));
  let best = -1;
  for (let t = 0; t < field.dist.length; t++) {
    if (!Number.isFinite(field.dist[t])) continue;
    const tx = t % level.width;
    const ty = (t - tx) / level.width;
    const tile = level.getTile(tx, ty);
    if (tile?.type !== TileType.PlayerRail || tile.team !== entity.team) continue;
    if (!canSpawnRailDroid(level, centreX(tx), centreY(ty))) continue;
    // A stall or building within reach would take the key press instead of the track.
    if (props.some((b) => dist(b.position!, { x: centreX(tx), y: centreY(ty) }) < INTERACT_REACH + (b.radius?.x ?? 10) + 8)) continue;
    if (best < 0 || field.dist[t] < field.dist[best]) best = t;
  }
  return best;
}
