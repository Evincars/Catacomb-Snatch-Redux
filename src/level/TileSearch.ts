import { AStar, BFS, Dijkstra, HeuristicPolicyManhattan } from 'yuka';
import { UNIT_STEP } from './TileGraph';
import type { StepCost, TileGraph } from './TileGraph';

/**
 * Searches over a TileGraph, all done by Yuka's graph algorithms. The search objects are reused, so a
 * search allocates only its own bookkeeping.
 */

/** Cheapest cost from the start tiles to every tile (`Infinity` if unreachable), and the tile each is entered from. */
export type CostField = { dist: Float64Array; parent: Int32Array };

const astar = new AStar();
// Every step costs at least one, so the Manhattan distance in tiles never overestimates.
astar.heuristic = HeuristicPolicyManhattan;
const dijkstra = new Dijkstra();
const bfs = new BFS();

/** The cheapest route from one tile to another by A*, as the tiles to walk through after `from`; empty if there is none. */
export function findRoute(graph: TileGraph, from: number, to: number, step: StepCost = UNIT_STEP): number[] {
  if (from === to) return [];
  graph.prepare(step);
  astar.clear();
  astar.graph = graph;
  astar.source = from;
  astar.target = to;
  if (!astar.search().found) return [];
  const path = astar.getPath();
  path.shift();
  return path;
}

/** The cheapest route from any start tile to any goal tile by Dijkstra, start tile included; empty if there is none. */
export function findRouteToAny(graph: TileGraph, starts: readonly number[], goals: ReadonlySet<number>, step: StepCost): number[] {
  graph.prepare(step, starts, goals);
  dijkstra.clear();
  dijkstra.graph = graph;
  dijkstra.source = graph.source;
  dijkstra.target = graph.sink;
  if (!dijkstra.search().found) return [];
  const path = dijkstra.getPath();
  // Drop the virtual source and sink at either end.
  return path.slice(1, -1);
}

/** Cheapest costs from the start tiles to every tile, by a Dijkstra search that runs to exhaustion. */
export function costField(graph: TileGraph, starts: readonly number[], step: StepCost): CostField {
  const dist = new Float64Array(graph.tileCount).fill(Infinity);
  const parent = new Int32Array(graph.tileCount).fill(-1);
  for (const t of starts) dist[t] = 0;
  graph.prepare(step, starts);
  dijkstra.clear();
  dijkstra.graph = graph;
  dijkstra.source = graph.source;
  dijkstra.target = -1;
  dijkstra.search();
  // The search tree lists links in the order tiles were settled, so a parent always comes before its child.
  for (const link of dijkstra.getSearchTree()) {
    if (link.from === graph.source) continue;
    dist[link.to] = dist[link.from] + link.cost;
    parent[link.to] = link.from;
  }
  return { dist, parent };
}

/** How many tiles can be reached from `from`, itself included, by a breadth-first search. */
export function countReachable(graph: TileGraph, from: number, step: StepCost): number {
  graph.prepare(step);
  bfs.clear();
  bfs.graph = graph;
  bfs.source = from;
  bfs.target = -1;
  bfs.search();
  return bfs.getSearchTree().length + 1;
}
