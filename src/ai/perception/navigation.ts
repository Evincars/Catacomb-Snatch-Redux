import { world } from '../../world';
import type { Entity } from '../../world';
import type { Level } from '../../level/Level';
import { TileType, TILE_WIDTH } from '../../level/TileType';
import { tileGraphOf } from '../../level/TileGraph';
import type { StepCost } from '../../level/TileGraph';
import { costField, countReachable, findRoute } from '../../level/TileSearch';
import { DIRS, INF } from '../constants';
import { centreX, centreY, tileOf } from './geometry';
import type { Brain, Field } from '../types';

const blockers = world.with('position', 'blocking');
const spikes = world.with('position', 'spikeTrap');

/** The tile and its eight neighbours, as [dx, dy]; diagonals last. */
const AROUND = [[0, 0], [0, -1], [1, 0], [0, 1], [-1, 0], [-1, -1], [1, -1], [-1, 1], [1, 1]] as const;

const NOTHING: ReadonlySet<number> = new Set();

/** Extra cost of a tile with spikes, and of one at the edge of a pit where a shove would tip it in. */
const RISKY_STEP = 8;
const PIT_EDGE_STEP = 3;

export type Obstacles = { blocked: Set<number>; risky: Set<number> };

/** Tiles occupied by things that block a walker, and tiles that are dangerous to step on. */
export function obstacles(level: Level): Obstacles {
  const blocked = new Set<number>();
  const risky = new Set<number>();
  for (const e of blockers) {
    if (!blocksWalkers(e)) continue;
    blocked.add(tileOf(level, e.position!.x, e.position!.y));
  }
  for (const e of spikes) risky.add(tileOf(level, e.position!.x, e.position!.y));
  return { blocked, risky };
}

function blocksWalkers(e: Entity): boolean {
  if (e.carriedBy !== undefined || e.removed || e.playerInput || e.railDroid || e.ai) return false;
  return e.building !== undefined || e.spawner !== undefined;
}

/** Ground a computer player will set foot on: cracked floor gives way underfoot, so it is as bad as a pit. */
export function standable(level: Level, tx: number, ty: number): boolean {
  const tile = level.getTile(tx, ty);
  return !!tile && tile.passable && tile.type !== TileType.Hole && tile.type !== TileType.DropTrap;
}

function isPit(level: Level, tx: number, ty: number): boolean {
  const type = level.getTile(tx, ty)?.type;
  return type === TileType.Hole || type === TileType.DropTrap;
}

function bordersPit(level: Level, tx: number, ty: number): boolean {
  for (const [dx, dy] of DIRS) if (isPit(level, tx + dx, ty + dy)) return true;
  return false;
}

/** What stepping onto one tile costs: one, more for risky ground and pit edges, never for walls and obstacles. */
function tileStepCost(level: Level, tx: number, ty: number, { blocked, risky }: Obstacles): number {
  const t = tx + ty * level.width;
  if (!standable(level, tx, ty) || blocked.has(t)) return INF;
  const base = risky.has(t) ? RISKY_STEP : 1;
  return bordersPit(level, tx, ty) ? base + PIT_EDGE_STEP : base;
}

function stepCosts(level: Level, around: Obstacles): Float32Array {
  const cost = new Float32Array(level.width * level.height);
  for (let t = 0; t < cost.length; t++) cost[t] = tileStepCost(level, t % level.width, Math.floor(t / level.width), around);
  return cost;
}

/** Walking costs from a tile to every other, by Dijkstra over the step costs (Yuka). */
export function walkField(level: Level, from: number, avoid?: ReadonlySet<number>): Field {
  const around = obstacles(level);
  for (const t of avoid ?? NOTHING) if (t !== from) around.blocked.add(t);
  const cost = stepCosts(level, around);
  const { dist, parent } = costField(tileGraphOf(level), [from], (_from, to) => cost[to]);
  return { dist, parent, origin: from, cost };
}

/** The cheapest route to a tile by A* over the walker's own step costs, falling back on the field's own tree. */
export function routeFor(level: Level, field: Field, goal: number): number[] {
  if (goal === field.origin || !Number.isFinite(field.dist[goal])) return [];
  const route = findRoute(tileGraphOf(level), field.origin, goal, (_from, to) => field.cost[to]);
  return route.length > 0 ? route : pathTo(field, goal);
}

export function pathTo(field: Field, goal: number): number[] {
  if (!Number.isFinite(field.dist[goal])) return [];
  const path: number[] = [];
  for (let t = goal; t !== field.origin && t >= 0; t = field.parent[t]) path.push(t);
  return path.reverse();
}

/** The reachable tile nearest by walking among a tile and its neighbours (for blocked targets). */
export function approachTile(level: Level, field: Field, tile: number): number {
  const x = tile % level.width;
  const y = (tile - x) / level.width;
  let best = -1;
  let bestDist = INF;
  for (const [dx, dy] of AROUND) {
    const nx = x + dx;
    const ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= level.width || ny >= level.height) continue;
    // Diagonal neighbours are a last resort: reach is measured along the aim line.
    const d = field.dist[nx + ny * level.width] + (dx !== 0 && dy !== 0 ? 2 : 0);
    if (d >= bestDist) continue;
    bestDist = d;
    best = nx + ny * level.width;
  }
  return best;
}

/** The tile the AI can walk to that lies closest, in a straight line, to a point it cannot walk to. */
export function nearestReachableTo(level: Level, field: Field, at: { x: number; y: number }): number {
  let best = -1;
  let bestDist = INF;
  for (let t = 0; t < field.dist.length; t++) {
    if (!Number.isFinite(field.dist[t])) continue;
    const d = Math.hypot(centreX(t % level.width) - at.x, centreY(Math.floor(t / level.width)) - at.y);
    // Walking cost is a tie-break so equally close tiles do not send it on a long detour.
    const score = d + field.dist[t] * 0.01;
    if (score >= bestDist) continue;
    bestDist = score;
    best = t;
  }
  return best;
}

export function walkDistance(level: Level, field: Field, x: number, y: number): number {
  const t = approachTile(level, field, tileOf(level, x, y));
  return t < 0 ? INF : field.dist[t] * TILE_WIDTH;
}

export function ignored(brain: Brain, e: Entity): boolean {
  const until = brain.blacklist.get(world.id(e) ?? -1);
  return until !== undefined && until > brain.age;
}

export function reachable(level: Level, brain: Brain, e: Entity, limit = INF): number {
  if (ignored(brain, e)) return INF;
  const d = walkDistance(level, brain.field!, e.position!.x, e.position!.y);
  return d <= limit ? d : INF;
}

export function nearestOf(level: Level, brain: Brain, list: Iterable<Entity>, limit = INF): Entity | null {
  let best: Entity | null = null;
  let bestDist = limit;
  for (const e of list) {
    const d = reachable(level, brain, e, limit);
    if (d >= bestDist) continue;
    best = e;
    bestDist = d;
  }
  return best;
}

/**
 * How many tiles can be walked to from `from` when `extra` is also blocked. Pass `blocked` when asking about
 * many tiles in a row, so the obstacles are gathered once.
 */
export function reachableCount(level: Level, from: number, extra: number, blocked = obstacles(level).blocked): number {
  const step: StepCost = (_from, to) => {
    if (to === extra || blocked.has(to)) return INF;
    return standable(level, to % level.width, Math.floor(to / level.width)) ? 1 : INF;
  };
  return countReachable(tileGraphOf(level), from, step);
}
