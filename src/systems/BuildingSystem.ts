import { world } from '../world';
import type { Entity } from '../world';
import type { Level } from '../level/Level';
import { createBullet } from '../entities/BulletFactory';
import { hurtEntity } from './CombatSystem';
import { Mth } from '../math/Mth';
import { sound } from '../audio/SoundPlayer';

/** Turrets shoot the nearest mob in range that they have line of sight to. */
export function updateTurrets(level: Level, _dt: number): void {
  for (const turretEntity of world.with('position', 'turret')) {
    const t = turretEntity.turret!;
    if (turretEntity.carriedBy !== undefined) continue;
    if ((turretEntity.health?.current ?? 1) <= 0) continue;

    if (t.cooldown > 0) {
      t.cooldown--;
      continue;
    }

    const pos = turretEntity.position!;
    let closest: Entity | null = null;
    let closestDist = Infinity;

    for (const mob of world.with('position', 'health', 'ai')) {
      if (mob.health!.current <= 0) continue;
      const d = (mob.position!.x - pos.x) ** 2 + (mob.position!.y - pos.y) ** 2;
      if (d >= t.radius ** 2 || d >= closestDist) continue;
      if (!level.checkLineOfSight(pos.x, pos.y, mob.position!.x, mob.position!.y)) continue;
      closestDist = d;
      closest = mob;
    }

    if (!closest) continue;

    const dx = closest.position!.x - pos.x;
    const dy = closest.position!.y - pos.y;
    turretEntity.facing8 = Mth.angleTo8(dx, dy);

    createBullet(turretEntity, 'rifle', dx, dy);
    t.cooldown = t.delay;
    sound.playSound('shot2', pos.x, pos.y);
  }
}

/** Vacuums loot within range toward the harvester and banks its value. */
export function updateHarvesters(_dt: number): void {
  for (const harvesterEntity of world.with('position', 'harvester')) {
    if (harvesterEntity.carriedBy !== undefined) continue;
    if ((harvesterEntity.health?.current ?? 1) <= 0) continue;

    const h = harvesterEntity.harvester!;
    const pos = harvesterEntity.position!;

    for (const lootEntity of world.with('position', 'loot')) {
      const lp = lootEntity.position!;
      const dx = lp.x - pos.x;
      const dy = lp.y - pos.y;
      const dist = Math.hypot(dx, dy);
      if (dist > h.radius) continue;

      if (dist < 8) {
        h.collected += lootEntity.loot!.value;
        world.removeComponent(lootEntity, 'loot');
        world.addComponent(lootEntity, 'removed', true);
        sound.playSound('smallCoin', lp.x, lp.y);
      } else {
        lootEntity.loot!.velX -= (dx / dist) * 1.2;
        lootEntity.loot!.velY -= (dy / dist) * 1.2;
      }
    }
  }
}

/**
 * Detonates bombs that have been destroyed, damaging every mob in the blast.
 * Runs before DeathSystem so the bomb still exists when it goes off.
 */
export function updateBombs(_dt: number): void {
  for (const bombEntity of world.with('position', 'bomb', 'health')) {
    if (bombEntity.health!.current > 0) continue;
    if (bombEntity.removed) continue;

    const { blastRadius, blastDamage } = bombEntity.bomb!;
    const pos = bombEntity.position!;

    for (const mob of world.with('position', 'health', 'ai')) {
      const d = Math.hypot(mob.position!.x - pos.x, mob.position!.y - pos.y);
      if (d < blastRadius) hurtEntity(mob, bombEntity, blastDamage);
    }

    sound.playSound('explosion2', pos.x, pos.y);
    // Clear the component so a single bomb cannot explode twice.
    world.removeComponent(bombEntity, 'bomb');
  }
}
