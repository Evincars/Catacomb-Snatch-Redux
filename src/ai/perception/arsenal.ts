import { world } from '../../world';
import type { Entity } from '../../world';
import type { Level } from '../../level/Level';
import { TileType } from '../../level/TileType';
import { WEAPON_STATS } from '../../entities/WeaponStats';
import { BULLET_CONFIGS } from '../../entities/BulletFactory';
import { RANGE_BANDS } from '../constants';
import { STRAIGHT } from '../types';
import type { Aim } from '../types';

/** Expected damage per second against a target `d` pixels away; 0 when out of reach. */
export function weaponValue(kind: string, d: number, aim: Aim = STRAIGHT): number {
  const stats = WEAPON_STATS[kind];
  const bullet = stats ? BULLET_CONFIGS[stats.bullet] : undefined;
  if (!stats || !bullet) return 0;
  // Round a corner only a bouncing shot arrives, and it travels further than the straight line.
  if (aim.bank ? !bullet.bounces : d > bullet.range) return 0;
  const flight = d / bullet.speed;
  const damage = Math.max(0.5, bullet.damage - (bullet.damageFalloff ?? 0) * flight);
  // Pellets spread over `accuracy` radians; the share that hits a body ~16px wide.
  const spread = Math.max(1, d * stats.accuracy * 2);
  const hitShare = Math.min(1, 16 / spread);
  const bounce = 1 + (bullet.bounces ?? 0) * 0.08;
  // A slow shot at something on the move is mostly dodged; a fast one, or one at a standing target, is not.
  const dodge = 1 / (1 + (flight * aim.speed) / 16);
  return damage * stats.pellets * hitShare * bounce * dodge * 60 / Math.max(1, stats.cooldown);
}

/** Best gun for the distance and the target; `safe` rules out guns whose kick would be dangerous. */
export function bestSlot(entity: Entity, d: number, safe: (weapon: string) => boolean = () => true, aim: Aim = STRAIGHT): number {
  const inv = entity.weaponInventory!;
  let best = inv.current;
  let bestValue = safe(inv.weapons[inv.current]) ? weaponValue(inv.weapons[inv.current], d, aim) : 0;
  inv.weapons.forEach((w, i) => {
    const v = safe(w) ? weaponValue(w, d, aim) : 0;
    if (v > bestValue * 1.1) {
      best = i;
      bestValue = v;
    }
  });
  return best;
}

/** Slot of the first owned gun whose shots bounce, or -1. */
export function bouncingSlot(entity: Entity): number {
  return entity.weaponInventory!.weapons.findIndex((w) => (BULLET_CONFIGS[WEAPON_STATS[w]?.bullet]?.bounces ?? 0) > 0);
}

/** How much a weapon would add to the arsenal, as the summed gain over the range bands. */
export function weaponGain(entity: Entity, kind: string): number {
  const owned = entity.weaponInventory!.weapons;
  let gain = 0;
  for (const d of RANGE_BANDS) {
    const have = Math.max(0, ...owned.map((w) => weaponValue(w, d)));
    gain += Math.max(0, weaponValue(kind, d) - have);
  }
  return gain;
}

/** Whether firing a gun along the current aim would shove the shooter into a pit. */
export function kickedIntoPit(level: Level, entity: Entity, weapon: string): boolean {
  const aim = entity.aimVector;
  if (!aim) return false;
  // Recoil goes into velocity, which friction (0.4) lets coast about 1.7 times as far.
  const kick = (WEAPON_STATS[weapon]?.recoil ?? 0) * 1.7 + 6;
  const type = level.getTileAt(entity.position!.x - aim.x * kick, entity.position!.y - aim.y * kick)?.type;
  return type === TileType.Hole || type === TileType.DropTrap;
}

/** Whether an unlit bomb lies close to the line of fire, short of the target. */
export function bombInLine(entity: Entity, angle: number, reach: number): boolean {
  const pos = entity.position!;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  for (const b of world.with('bomb', 'position')) {
    if (b.removed || b.bomb!.lit || b.carriedBy !== undefined) continue;
    const dx = b.position!.x - pos.x;
    const dy = b.position!.y - (b.yOffset ?? 0) / 2 - pos.y;
    const along = dx * ux + dy * uy;
    if (along < -8 || along > reach + 16) continue;
    // Spread widens the cone a little with distance.
    if (Math.abs(dx * uy - dy * ux) < 16 + Math.max(0, along) * 0.15) return true;
  }
  return false;
}
