import { world } from '../world';
import type { Entity } from '../world';
import { findPath } from '../level/AStar';
import type { Level } from '../level/Level';
import { TILE_WIDTH, TILE_HEIGHT, TileType } from '../level/TileType';

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

function distSqr(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

/** Mobs are Team.Neutral and hunt players, so targeting is by role, not team. */
function nearestPlayer(from: { x: number; y: number }): Entity | null {
  let nearest: Entity | null = null;
  let nearestDist = Infinity;

  for (const candidate of world.with('position', 'health', 'playerInput')) {
    if (candidate.health!.current <= 0) continue;
    const d = distSqr(from, candidate.position!);
    if (d < nearestDist) {
      nearestDist = d;
      nearest = candidate;
    }
  }
  return nearest;
}

/** How far ahead of its feet a mob checks for a pit before stepping. */
const PIT_LOOKAHEAD = 16;

/** Pushes the mob along (dx, dy) unless a pit lies just ahead; returns whether it moved. */
function walkTowards(level: Level, entity: Entity, dx: number, dy: number): boolean {
  const pos = entity.position!;
  const vel = entity.velocity!;
  const speed = entity.speed ?? WALK_SPEED;
  // Bats fly over pits.
  if (entity.mobType !== 'bat') {
    const len = Math.hypot(dx, dy) || 1;
    const ahead = level.getTileAt(pos.x + (dx / len) * PIT_LOOKAHEAD, pos.y + (dy / len) * PIT_LOOKAHEAD);
    if (ahead?.type === TileType.Hole) return false;
  }
  const len = Math.hypot(dx, dy) || 1;
  vel.x += (dx / len) * speed;
  vel.y += (dy / len) * speed;
  return true;
}

const FACING_STEPS: ReadonlyArray<readonly [number, number]> = [[0, -1], [1, 0], [0, 1], [-1, 0]];

function chaseRange(entity: Entity): number {
  return CHASE_RANGE_BY_TYPE[entity.mobType ?? ''] ?? CHASE_RANGE;
}

/** Counts each target's pursuers and releases the farthest ones beyond MAX_CHASERS. */
function limitChasers(): Map<number, number> {
  const byTarget = new Map<number, Array<{ entity: Entity; dist: number }>>();
  for (const entity of world.with('position', 'ai')) {
    const ai = entity.ai!;
    if (ai.type !== 'chase' || ai.targetId === undefined) continue;
    const target = world.entity(ai.targetId);
    if (!target?.position) continue;
    let list = byTarget.get(ai.targetId);
    if (!list) byTarget.set(ai.targetId, list = []);
    list.push({ entity, dist: distSqr(entity.position!, target.position) });
  }

  const counts = new Map<number, number>();
  for (const [targetId, list] of byTarget) {
    list.sort((a, b) => a.dist - b.dist);
    for (const { entity } of list.slice(MAX_CHASERS)) {
      const ai = entity.ai!;
      ai.type = 'wander';
      ai.path = undefined;
      ai.retargetIn = DROPPED_COOLDOWN;
      entity.chasing = false;
    }
    counts.set(targetId, Math.min(list.length, MAX_CHASERS));
  }
  return counts;
}

export function updateAI(level: Level, _dt: number): void {
  const chasers = limitChasers();
  for (const entity of world.with('position', 'velocity', 'ai', 'radius')) {
    const ai = entity.ai!;
    const pos = entity.position!;
    const vel = entity.velocity!;
    const speed = entity.speed ?? WALK_SPEED;

    if ((entity.freezeTime ?? 0) > 0) continue;

    // Java's limp: the mob skips movement on part of its walk cycle, which is
    // a large part of why mobs read as slow and lurching rather than sprinting.
    entity.walkTime = (entity.walkTime ?? 0) + 1;
    const limp = entity.limp ?? 0;
    if (limp > 0 && Math.floor(entity.walkTime / 12) % limp === 0) continue;

    if (ai.type === 'wander') {

      if (entity.walkTime % WANDER_TURN_TICKS === 0 || entity.facing === undefined) {
        entity.facing = Math.floor(Math.random() * 4);
      }

      const facing = entity.facing ?? 0;
      if (!walkTowards(level, entity, FACING_STEPS[facing][0], FACING_STEPS[facing][1])) {
        // A pit ahead: turn to a direction that is clear.
        const clear = [0, 1, 2, 3].filter((f) => f !== facing
          && walkTowards(level, entity, FACING_STEPS[f][0], FACING_STEPS[f][1]));
        if (clear.length > 0) entity.facing = clear[Math.floor(Math.random() * clear.length)];
      }

      ai.retargetIn = (ai.retargetIn ?? 0) - 1;
      if (ai.retargetIn <= 0) {
        ai.retargetIn = RETARGET_TICKS;
        const target = nearestPlayer(pos);
        const targetId = target ? world.id(target) : undefined;
        if (target && targetId !== undefined && distSqr(pos, target.position!) < chaseRange(entity) ** 2
          && (chasers.get(targetId) ?? 0) < MAX_CHASERS) {
          chasers.set(targetId, (chasers.get(targetId) ?? 0) + 1);
          ai.type = 'chase';
          ai.targetId = targetId;
          ai.repathIn = 0;
          ai.path = undefined;
        }
      }
      continue;
    }

    if (ai.type !== 'chase') continue;

    const target = ai.targetId !== undefined ? world.entity(ai.targetId) : null;
    if (!target?.position || (target.health?.current ?? 0) <= 0) {
      ai.type = 'wander';
      ai.path = undefined;
      continue;
    }

    if (distSqr(pos, target.position) > (chaseRange(entity) * GIVE_UP_FACTOR) ** 2) {
      ai.type = 'wander';
      ai.path = undefined;
      entity.chasing = false;
      continue;
    }

    ai.repathIn = (ai.repathIn ?? 0) - 1;
    if (ai.repathIn <= 0) {
      ai.repathIn = REPATH_TICKS;
      const route = findPath(level, pos, target.position);
      ai.path = route.success ? route.nodes.slice(1) : undefined;
    }

    entity.chasing = true;

    // Follow the cached route, dropping waypoints as they are reached.
    const path = ai.path;
    if (path && path.length > 0) {
      const next = path[0];
      const nx = next.x * TILE_WIDTH + TILE_WIDTH / 2;
      const ny = next.y * TILE_HEIGHT + TILE_HEIGHT / 2;
      const dx = nx - pos.x;
      const dy = ny - pos.y;
      const len = Math.hypot(dx, dy);

      if (len < 4) {
        path.shift();
      } else {
        if (!walkTowards(level, entity, dx, dy)) ai.repathIn = 0;
        entity.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
      }
    } else {
      // No route available — close in directly so mobs still threaten.
      const dx = target.position.x - pos.x;
      const dy = target.position.y - pos.y;
      walkTowards(level, entity, dx, dy);
      entity.facing = Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0);
    }
  }
}
