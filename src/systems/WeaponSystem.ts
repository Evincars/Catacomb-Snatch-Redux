import { world } from '../world';
import { createBullet } from '../entities/BulletFactory';
import type { BulletType } from '../entities/BulletFactory';
import { sound } from '../audio/SoundPlayer';

const SHOTGUN_PELLETS = 5;
const SHOTGUN_SPREAD = 0.35;

/** Fires player weapons while the shoot input is held, respecting cooldowns. */
export function updateWeapons(_dt: number): void {
  for (const entity of world.with('position', 'playerInput', 'weapon', 'aimVector')) {
    const weapon = entity.weapon!;
    const pi = entity.playerInput!;
    const aim = entity.aimVector!;
    const stats = entity.playerStats;

    if (weapon.currentCooldown > 0) weapon.currentCooldown--;
    if (stats && stats.muzzleTicks > 0) stats.muzzleTicks--;

    if (!pi.shoot) continue;
    if (weapon.currentCooldown > 0) continue;
    if ((entity.freezeTime ?? 0) > 0) continue;
    if (aim.x === 0 && aim.y === 0) continue;

    weapon.currentCooldown = weapon.cooldown;
    const type = weapon.type as BulletType;

    if (type === 'shotgun') {
      for (let i = 0; i < SHOTGUN_PELLETS; i++) {
        const spread = (i / (SHOTGUN_PELLETS - 1) - 0.5) * SHOTGUN_SPREAD;
        const cos = Math.cos(spread);
        const sin = Math.sin(spread);
        createBullet(entity, type, aim.x * cos - aim.y * sin, aim.x * sin + aim.y * cos);
      }
    } else {
      createBullet(entity, type, aim.x, aim.y);
    }

    if (stats) {
      stats.muzzleTicks = 3;
      stats.muzzleX = aim.x;
      stats.muzzleY = aim.y;
    }

    const pos = entity.position!;
    sound.playOneOf(['shot1', 'shot2'], pos.x, pos.y);
  }
}
