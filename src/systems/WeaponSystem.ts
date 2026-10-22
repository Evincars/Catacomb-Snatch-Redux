import { world } from '../world';
import type { Entity } from '../world';
import { createBullet, BULLET_CONFIGS } from '../entities/BulletFactory';
import { WEAPON_STATS } from '../entities/WeaponStats';
import type { WeaponStats } from '../entities/WeaponStats';
import { spawnMuzzleFlash } from '../entities/FxFactory';
import { sound } from '../audio/SoundPlayer';
import { notify, quietly } from '../game/Notices';
import { SHOP_DEFS } from '../entities/ShopItemFactory';
import { gunDamageScale } from '../ai/damage';
import { throwDownWeapon } from './DeathDropSystem';

const shooters = world.with('position', 'playerInput', 'weapon', 'aimVector');

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
  notify(SHOP_DEFS[type].label);
  sound.playSound('trackPlace');
}

/** The drop key throws the gun in hand down for someone else; the starting gun stays. */
function throwDown(entity: Entity): void {
  const kind = entity.weapon?.type;
  if (!throwDownWeapon(entity)) {
    notify('Your starting gun cannot be dropped');
    return;
  }
  if (kind) notify(`Dropped ${SHOP_DEFS[kind].label}`);
  sound.playSound('trackPlace', entity.position!.x, entity.position!.y);
}

/** Applies the slot keys, next/previous keys, mouse wheel and the drop key. */
function updateWeaponSelection(entity: Entity): void {
  const inv = entity.weaponInventory;
  const intents = entity.playerInput?.intents;
  if (!inv || !intents) return;

  if (intents.dropWeapon) throwDown(entity);
  if (intents.weaponSlot >= 0) equip(entity, intents.weaponSlot);

  if (intents.weaponStep !== 0 && inv.weapons.length > 1) {
    const n = inv.weapons.length;
    equip(entity, (inv.current + intents.weaponStep + n) % n);
  }
}

/** Whether the trigger may be pulled this tick: held, cooled down, hands free and aimed somewhere. */
function readyToFire(entity: Entity): boolean {
  // Firing is deliberately allowed while frozen — Java calls handleWeaponFire
  // regardless of freezeTime, so being hit never disarms the player.
  // Both hands are full while carrying a building.
  if (!entity.playerInput!.shoot || entity.falling || entity.carryingId !== undefined) return false;
  const aim = entity.aimVector!;
  return entity.weapon!.currentCooldown <= 0 && (aim.x !== 0 || aim.y !== 0);
}

/**
 * Fires every pellet of one shot and returns their summed direction. Java's shotgun widens the spread
 * with each pellet (accuracy * i); sprinting doubles the aim error, as in Java.
 */
function firePellets(entity: Entity, stats: WeaponStats, damage: number): { x: number; y: number } {
  const aim = entity.aimVector!;
  const aimAngle = Math.atan2(aim.y, aim.x);
  const spread = stats.accuracy * (entity.playerStats?.sprinting ? 2 : 1);
  const sum = { x: 0, y: 0 };
  for (let i = 0; i < stats.pellets; i++) {
    const error = (Math.random() - Math.random()) * spread * (stats.pellets > 1 ? i : 1);
    const dirX = Math.cos(aimAngle + error);
    const dirY = Math.sin(aimAngle + error);
    createBullet(entity, stats.bullet, dirX, dirY, damage);
    sum.x += dirX;
    sum.y += dirY;
  }
  return sum;
}

/** Recoil kicks the shooter backwards against the average shot direction. */
function recoil(entity: Entity, stats: WeaponStats, sum: { x: number; y: number }): void {
  const vel = entity.velocity;
  if (!vel) return;
  const len = Math.hypot(sum.x, sum.y) || 1;
  vel.x -= (sum.x / len) * stats.recoil;
  vel.y -= (sum.y / len) * stats.recoil;
}

function fire(entity: Entity): void {
  const weapon = entity.weapon!;
  const stats = WEAPON_STATS[weapon.type] ?? WEAPON_STATS.rifle;
  weapon.currentCooldown = weapon.cooldown;
  // Computer players hit harder on the higher difficulties (AI_GUN_DAMAGE).
  const damage = BULLET_CONFIGS[stats.bullet].damage * gunDamageScale(entity, weapon.type);
  const sum = firePellets(entity, stats, damage);
  spawnMuzzleFlash(entity, sum.x / stats.pellets, sum.y / stats.pellets);
  recoil(entity, stats, sum);
  sound.playSound('shot1', entity.position!.x, entity.position!.y);
}

/** Fires player weapons while the shoot input is held, respecting cooldowns. */
export function updateWeapons(_dt: number): void {
  for (const entity of shooters) {
    if (entity.respawnTicks !== undefined || (entity.health?.current ?? 1) <= 0) continue;
    quietly(entity.aiPlayer !== undefined, () => updateWeaponSelection(entity));
    const weapon = entity.weapon!;
    if (weapon.currentCooldown > 0) weapon.currentCooldown--;
    if (readyToFire(entity)) fire(entity);
  }
}
