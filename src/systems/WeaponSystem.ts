import { world } from '../world';
import { createBullet } from '../entities/BulletFactory';
import { WEAPON_STATS } from '../entities/WeaponStats';
import { spawnMuzzleFlash } from '../entities/FxFactory';
import { sound } from '../audio/SoundPlayer';
import { notify, quietly } from '../game/Notices';
import { SHOP_DEFS } from '../entities/ShopItemFactory';
import type { Entity, ShopKind } from '../world';

/** Equips a weapon from the inventory, keeping the cooldown so swapping cannot skip it. */
function equip(entity: Entity, index: number): void {
  const inv = entity.weaponInventory!;
  const type = inv.weapons[index];
  if (type === undefined || index === inv.current) return;

  inv.current = index;
  entity.weapon = {
    type,
    cooldown: WEAPON_STATS[type].cooldown,
    currentCooldown: entity.weapon?.currentCooldown ?? 0,
  };
  notify(SHOP_DEFS[type as ShopKind]?.label ?? type);
  sound.playSound('trackPlace');
}

/** Applies the slot keys, next/previous keys and mouse wheel. */
function updateWeaponSelection(entity: Entity): void {
  const inv = entity.weaponInventory;
  const intents = entity.playerInput?.intents;
  if (!inv || !intents) return;

  if (intents.weaponSlot >= 0) equip(entity, intents.weaponSlot);

  if (intents.weaponStep !== 0 && inv.weapons.length > 1) {
    const n = inv.weapons.length;
    equip(entity, (inv.current + intents.weaponStep + n) % n);
  }
}

/** Fires player weapons while the shoot input is held, respecting cooldowns. */
export function updateWeapons(_dt: number): void {
  for (const entity of world.with('position', 'playerInput', 'weapon', 'aimVector')) {
    if (entity.respawnTicks !== undefined || (entity.health?.current ?? 1) <= 0) continue;
    const pi = entity.playerInput!;
    const aim = entity.aimVector!;

    quietly(entity.aiPlayer !== undefined, () => updateWeaponSelection(entity));
    const weapon = entity.weapon!;

    if (weapon.currentCooldown > 0) weapon.currentCooldown--;

    // Firing is deliberately allowed while frozen — Java calls handleWeaponFire
    // regardless of freezeTime, so being hit never disarms the player.
    // Both hands are full while carrying a building.
    if (!pi.shoot || entity.falling || entity.carryingId !== undefined) continue;
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
    sound.playSound('shot1', pos.x, pos.y);
  }
}
