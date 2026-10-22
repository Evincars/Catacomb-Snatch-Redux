import { world } from '../world';
import type { Entity } from '../world';
import { WEAPON_STATS } from '../entities/WeaponStats';
import type { WeaponKind } from '../entities/WeaponStats';
import { SHOP_DEFS } from '../entities/ShopItemFactory';
import { spillPurse } from '../entities/LootFactory';
import { sound } from '../audio/SoundPlayer';
import { notify, quietly } from '../game/Notices';

/** Share of the carried coins a fallen player leaves behind. */
export const DEATH_PURSE_SHARE = 0.9;
/** Ticks a fallen player's coins and guns lie around (25 seconds), whatever the difficulty. */
export const FALLEN_DROP_LIFE = 60 * 25;
/** Ticks a dropped gun blinks before it goes. */
const BLINK_TICKS = 180;
const BLINK_PERIOD = 4;
const PICKUP_REACH = 16;
/** Dropped guns land in a ring this far from where their owner fell. */
const DROP_RING = 14;

const droppedGuns = world.with('position', 'weaponPickup');
const collectors = world.with('position', 'playerStats', 'weaponInventory', 'health');

/** Arms a player with the gun at `index` of their inventory, keeping the cooldown so a swap cannot skip it. */
function equipSlot(player: Entity, index: number): void {
  const inv = player.weaponInventory!;
  const type = inv.weapons[index];
  inv.current = index;
  player.weapon = { type, cooldown: WEAPON_STATS[type].cooldown, currentCooldown: player.weapon?.currentCooldown ?? 0 };
}

/**
 * Throws the gun in hand down at the player's feet, for a teammate to pick up; the starting gun is kept.
 * The thrower takes up the gun before it, and cannot pick the thrown one up again until they have stepped off it.
 */
export function throwDownWeapon(player: Entity): boolean {
  const inv = player.weaponInventory;
  const pos = player.position;
  if (!inv || !pos || inv.current <= 0 || inv.current >= inv.weapons.length) return false;
  const [kind] = inv.weapons.splice(inv.current, 1);
  equipSlot(player, inv.current - 1);
  const gun = createWeaponPickup(pos.x, pos.y, kind);
  gun.weaponPickup!.heldOff = world.id(player);
  return true;
}

/** A gun lying on the ground, drawn as its shop icon. */
export function createWeaponPickup(x: number, y: number, kind: WeaponKind): Entity {
  const def = SHOP_DEFS[kind];
  return world.add({
    position: { x, y },
    radius: { x: 8, y: 8 },
    yOffset: def.yOffset,
    visual: { sheet: def.sheet, col: def.col },
    weaponPickup: { kind, age: 0, life: FALLEN_DROP_LIFE },
  });
}

/** Leaves nine tenths of the carried coins where the player fell, as the biggest gems and coins that fit. */
function spillShare(player: Entity, at: { x: number; y: number }): void {
  const stats = player.playerStats;
  if (!stats || stats.score <= 0) return;
  const share = Math.floor(stats.score * DEATH_PURSE_SHARE);
  if (share > 0) stats.score -= spillPurse(at.x, at.y, share, FALLEN_DROP_LIFE);
}

/** Scatters every gun but the starting one in a ring around the spot, and re-arms the player with the starter. */
function dropSpareGuns(player: Entity, at: { x: number; y: number }): void {
  const inv = player.weaponInventory;
  if (!inv || inv.weapons.length < 2) return;
  const spare = inv.weapons.length - 1;
  for (let i = 1; i < inv.weapons.length; i++) {
    const angle = ((i - 1) / spare) * Math.PI * 2 + Math.random();
    createWeaponPickup(at.x + Math.cos(angle) * DROP_RING, at.y + Math.sin(angle) * DROP_RING, inv.weapons[i]);
  }
  const starter = inv.weapons[0];
  inv.weapons = [starter];
  inv.current = 0;
  player.weapon = { type: starter, cooldown: WEAPON_STATS[starter].cooldown, currentCooldown: 0 };
}

/**
 * What a player leaves where they fall: nine tenths of their coins, as the biggest gems and
 * coins that fit, and every gun but the starting one. Coins and guns vanish after 25 seconds.
 */
export function dropOnDeath(player: Entity): void {
  const pos = player.position;
  if (!pos) return;
  spillShare(player, pos);
  dropSpareGuns(player, pos);
}

function withinReach(player: Entity, gun: Entity): boolean {
  return Math.hypot(player.position!.x - gun.position!.x, player.position!.y - gun.position!.y) <= PICKUP_REACH;
}

function canCollect(player: Entity, gun: Entity): boolean {
  if (player.removed || player.falling || player.respawnTicks !== undefined || player.health!.current <= 0) return false;
  if (player.weaponInventory!.weapons.includes(gun.weaponPickup!.kind)) return false;
  if (gun.weaponPickup!.heldOff === world.id(player)) return false;
  return withinReach(player, gun);
}

/** The thrower may have the gun back once they have stepped off it (or are gone). */
function releaseHold(gun: Entity): void {
  const hold = gun.weaponPickup!.heldOff;
  if (hold === undefined) return;
  const thrower = world.entity(hold);
  if (!thrower?.position || !withinReach(thrower, gun)) delete gun.weaponPickup!.heldOff;
}

function removeGun(gun: Entity): void {
  world.removeComponent(gun, 'weaponPickup');
  world.addComponent(gun, 'removed', true);
}

function collect(player: Entity, gun: Entity): void {
  const kind = gun.weaponPickup!.kind;
  const inv = player.weaponInventory!;
  inv.weapons.push(kind);
  equipSlot(player, inv.weapons.length - 1);
  quietly(player.aiPlayer !== undefined, () => notify(`Picked up ${SHOP_DEFS[kind].label}`));
  sound.playSound('upgrade', gun.position!.x, gun.position!.y);
  removeGun(gun);
}

/** An unclaimed gun blinks for its last few seconds, then vanishes; returns whether it is gone. */
function age(gun: Entity): boolean {
  const info = gun.weaponPickup!;
  info.age++;
  const left = info.life - info.age;
  if (gun.sprite) gun.sprite.visible = left > BLINK_TICKS || Math.floor(left / BLINK_PERIOD) % 2 === 0;
  if (left > 0) return false;
  removeGun(gun);
  return true;
}

/** Lets anyone without a dropped gun pick it up by walking over it; unclaimed guns blink and vanish. */
export function updateWeaponPickups(): void {
  for (const gun of droppedGuns) {
    if (gun.removed || age(gun)) continue;
    releaseHold(gun);
    const player = collectorOf(gun);
    if (player) collect(player, gun);
  }
}

/** The first player close enough to pick the gun up who does not already have it. */
function collectorOf(gun: Entity): Entity | null {
  for (const player of collectors) if (canCollect(player, gun)) return player;
  return null;
}
