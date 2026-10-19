import createGraph from 'ngraph.graph';
import type { Graph } from 'ngraph.graph';
import { aStar } from 'ngraph.path';
import type { PathFinder } from 'ngraph.path';
import type { Level } from '../../level/Level';
import { TileType } from '../../level/TileType';
import type { Field } from '../types';

/**
 * Point-to-point routes over the tile grid with ngraph.path (A*). The graph holds only the
 * shape of the floor (which tiles can be stood on); what is in the way right now, and how
 * risky a tile is, comes in as the per-tile step costs of the walker's cost field, so the
 * route costs exactly what the distance field says it does.
 */
type Nav = { graph: Graph<number>; finder: PathFinder<number>; level: Level; signature: number };

let nav: Nav | null = null;
/** Step costs of the walk in progress; the finder reads them as its edge weights. */
let costs: Float32Array = new Float32Array(0);

function standable(level: Level, tx: number, ty: number): boolean {
  const tile = level.getTile(tx, ty);
  return !!tile && tile.passable && tile.type !== TileType.Hole && tile.type !== TileType.DropTrap;
}

/** A cheap fingerprint of which tiles can be stood on, to know when the graph must be rebuilt. */
function signatureOf(level: Level): number {
  let h = 2166136261;
  for (let ty = 0; ty < level.height; ty++) {
    for (let tx = 0; tx < level.width; tx++) {
      h = Math.imul(h ^ (standable(level, tx, ty) ? 1 : 0), 16777619);
    }
  }
  return h >>> 0;
}

function build(level: Level, signature: number): Nav {
  const graph = createGraph<number>();
  const w = level.width;
  for (let ty = 0; ty < level.height; ty++) {
    for (let tx = 0; tx < w; tx++) {
      if (!standable(level, tx, ty)) continue;
      const id = tx + ty * w;
      graph.addNode(id, id);
      if (tx > 0 && standable(level, tx - 1, ty)) {
        graph.addLink(id, id - 1);
        graph.addLink(id - 1, id);
      }
      if (ty > 0 && standable(level, tx, ty - 1)) {
        graph.addLink(id, id - w);
        graph.addLink(id - w, id);
      }
    }
  }
  const finder = aStar(graph, {
    oriented: true,
    distance: (_from, to) => costs[to.id as number],
    // Manhattan distance never overestimates a grid where every step costs at least one.
    heuristic: (from, to) => {
      const a = from.id as number;
      const b = to.id as number;
      return Math.abs((a % w) - (b % w)) + Math.abs(Math.floor(a / w) - Math.floor(b / w));
    },
  });
  return { graph, finder, level, signature };
}

/**
 * The cheapest route from `field.origin` to `goal`, as tiles to walk through in order (the start tile
 * not included). Empty when there is no route. Uses the walker's own step costs.
 */
export function routeTo(level: Level, field: Field, goal: number): number[] {
  if (goal === field.origin || !Number.isFinite(field.dist[goal])) return [];
  const signature = signatureOf(level);
  if (!nav || nav.level !== level || nav.signature !== signature) nav = build(level, signature);
  costs = field.cost;
  const found = nav.finder.find(field.origin, goal);
  // The finder lists the goal first and the start last.
  const route: number[] = [];
  for (let i = found.length - 2; i >= 0; i--) route.push(found[i].id as number);
  return route;
}
