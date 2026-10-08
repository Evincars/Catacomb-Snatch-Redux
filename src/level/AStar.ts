import type { Level } from './Level';
import { TILE_WIDTH, TILE_HEIGHT } from './TileType';

type GridPos = { x: number; y: number };

type Node = {
  pos: GridPos;
  parent: Node | null;
  pathDist: number;
  heurDist: number;
  priority: number;
  visited: boolean;
  neighbors: Node[] | null;
};

const DIRS: GridPos[] = [
  { x: -1, y: 0 }, { x: 1, y: 0 },
  { x: 0, y: -1 }, { x: 0, y: 1 },
];

function key(p: GridPos): string {
  return `${p.x},${p.y}`;
}

function dist(a: GridPos, b: GridPos): number {
  const dx = a.x - b.x;
  const dy = a.y - b.y;
  return Math.sqrt(dx * dx + dy * dy);
}

export type Path = { success: boolean; nodes: GridPos[] };

export function findPath(
  level: Level,
  startWorld: { x: number; y: number },
  goalWorld: { x: number; y: number },
  avoidWalls = 0,
  randomMod = 0,
): Path {
  const start: GridPos = {
    x: Math.floor(startWorld.x / TILE_WIDTH),
    y: Math.floor(startWorld.y / TILE_HEIGHT),
  };
  const goal: GridPos = {
    x: Math.floor(goalWorld.x / TILE_WIDTH),
    y: Math.floor(goalWorld.y / TILE_HEIGHT),
  };

  const canWalk = (p: GridPos) => {
    const tile = level.getTile(p.x, p.y);
    return tile !== null && tile.passable;
  };

  if (!canWalk(start)) return { success: false, nodes: [] };
  if (start.x === goal.x && start.y === goal.y) return { success: true, nodes: [start] };

  const nodeMap = new Map<string, Node>();

  const getNode = (p: GridPos): Node => {
    const k = key(p);
    let n = nodeMap.get(k);
    if (!n) {
      n = { pos: p, parent: null, pathDist: 0, heurDist: Infinity, priority: Infinity, visited: false, neighbors: null };
      nodeMap.set(k, n);
    }
    return n;
  };

  const startNode = getNode(start);
  const goalNode = getNode(goal);

  // Simple min-heap via sorted array (good enough for dungeon scale)
  const open: Node[] = [startNode];
  startNode.pathDist = 0;
  startNode.priority = dist(start, goal);

  while (open.length > 0) {
    open.sort((a, b) => a.priority - b.priority);
    const current = open.shift()!;
    if (current.visited) continue;
    if (current === goalNode) break;

    current.visited = true;

    for (const d of DIRS) {
      const np: GridPos = { x: current.pos.x + d.x, y: current.pos.y + d.y };
      if (!canWalk(np)) continue;

      const nb = getNode(np);
      if (nb.visited) continue;

      let newDist = current.pathDist + 1;
      if (avoidWalls > 0) {
        // count passable neighbors to penalize spots near walls
        const passableNeighbors = DIRS.filter(dd => {
          const t = level.getTile(np.x + dd.x, np.y + dd.y);
          return t !== null && t.passable;
        }).length;
        newDist += avoidWalls * (4 - passableNeighbors);
      }
      if (randomMod > 0) {
        newDist += (Math.random() - 0.5) * randomMod;
      }

      if (nb.parent !== null && newDist >= nb.pathDist) continue;

      nb.pathDist = newDist;
      nb.heurDist = dist(np, goal);
      nb.priority = nb.pathDist + nb.heurDist;
      nb.parent = current;
      open.push(nb);
    }
  }

  if (goalNode.parent === null && goalNode !== startNode) {
    return { success: false, nodes: [] };
  }

  const path: GridPos[] = [];
  let n: Node | null = goalNode;
  while (n) {
    path.unshift(n.pos);
    n = n.parent;
  }
  return { success: true, nodes: path };
}
