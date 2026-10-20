import { q, Team } from '../../world';
import type { Entity } from '../../world';
import type { Level } from '../../level/Level';
import { TileType, TILE_WIDTH } from '../../level/TileType';
import { forEachTile } from '../../level/Grid';
import { profileOf } from '../brain';
import { BASE_DEFENSE_RANGE, DIRS, INF } from '../constants';
import { ownBuildings, treasureOf } from './economy';
import { alive, centreX, centreY, dist, tileX, tileY } from './geometry';
import { obstacles, reachableCount, walkDistance } from './navigation';
import { besideTrack } from './rails';
import type { Brain, Field } from '../types';

export function canPlaceOn(level: Level, t: number, reserved: Set<number>, blocked: Set<number>): boolean {
  const tx = t % level.width;
  const ty = (t - tx) / level.width;
  const tile = level.getTile(tx, ty);
  if (!tile?.buildable || tile.type === TileType.DropTrap || reserved.has(t) || blocked.has(t)) return false;
  if (level.inBaseArea(tx, ty) || besideTrack(level, t)) return false;
  // Leave corridors open: at least three passable neighbours.
  let open = 0;
  for (const [dx, dy] of DIRS) if (level.getTile(tx + dx, ty + dy)?.passable) open++;
  return open >= 3;
}

export function baseTurrets(level: Level, entity: Entity): Entity[] {
  const home = level.getRandomSpawnPoint(entity.team ?? Team.Two);
  return home ? ownBuildings(entity, 'defense').filter((b) => alive(b) && dist(b.position!, home) <= BASE_DEFENSE_RANGE) : [];
}

export function baseDefenseSpot(level: Level, entity: Entity, brain: Brain, rejected: ReadonlySet<number> = new Set()): number {
  const home = level.getRandomSpawnPoint(entity.team ?? Team.Two);
  if (!home) return -1;
  const field = brain.field!;
  const reserved = new Set([...brain.railPlan, ...rejected]);
  const { blocked } = obstacles(level);
  const turrets = baseTurrets(level, entity);
  let best = -1;
  let bestScore = INF;
  for (let t = 0; t < field.dist.length; t++) {
    if (!Number.isFinite(field.dist[t]) || !canPlaceOn(level, t, reserved, blocked)) continue;
    const p = { x: centreX(t % level.width), y: centreY(Math.floor(t / level.width)) };
    const d = dist(p, home);
    if (d > BASE_DEFENSE_RANGE - 26 || turrets.some((b) => dist(b.position!, p) < TILE_WIDTH * 2.5)) continue;
    const score = d / TILE_WIDTH + field.dist[t] * 0.25;
    if (score < bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}

/** Where a carried building should go: judged by what it does, and never on a tile that would wall the computer in. */
export function placementFor(level: Level, entity: Entity, brain: Brain, held: Entity): number {
  const field = brain.field!;
  let open = 0;
  for (const d of field.dist) if (Number.isFinite(d)) open++;
  const rejected = new Set<number>();
  const { blocked } = obstacles(level);
  for (let attempt = 0; attempt < 6; attempt++) {
    const t = placementCandidate(level, entity, brain, held, rejected);
    if (t < 0) return -1;
    // Closing off more than a tenth of the walkable area would shut the way out behind it.
    if (reachableCount(level, field.origin, t, blocked) >= Math.min(open - 2, open * 0.9)) return t;
    rejected.add(t);
  }
  return -1;
}

type Point = { x: number; y: number };
/** Whether a building may go on a tile. */
type SpotTest = (t: number) => boolean;

/** Reachable tile passing `ok` whose centre sits `lo`..`hi` px from `at`, nearest to walk to; -1 if none. */
function nearestSpot(level: Level, field: Field, ok: SpotTest, at: Point, lo: number, hi: number): number {
  const span = Math.ceil(hi / TILE_WIDTH) + 1;
  const ax = tileX(at.x);
  const ay = tileY(at.y);
  let best = -1;
  let bestDist = INF;
  const x0 = Math.max(0, ax - span);
  const y0 = Math.max(0, ay - span);
  const x1 = Math.min(level.width - 1, ax + span);
  const y1 = Math.min(level.height - 1, ay + span);
  forEachTile(x0, y0, x1, y1, (tx, ty) => {
    const t = tx + ty * level.width;
    const d = Math.hypot(centreX(tx) - at.x, centreY(ty) - at.y);
    if (d < lo || d > hi || !ok(t) || field.dist[t] >= bestDist) return;
    bestDist = field.dist[t];
    best = t;
  });
  return best;
}

/** Beside a turret that has no harvester of its own yet, so its kills are collected; turrets out on the track first. */
function harvesterSpot(level: Level, entity: Entity, field: Field, ok: SpotTest, reach: number): number {
  const harvesters = ownBuildings(entity, 'economy');
  const home = level.getRandomSpawnPoint(entity.team ?? Team.Two);
  // Their kills lie farthest from the base's own harvesters.
  const fromHome = (b: Entity) => (home ? dist(b.position!, home) : 0);
  for (const turret of ownBuildings(entity, 'defense').sort((a, b) => fromHome(b) - fromHome(a))) {
    if (harvesters.some((h) => dist(h.position!, turret.position!) < reach)) continue;
    const t = nearestSpot(level, field, ok, turret.position!, TILE_WIDTH * 0.9, Math.max(TILE_WIDTH * 1.5, reach * 0.8));
    if (t >= 0) return t;
  }
  return -1;
}

/** Within reach of a nest no turret of ours covers yet, so it farms the mobs that crawl out. */
function nestSpot(level: Level, entity: Entity, field: Field, ok: SpotTest, radius: number): number {
  const turrets = ownBuildings(entity, 'defense');
  const walk = (s: Entity) => walkDistance(level, field, s.position!.x, s.position!.y);
  const nests = [...q.spawners].filter((s) => !s.removed && Number.isFinite(walk(s))
    && !turrets.some((tur) => dist(tur.position!, s.position!) < tur.turret!.radius));
  nests.sort((a, b) => walk(a) - walk(b));
  for (const nest of nests) {
    const t = nearestSpot(level, field, ok, nest.position!, TILE_WIDTH * 1.5, radius * 0.75);
    if (t >= 0) return t;
  }
  return -1;
}

/** Home defences first, then the head of the track, then a nest to farm, then guarding the treasure. */
function turretSpot(level: Level, entity: Entity, brain: Brain, ok: SpotTest, radius: number, rejected: ReadonlySet<number>): number {
  const field = brain.field!;
  if (baseTurrets(level, entity).length < Math.min(3, profileOf(entity).maxTurrets)) {
    const t = baseDefenseSpot(level, entity, brain, rejected);
    if (t >= 0) return t;
  }
  if (brain.front) {
    const t = nearestSpot(level, field, ok, brain.front, TILE_WIDTH * 1.4, Math.max(radius * 0.6, TILE_WIDTH * 2.5));
    if (t >= 0) return t;
  }
  const t = nestSpot(level, entity, field, ok, radius);
  if (t >= 0) return t;
  const treasure = treasureOf();
  return treasure ? nearestSpot(level, field, ok, treasure.position!, TILE_WIDTH * 2, TILE_WIDTH * 5) : -1;
}

/** The nearest decent spot outside the base, for anything else. */
function anySpot(field: Field, ok: SpotTest): number {
  let best = -1;
  for (let t = 0; t < field.dist.length; t++) {
    if (field.dist[t] < 3 || !ok(t)) continue;
    if (best < 0 || field.dist[t] < field.dist[best]) best = t;
  }
  return best;
}

/** Candidate spot for a carried building, before checking that it leaves a way out. */
export function placementCandidate(level: Level, entity: Entity, brain: Brain, held: Entity, rejected: ReadonlySet<number>): number {
  const field = brain.field!;
  const reserved = new Set([...brain.railPlan, ...rejected]);
  const { blocked } = obstacles(level);
  const turrets = held.turret ? ownBuildings(entity, 'defense').filter((b) => b.turret && b.carriedBy === undefined) : [];
  // Turrets are spread out: two side by side cover little more than one.
  const crowded = (t: number) => turrets.some((b) =>
    dist(b.position!, { x: centreX(t % level.width), y: centreY(Math.floor(t / level.width)) }) < TILE_WIDTH * 1.7);
  const ok: SpotTest = (t) => Number.isFinite(field.dist[t]) && canPlaceOn(level, t, reserved, blocked) && !crowded(t);

  if (held.harvester) {
    const t = harvesterSpot(level, entity, field, ok, held.harvester.radius);
    if (t >= 0) return t;
  }
  if (held.turret) {
    const t = turretSpot(level, entity, brain, ok, held.turret.radius, rejected);
    if (t >= 0) return t;
  }
  return anySpot(field, ok);
}
