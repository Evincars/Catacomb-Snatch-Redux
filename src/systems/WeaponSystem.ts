import { world } from '../world';
import { createBullet } from '../entities/BulletFactory';
import { WEAPON_STATS } from '../entities/WeaponStats';
import { spawnMuzzleFlash } from '../entities/FxFactory';
import { sound } from '../audio/SoundPlayer';

/** Fires player weapons while the shoot input is held, respecting cooldowns. */
export function updateWeapons(_dt: number): void {
  for (const entity of world.with('position', 'playerInput', 'weapon', 'aimVector')) {
    const weapon = entity.weapon!;
    const pi = entity.playerInput!;
    const aim = entity.aimVector!;

    if (weapon.currentCooldown > 0) weapon.currentCooldown--;

    // Firing is deliberately allowed while frozen — Java calls handleWeaponFire
    // regardless of freezeTime, so being hit never disarms the player.
    if (!pi.shoot) continue;
    if (weapon.currentCooldown > 0) continue;
    if (aim.x === 0 && aim.y === 0) continue;

    const stats = WEAPON_STATS[weapon.type] ?? WEAPON_STATS.rifle;
    weapon.currentCooldown = weapon.cooldown;

    // Sprinting doubles the aim error, as in Java.
    const sprinting = entity.playerStats?.sprinting ?? false;
    const aimAngle = Math.atan2(aim.y, aim.x);
    const spread = stats.accuracy * (sprinting ? 2 : 1);

    // Java's shotgun widens the spread with each pellet (accuracy * i).
    let sumX = 0;
    let sumY = 0;
    for (let i = 0; i < stats.pellets; i++) {
      const error = (Math.random() - Math.random()) * spread * (stats.pellets > 1 ? i : 1);
      const dirX = Math.cos(aimAngle + error);
      const dirY = Math.sin(aimAngle + error);
      createBullet(entity, stats.bullet, dirX, dirY);
      sumX += dirX;
      sumY += dirY;
    }

    spawnMuzzleFlash(entity, sumX / stats.pellets, sumY / stats.pellets);

    // Recoil kicks the shooter backwards against the average shot direction.
    const vel = entity.velocity;
    if (vel) {
      const len = Math.hypot(sumX, sumY) || 1;
      vel.x -= (sumX / len) * stats.recoil;
      vel.y -= (sumY / len) * stats.recoil;
    }

    const pos = entity.position!;
    sound.playOneOf(['shot1', 'shot2'], pos.x, pos.y);
  }
}
