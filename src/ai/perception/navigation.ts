import { world } from '../../world';
import type { Entity } from '../../world';
import type { Level } from '../../level/Level';
import { TileType, TILE_WIDTH } from '../../level/TileType';
import { DIRS, INF } from '../constants';
import { centreX, centreY, tileOf } from './geometry';
import type { Brain, Field } from '../types';
import { routeTo } from './pathing';

/** Tiles occupied by things that block a walker, and tiles that are dangerous to step on. */
export function obstacles(level: Level): { blocked: Set<number>; risky: Set<number> } {
  const blocked = new Set<number>();
  const risky = new Set<number>();
  for (const e of world.with('position', 'blocking')) {
    if (e.carriedBy !== undefined || e.removed || e.playerInput || e.railDroid || e.ai) continue;
    if (e.building || e.spawner) blocked.add(tileOf(level, e.position!.x, e.position!.y));
  }
  for (const e of world.with('position', 'spikeTrap')) risky.add(tileOf(level, e.position!.x, e.position!.y));
  return { blocked, risky };
}

/** Min-heap of [cost, tile] pairs, used by both the walking and the track planner. */
export class Heap {
  private items: Array<[number, number]> = [];
  get size(): number { return this.items.length; }
  push(cost: number, tile: number): void {
    const a = this.items;
    a.push([cost, tile]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

/** What it costs to step onto each tile: one, more for risky ground and pit edges, never for walls and obstacles. */
function stepCosts(level: Level, blocked: Set<number>, risky: Set<number>): Float32Array {
  const w = level.width;
  const cost = new Float32Array(w * level.height).fill(INF);
  for (let ty = 0; ty < level.height; ty++) {
    for (let tx = 0; tx < w; tx++) {
      const tile = level.getTile(tx, ty);
      // Cracked floor gives way underfoot, so it is as bad as a pit.
      if (!tile || !tile.passable || tile.type === TileType.Hole || tile.type === TileType.DropTrap) continue;
      const t = tx + ty * w;
      if (blocked.has(t)) continue;
      let step = risky.has(t) ? 8 : 1;
      // Keep off the edges of pits where a shove would tip it in.
      for (const [ex, ey] of DIRS) {
        const edge = level.getTile(tx + ex, ty + ey)?.type;
        if (edge === TileType.Hole || edge === TileType.DropTrap) {
          step += 3;
          break;
        }
      }
      cost[t] = step;
    }
  }
  return cost;
}

/** Walking distances from a tile to every other, by Dijkstra over the step costs. */
export function walkField(level: Level, from: number, avoid?: Set<number>): Field {
  const n = level.width * level.height;
  const distArr = new Float64Array(n).fill(INF);
  const parent = new Int32Array(n).fill(-1);
  const { blocked, risky } = obstacles(level);
  if (avoid) for (const t of avoid) if (t !== from) blocked.add(t);
  const cost = stepCosts(level, blocked, risky);
  const heap = new Heap();
  distArr[from] = 0;
  heap.push(0, from);
  while (heap.size > 0) {
    const [d, cur] = heap.pop();
    if (d > distArr[cur]) continue;
    const cx = cur % level.width;
    const cy = (cur - cx) / level.width;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      if (nx < 0 || ny < 0 || nx >= level.width || ny >= level.height) continue;
      const next = nx + ny * level.width;
      const step = cost[next];
      if (step === INF) continue;
      if (d + step < distArr[next]) {
        distArr[next] = d + step;
        parent[next] = cur;
        heap.push(d + step, next);
      }
    }
  }
  return { dist: distArr, parent, origin: from, cost };
}

/** The route to a tile: A* over the grid, falling back on the distance field's own tree. */
export function routeFor(level: Level, field: Field, goal: number): number[] {
  const route = routeTo(level, field, goal);
  return route.length > 0 || goal === field.origin ? route : pathTo(field, goal);
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
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= level.width || ny >= level.height) continue;
      const t = nx + ny * level.width;
      // Diagonal neighbours are a last resort: reach is measured along the aim line.
      const d = field.dist[t] + (dx !== 0 && dy !== 0 ? 2 : 0);
      if (d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
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
    if (score < bestDist) {
      bestDist = score;
      best = t;
    }
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
    if (d < bestDist) {
      best = e;
      bestDist = d;
    }
  }
  return best;
}

/** How many tiles can be walked to from `from` when `extra` is also blocked. */
export function reachableCount(level: Level, from: number, extra: number): number {
  const { blocked } = obstacles(level);
  blocked.add(extra);
  const seen = new Set<number>([from]);
  const queue = [from];
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    const cx = cur % level.width;
    const cy = (cur - cx) / level.width;
    for (const [dx, dy] of DIRS) {
      const tile = level.getTile(cx + dx, cy + dy);
      if (!tile || !tile.passable || tile.type === TileType.Hole || tile.type === TileType.DropTrap) continue;
      const next = cx + dx + (cy + dy) * level.width;
      if (blocked.has(next) || seen.has(next)) continue;
      seen.add(next);
      queue.push(next);
    }
  }
  return seen.size;
}
