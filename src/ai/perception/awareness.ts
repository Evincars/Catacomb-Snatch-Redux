import { world, Team } from '../../world';
import type { Entity } from '../../world';
import type { Level } from '../../level/Level';
import { isVersus } from '../../game/GameState';
import type { AIDifficulty } from '../../game/GameState';
import { WEAPON_STATS } from '../../entities/WeaponStats';
import { BULLET_CONFIGS } from '../../entities/BulletFactory';
import { solveRicochet } from './ricochet';
import { INF } from '../constants';
import { bouncingSlot } from './arsenal';
import { alive, dist } from './geometry';
import { nearby } from './spatial';
import type { Brain } from '../types';

export function hostile(entity: Entity, other: Entity): boolean {
  if (other === entity || !alive(other) || other.removed || other.carriedBy !== undefined) return false;
  if (other.ai || other.spawner) return other.team !== entity.team;
  if (!isVersus() || other.team === undefined || other.team === Team.Neutral || other.team === entity.team) return false;
  if (other.playerInput) return other.respawnTicks === undefined && !other.spawnProtected && !other.falling;
  return (other.building !== undefined && other.building.type !== 'treasure' && other.building.type !== 'shop'
    && !other.bomb) || other.railDroid !== undefined;
}

export function enemiesNear(entity: Entity, range: number): boolean {
  const pos = entity.position!;
  return nearby(pos.x, pos.y, range, ['mob', 'player']).some((e) => hostile(entity, e));
}

/** Rival players within range that have a clear line to the entity. */
export function rivalsInSight(level: Level, entity: Entity, range: number): number {
  const pos = entity.position!;
  return nearby(pos.x, pos.y, range, ['player']).filter((e) => hostile(entity, e)
    && level.checkLineOfSight(pos.x, pos.y, e.position!.x, e.position!.y)).length;
}

/** Mobs within range that can actually get at the entity (not shut in behind a wall). */
export function mobsNear(level: Level, entity: Entity, range: number, pos = entity.position!): number {
  return nearby(pos.x, pos.y, range, ['mob']).filter((e) => hostile(entity, e)
    && level.checkLineOfSight(pos.x, pos.y, e.position!.x, e.position!.y)).length;
}

/** Direction away from the mobs pressing in, weighted by closeness; null when none are close. */
export function crowdEscape(level: Level, entity: Entity, range: number): { x: number; y: number; count: number } | null {
  const pos = entity.position!;
  let x = 0;
  let y = 0;
  let count = 0;
  for (const e of nearby(pos.x, pos.y, range, ['mob'])) {
    if (!hostile(entity, e)) continue;
    const dx = pos.x - e.position!.x;
    const dy = pos.y - e.position!.y;
    const d = Math.hypot(dx, dy);
    if (d >= range || !level.checkLineOfSight(pos.x, pos.y, e.position!.x, e.position!.y)) continue;
    const w = (range - d) / range / Math.max(d, 1);
    x += dx * w;
    y += dy * w;
    count++;
  }
  return count > 0 && (x !== 0 || y !== 0) ? { x, y, count } : null;
}

export function pickEnemy(level: Level, entity: Entity, profile: AIDifficulty, focusId?: number): Entity | null {
  const pos = entity.position!;
  const weapon = entity.weaponInventory!.weapons;
  const reach = Math.min(profile.engageRange,
    Math.max(...weapon.map((w) => BULLET_CONFIGS[WEAPON_STATS[w]?.bullet]?.range ?? 0)));
  let best: Entity | null = null;
  let bestScore = INF;
  for (const e of nearby(pos.x, pos.y, reach, ['player', 'mob', 'nest', 'machine', 'building'])) {
    if (!hostile(entity, e) || !e.health) continue;
    const d = dist(e.position!, pos);
    if (d > reach || !level.checkLineOfSight(pos.x, pos.y, e.position!.x, e.position!.y)) continue;
    // People first, then whatever is closest; property last.
    let score = d;
    // What it set out to hunt comes first, unless something is already biting.
    if (focusId !== undefined && world.id(e) === focusId) score -= 200;
    else if (e.ai && d < 40) score -= 300;
    if (e.playerInput) score -= 120;
    else if (e.building || e.railDroid) score += 80;
    if (score < bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

/**
 * A rival that cannot be seen but can be hit: with a bouncing gun in hand it rehearses shots off the
 * walls and, when one reaches the rival, remembers its direction in `brain.bank`.
 */
export function pickHidden(level: Level, entity: Entity, brain: Brain, profile: AIDifficulty): Entity | null {
  const slot = profile.ricochet && entity.carryingId === undefined ? bouncingSlot(entity) : -1;
  if (slot < 0) {
    brain.bank = null;
    return null;
  }
  const pos = entity.position!;
  const stats = WEAPON_STATS[entity.weaponInventory!.weapons[slot]];
  const gun = BULLET_CONFIGS[stats.bullet];
  // A shot that has bounced keeps flying a while longer, so rivals a little beyond plain range are worth trying.
  const reach = Math.min(profile.engageRange * 1.4, gun.range + 60);
  let target: Entity | null = null;
  let nearest = INF;
  for (const e of nearby(pos.x, pos.y, reach, ['player'])) {
    if (!hostile(entity, e)) continue;
    const d = dist(e.position!, pos);
    if (d < nearest && d <= reach && !level.checkLineOfSight(pos.x, pos.y, e.position!.x, e.position!.y)) {
      nearest = d;
      target = e;
    }
  }
  if (!target) {
    brain.bank = null;
    return null;
  }
  const id = world.id(target)!;
  const fresh = brain.bank?.targetId === id && brain.age - brain.bank.at < 8;
  // Working a shot out is the costly part, so it is not repeated every glance.
  if (!fresh && brain.bankCool <= 0) {
    const rad = target.radius ?? { x: 10, y: 10 };
    const yOff = target.yOffset ?? 0;
    const shot = solveRicochet(level, pos, { speed: gun.speed, range: gun.range, bounces: gun.bounces ?? 0, radius: gun.radius }, {
      x: target.position!.x, y: target.position!.y - yOff, hw: rad.x, hh: rad.y + yOff / 2,
      vx: target.velocity?.x, vy: target.velocity?.y,
    });
    brain.bank = shot ? { targetId: id, shot, at: brain.age } : null;
    brain.bankCool = shot ? 0 : 12;
  }
  if (brain.bankCool > 0) brain.bankCool--;
  return brain.bank?.targetId === id ? target : null;
}
