import { Graph, NavEdge, NavNode, Vector3 } from 'yuka';
import type { Level } from './Level';

/**
 * What stepping from tile `from` onto tile `to` costs; `Infinity` means the step is not allowed.
 * Supplied per search, so one graph serves every walker: mobs, computer players, the track planner.
 */
export type StepCost = (from: number, to: number) => number;

export const UNIT_STEP: StepCost = () => 1;

/** 4-neighbour offsets as [dx, dy]: north, east, south, west. */
const NEIGHBOURS = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;

/**
 * The level grid as a Yuka graph. Node `tx + ty * width` is a tile, positioned at (tx, 0, ty) so Yuka's
 * heuristics measure in tiles. Every tile links to its four neighbours; whether a link can be walked, and
 * at what price, is decided by the StepCost given to `prepare`, so the topology never has to be rebuilt
 * when terrain or obstacles change.
 *
 * Two extra nodes let one search start from many tiles or end at any of many: `source` links to every
 * tile passed as a start, and every tile passed as a goal links to `sink`.
 */
export class TileGraph extends Graph<NavNode, NavEdge> {
  readonly width: number;
  readonly height: number;
  readonly source: number;
  readonly sink: number;

  private readonly links: NavEdge[][] = [];
  /** One sink link per tile, made when first needed; search trees keep links, so they are never shared. */
  private readonly sinkLinks: Array<NavEdge | undefined> = [];
  private sourceLinks: NavEdge[] = [];
  private sinkTiles: ReadonlySet<number> | null = null;
  private step: StepCost = UNIT_STEP;

  constructor(width: number, height: number) {
    super();
    this.digraph = true;
    this.width = width;
    this.height = height;
    this.source = width * height;
    this.sink = this.source + 1;
    for (let t = 0; t < this.source; t++) this.addNode(new NavNode(t, new Vector3(t % width, 0, Math.floor(t / width))));
    this.addNode(new NavNode(this.source));
    this.addNode(new NavNode(this.sink));
    for (let t = 0; t < this.source; t++) this.links[t] = this.linksOf(t);
  }

  get tileCount(): number {
    return this.source;
  }

  /** Sets the step costs, and optionally the start and goal tiles, for the searches that follow. */
  prepare(step: StepCost, starts: readonly number[] = [], goals: ReadonlySet<number> | null = null): this {
    this.step = step;
    this.sourceLinks = starts.map((t) => new NavEdge(this.source, t, 0));
    this.sinkTiles = goals;
    return this;
  }

  /** The walkable links out of a node, priced for the current search; what Yuka's searches expand. */
  override getEdgesOfNode(index: number, result: NavEdge[]): NavEdge[] {
    result.length = 0;
    if (index === this.source) {
      result.push(...this.sourceLinks);
      return result;
    }
    const links = this.links[index];
    if (!links) return result;
    for (const link of links) {
      const cost = this.step(index, link.to);
      if (cost === Infinity) continue;
      link.cost = cost;
      result.push(link);
    }
    if (this.sinkTiles?.has(index)) result.push(this.sinkLinkOf(index));
    return result;
  }

  private linksOf(t: number): NavEdge[] {
    const tx = t % this.width;
    const ty = (t - tx) / this.width;
    const links: NavEdge[] = [];
    for (const [dx, dy] of NEIGHBOURS) {
      const nx = tx + dx;
      const ny = ty + dy;
      if (nx < 0 || ny < 0 || nx >= this.width || ny >= this.height) continue;
      const link = new NavEdge(t, nx + ny * this.width, 1);
      this.addEdge(link);
      links.push(link);
    }
    return links;
  }

  private sinkLinkOf(t: number): NavEdge {
    return this.sinkLinks[t] ?? (this.sinkLinks[t] = new NavEdge(t, this.sink, 0));
  }
}

const graphs = new WeakMap<Level, TileGraph>();

/** The level's graph, built once per level. */
export function tileGraphOf(level: Level): TileGraph {
  let graph = graphs.get(level);
  if (!graph) {
    graph = new TileGraph(level.width, level.height);
    graphs.set(level, graph);
  }
  return graph;
}
