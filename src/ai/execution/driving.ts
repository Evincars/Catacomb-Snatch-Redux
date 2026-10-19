import { Path, SeparationBehavior, Vector3, Vehicle, FollowPathBehavior } from 'yuka';
import type { Entity } from '../../world';
import type { Level } from '../../level/Level';
import { TILE_WIDTH } from '../../level/TileType';
import { centreX, centreY } from '../perception/geometry';
import { nearby } from '../perception/spatial';
import type { Brain, Controls } from '../types';

/**
 * How a computer player walks, built on yuka's steering behaviours: it follows its route as a path of
 * points, always aiming at the farthest one it can see in a straight, clear line (so it cuts across open
 * floor and runs straight down corridors instead of stair-stepping tile by tile), and keeps clear of the
 * people crowding it. The resulting heading is turned into the arrow keys a person would hold.
 */

/** Tiles of route looked ahead for a point in clear sight. */
const LOOKAHEAD_TILES = 10;
/** A heading counts towards an axis key only when it leans that way at least this much. */
const KEY_LEAN = 0.38;
/** Half-width, in pixels, of the body that has to fit along a straight line. */
const BODY = 8;
const SAMPLE_STEP = 6;
/** Pixels at which people crowding each other start to push apart. */
const PERSONAL_SPACE = 26;

type Body = { vehicle: Vehicle; path: Path; follow: FollowPathBehavior; separation: SeparationBehavior };
const bodies = new WeakMap<Entity, Body>();
const neighbourPool: Vehicle[] = [];
const force = new Vector3();

function bodyOf(entity: Entity): Body {
  let body = bodies.get(entity);
  if (!body) {
    const vehicle = new Vehicle();
    vehicle.maxSpeed = 2;
    vehicle.maxForce = 4;
    const path = new Path();
    const follow = new FollowPathBehavior(path, 8);
    const separation = new SeparationBehavior();
    separation.weight = 0.6;
    vehicle.steering.add(follow);
    vehicle.steering.add(separation);
    body = { vehicle, path, follow, separation };
    bodies.set(entity, body);
  }
  return body;
}

/** Whether a body can walk the straight line between two points without touching a wall, pit edge or obstacle. */
function clearLine(level: Level, cost: Float32Array, ax: number, ay: number, bx: number, by: number): boolean {
  const length = Math.hypot(bx - ax, by - ay);
  const steps = Math.max(1, Math.ceil(length / SAMPLE_STEP));
  for (let i = 1; i <= steps; i++) {
    const x = ax + ((bx - ax) * i) / steps;
    const y = ay + ((by - ay) * i) / steps;
    for (const [ox, oy] of [[-BODY, -BODY], [BODY, -BODY], [-BODY, BODY], [BODY, BODY]]) {
      const tx = Math.floor((x + ox) / TILE_WIDTH);
      const ty = Math.floor((y + oy) / TILE_WIDTH);
      if (tx < 0 || ty < 0 || tx >= level.width || ty >= level.height || cost[tx + ty * level.width] > 1) return false;
    }
  }
  return true;
}

/** Index in the route of the farthest tile centre in clear sight from where it stands. */
function farthestInSight(level: Level, brain: Brain, x: number, y: number): number {
  const cost = brain.field!.cost;
  const last = Math.min(brain.path.length - 1, LOOKAHEAD_TILES);
  for (let i = last; i > 0; i--) {
    const t = brain.path[i];
    if (clearLine(level, cost, x, y, centreX(t % level.width), centreY(Math.floor(t / level.width)))) return i;
  }
  return 0;
}

/**
 * Sets the movement keys in `out` for one tick of walking along `brain.path`. The path must be
 * non-empty; the caller drops tiles already passed.
 */
export function drive(level: Level, entity: Entity, brain: Brain, out: Controls): void {
  const pos = entity.position!;
  const body = bodyOf(entity);
  const w = level.width;
  const aim = farthestInSight(level, brain, pos.x, pos.y);

  // The route as points: the far point in sight, then the next few tiles, so arriving at it never slows to a stop.
  body.path.clear();
  let endX = pos.x;
  let endY = pos.y;
  for (let i = aim; i < Math.min(brain.path.length, aim + 3); i++) {
    endX = centreX(brain.path[i] % w);
    endY = centreY(Math.floor(brain.path[i] / w));
    body.path.add(new Vector3(endX, 0, endY));
  }
  const vehicle = body.vehicle;
  vehicle.position.set(pos.x, 0, pos.y);
  // Zero velocity makes the seek force a pure heading, whatever speed it already has.
  vehicle.velocity.set(0, 0, 0);

  vehicle.neighbors.length = 0;
  let used = 0;
  for (const other of nearby(pos.x, pos.y, PERSONAL_SPACE, ['player'])) {
    if (other === entity) continue;
    const neighbour = neighbourPool[used] ?? (neighbourPool[used] = new Vehicle());
    neighbour.position.set(other.position!.x, 0, other.position!.y);
    vehicle.neighbors.push(neighbour);
    used++;
  }

  vehicle.steering.calculate(1 / 60, force);
  const length = Math.hypot(force.x, force.z);
  out.up = out.down = out.left = out.right = false;
  if (length < 1e-4) return;
  // On the final tile's middle: no key is needed.
  if (brain.path.length === 1 && Math.hypot(endX - pos.x, endY - pos.y) < 2.5) return;
  const ux = force.x / length;
  const uy = force.z / length;
  out.right = ux > KEY_LEAN;
  out.left = ux < -KEY_LEAN;
  out.down = uy > KEY_LEAN;
  out.up = uy < -KEY_LEAN;
}
