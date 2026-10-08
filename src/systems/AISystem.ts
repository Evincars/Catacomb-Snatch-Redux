import { world, Team } from '../world';
import type { Entity } from '../world';
import { findPath } from '../level/AStar';
import type { Level } from '../level/Level';
import { TILE_WIDTH, TILE_HEIGHT } from '../level/TileType';

const WALK_SPEED = 0.8;
const CHASE_RANGE_SQR = (12 * TILE_WIDTH) ** 2;

function distSqr(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}

function nearestEnemy(mob: Entity): Entity | null {
  const mTeam = mob.team;
  let nearest: Entity | null = null;
  let nearestDist = Infinity;

  for (const e of world.with('position', 'health', 'team')) {
    if (e === mob) continue;
    const eTeam = e.team;
    if (mTeam === Team.Neutral || eTeam === Team.Neutral) continue;
    if (eTeam === mTeam) continue;
    const d = distSqr(mob.position!, e.position!);
    if (d < nearestDist) { nearestDist = d; nearest = e; }
  }
  return nearest;
}

export function updateAI(level: Level, _dt: number): void {
  for (const entity of world.with('position', 'velocity', 'ai', 'radius')) {
    const ai = entity.ai!;
    const pos = entity.position!;
    const vel = entity.velocity!;
    const speed = entity.speed ?? WALK_SPEED;

    if (ai.type === 'wander') {
      // Simple random wander: pick random direction and walk
      if (!entity.walkTime) entity.walkTime = 0;
      entity.walkTime++;

      if (entity.walkTime % 60 === 0 || entity.facing === undefined) {
        entity.facing = Math.floor(Math.random() * 4);
      }

      const facing = entity.facing ?? 0;
      switch (facing) {
        case 0: vel.y -= speed; break; // North
        case 1: vel.x += speed; break; // East
        case 2: vel.y += speed; break; // South
        case 3: vel.x -= speed; break; // West
      }

      // Check if near a player and switch to chase
      const target = nearestEnemy(entity);
      if (target?.position && distSqr(pos, target.position) < CHASE_RANGE_SQR) {
        ai.type = 'chase';
        ai.targetId = world.id(target);
      }
    } else if (ai.type === 'chase') {
      const targetId = ai.targetId;
      const target = targetId !== undefined ? world.entity(targetId) : null;

      if (!target?.position) {
        ai.type = 'wander';
        continue;
      }

      if (distSqr(pos, target.position) > CHASE_RANGE_SQR * 1.5) {
        ai.type = 'wander';
        continue;
      }

      const path = findPath(level, pos, target.position);
      if (path.success && path.nodes.length > 1) {
        const next = path.nodes[1];
        const nx = next.x * TILE_WIDTH + TILE_WIDTH / 2;
        const ny = next.y * TILE_HEIGHT + TILE_HEIGHT / 2;
        const dx = nx - pos.x;
        const dy = ny - pos.y;
        const len = Math.sqrt(dx * dx + dy * dy) || 1;
        vel.x += (dx / len) * speed;
        vel.y += (dy / len) * speed;
        entity.chasing = true;
      } else {
        entity.chasing = false;
        ai.type = 'wander';
      }
    }

    // Apply bump impulse (knockback)
    if (entity.bump && (entity.freezeTime ?? 0) > 0) {
      vel.x += entity.bump.x;
      vel.y += entity.bump.y;
    }
  }
}
