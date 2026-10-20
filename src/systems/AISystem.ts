import { world } from '../world';
import type { Entity } from '../world';
import type { Level } from '../level/Level';
import { TILE_WIDTH, TILE_HEIGHT, TileType } from '../level/TileType';
import { tileGraphOf } from '../level/TileGraph';
import type { StepCost } from '../level/TileGraph';
import { findRoute } from '../level/TileSearch';

const prey = world.with('position', 'health', 'playerInput');
const pursuers = world.with('position', 'ai');
const walkingMobs = world.with('position', 'velocity', 'ai', 'radius');

const WALK_SPEED = 0.8;
/** Java's ATTACK_RADIUS: mummies notice a player 128px away, pharaohs 5 tiles away. */
const CHASE_RANGE = 4 * TILE_WIDTH;
const CHASE_RANGE_BY_TYPE: Record<string, number> = { pharao: 5 * TILE_WIDTH };
const GIVE_UP_FACTOR = 1.5;
/** No more mobs than this hound one player at once; the farthest ones drop out, so a trail never grows into a mob. */
export const MAX_CHASERS = 4;
/** Ticks a mob that was dropped from a pursuit ignores players. */
const DROPPED_COOLDOWN = 180;
/** A* is far too costly to run per mob per frame, so routes are reused. */
const REPATH_TICKS = 20;
const RETARGET_TICKS = 15;
const WANDER_TURN_TICKS = 60;
/** How far ahead of its feet a mob checks for a pit before stepping. */
const PIT_LOOKAHEAD = 16;
/** Pixels from a waypoint's centre at which it counts as reached. */
const WAYPOINT_REACHED = 4;

const FACING_STEPS: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const FACINGS = [0, 1, 2, 3] as const;

type Point = { x: number; y: number };
type MobAI = NonNullable<Entity['ai']>;

function distSqr(a: Point, b: Point): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

/** Mobs are Team.Neutral and hunt players, so targeting is by role, not team. */
function nearestPlayer(from: Point): Entity | null {
  let nearest: Entity | null = null;
  let nearestDist = Infinity;
  for (const candidate of prey) {
    if (candidate.health!.current <= 0) continue;
    const d = distSqr(from, candidate.position!);
    if (d >= nearestDist) continue;
    nearestDist = d;
    nearest = candidate;
  }
  return nearest;
}

/** Mobs plan around pits: a route over one would only walk them to their death. */
function mobStep(level: Level): StepCost {
  return (_from, to) => {
    const tile = level.getTile(to % level.width, Math.floor(to / level.width));
    return tile !== null && tile.passable && tile.type !== TileType.Hole ? 1 : Infinity;
  };
}

/** Grid waypoints from one point to another by Yuka's A*, or undefined when there is no way. */
export function findMobPath(level: Level, from: Point, to: Point): Point[] | undefined {
  const start = Math.floor(from.x / TILE_WIDTH) + Math.floor(from.y / TILE_HEIGHT) * level.width;
  const goal = Math.floor(to.x / TILE_WIDTH) + Math.floor(to.y / TILE_HEIGHT) * level.width;
  const step = mobStep(level);
  if (step(start, start) === Infinity) return undefined;
  const route = findRoute(tileGraphOf(level), start, goal, step);
  if (route.length === 0) return undefined;
  return route.map((t) => ({ x: t % level.width, y: Math.floor(t / level.width) }));
}

/** Pushes the mob along (dx, dy) unless a pit lies just ahead; returns whether it moved. */
function walkTowards(level: Level, entity: Entity, dx: number, dy: number): boolean {
  const pos = entity.position!;
  const vel = entity.velocity!;
  const speed = entity.speed ?? WALK_SPEED;
  const len = Math.hypot(dx, dy) || 1;
  // Bats fly over pits.
  const ahead = level.getTileAt(pos.x + (dx / len) * PIT_LOOKAHEAD, pos.y + (dy / len) * PIT_LOOKAHEAD);
  if (entity.mobType !== 'bat' && ahead?.type === TileType.Hole) return false;
  vel.x += (dx / len) * speed;
  vel.y += (dy / len) * speed;
  return true;
}

function faceTowards(entity: Entity, dx: number, dy: number): void {
  entity.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
}

function chaseRange(entity: Entity): number {
  return CHASE_RANGE_BY_TYPE[entity.mobType ?? ''] ?? CHASE_RANGE;
}

function stopChasing(entity: Entity, ai: MobAI): void {
  ai.type = 'wander';
  ai.path = undefined;
  entity.chasing = false;
}

/** Counts each target's pursuers and releases the farthest ones beyond MAX_CHASERS. */
function limitChasers(): Map<number, number> {
  const byTarget = new Map<number, Array<{ entity: Entity; dist: number }>>();
  for (const entity of pursuers) {
    const ai = entity.ai!;
    const target = ai.type === 'chase' && ai.targetId !== undefined ? world.entity(ai.targetId) : undefined;
    if (!target?.position) continue;
    let list = byTarget.get(ai.targetId!);
    if (!list) byTarget.set(ai.targetId!, list = []);
    list.push({ entity, dist: distSqr(entity.position!, target.position) });
  }

  const counts = new Map<number, number>();
  for (const [targetId, list] of byTarget) {
    list.sort((a, b) => a.dist - b.dist);
    for (let i = MAX_CHASERS; i < list.length; i++) {
      stopChasing(list[i].entity, list[i].entity.ai!);
      list[i].entity.ai!.retargetIn = DROPPED_COOLDOWN;
    }
    counts.set(targetId, Math.min(list.length, MAX_CHASERS));
  }
  return counts;
}

/** Java's limp: the mob skips movement on part of its walk cycle, which is why mobs read as slow and lurching. */
function limping(entity: Entity): boolean {
  entity.walkTime = (entity.walkTime ?? 0) + 1;
  const limp = entity.limp ?? 0;
  return limp > 0 && Math.floor(entity.walkTime / 12) % limp === 0;
}

/** Ambles in one direction, turning now and then, and away from pits. */
function wander(level: Level, entity: Entity): void {
  if (entity.walkTime! % WANDER_TURN_TICKS === 0 || entity.facing === undefined) {
    entity.facing = Math.floor(Math.random() * 4);
  }
  const facing = entity.facing;
  if (walkTowards(level, entity, FACING_STEPS[facing][0], FACING_STEPS[facing][1])) return;
  // A pit ahead: turn to a direction that is clear.
  const clear = FACINGS.filter((f) => f !== facing && walkTowards(level, entity, FACING_STEPS[f][0], FACING_STEPS[f][1]));
  if (clear.length > 0) entity.facing = clear[Math.floor(Math.random() * clear.length)];
}

/** Every so often looks for a player in range with room for another pursuer, and goes after them. */
function lookForPrey(entity: Entity, ai: MobAI, chasers: Map<number, number>): void {
  ai.retargetIn = (ai.retargetIn ?? 0) - 1;
  if (ai.retargetIn > 0) return;
  ai.retargetIn = RETARGET_TICKS;
  const target = nearestPlayer(entity.position!);
  const targetId = target ? world.id(target) : undefined;
  if (!target || targetId === undefined) return;
  const inRange = distSqr(entity.position!, target.position!) < chaseRange(entity) ** 2;
  const taken = chasers.get(targetId) ?? 0;
  if (!inRange || taken >= MAX_CHASERS) return;
  chasers.set(targetId, taken + 1);
  ai.type = 'chase';
  ai.targetId = targetId;
  ai.repathIn = 0;
  ai.path = undefined;
}

/** The chased player, or null once the chase is over (they died, or got too far away). */
function chaseTarget(entity: Entity, ai: MobAI): Entity | null {
  const target = ai.targetId !== undefined ? world.entity(ai.targetId) : undefined;
  if (!target?.position || (target.health?.current ?? 0) <= 0) {
    ai.type = 'wander';
    ai.path = undefined;
    return null;
  }
  if (distSqr(entity.position!, target.position) > (chaseRange(entity) * GIVE_UP_FACTOR) ** 2) {
    stopChasing(entity, ai);
    return null;
  }
  return target;
}

/** Follows the cached route, dropping waypoints as they are reached; with no route, closes in directly. */
function followRoute(level: Level, entity: Entity, ai: MobAI, target: Point): void {
  const pos = entity.position!;
  const next = ai.path?.[0];
  if (!next) {
    // No route available — close in directly so mobs still threaten.
    walkTowards(level, entity, target.x - pos.x, target.y - pos.y);
    faceTowards(entity, target.x - pos.x, target.y - pos.y);
    return;
  }
  const dx = next.x * TILE_WIDTH + TILE_WIDTH / 2 - pos.x;
  const dy = next.y * TILE_HEIGHT + TILE_HEIGHT / 2 - pos.y;
  if (Math.hypot(dx, dy) < WAYPOINT_REACHED) {
    ai.path!.shift();
    return;
  }
  if (!walkTowards(level, entity, dx, dy)) ai.repathIn = 0;
  faceTowards(entity, dx, dy);
}

function chase(level: Level, entity: Entity, ai: MobAI): void {
  const target = chaseTarget(entity, ai);
  if (!target) return;
  ai.repathIn = (ai.repathIn ?? 0) - 1;
  if (ai.repathIn <= 0) {
    ai.repathIn = REPATH_TICKS;
    ai.path = findMobPath(level, entity.position!, target.position!);
  }
  entity.chasing = true;
  followRoute(level, entity, ai, target.position!);
}

export function updateAI(level: Level, _dt: number): void {
  const chasers = limitChasers();
  for (const entity of walkingMobs) {
    const ai = entity.ai!;
    if ((entity.freezeTime ?? 0) > 0 || limping(entity)) continue;
    if (ai.type === 'wander') {
      wander(level, entity);
      lookForPrey(entity, ai, chasers);
    } else if (ai.type === 'chase') {
      chase(level, entity, ai);
    }
  }
}
