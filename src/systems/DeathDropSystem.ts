import { world } from '../world';
import type { Entity, ShopKind } from '../world';
import { WEAPON_STATS } from '../entities/WeaponStats';
import { SHOP_DEFS } from '../entities/ShopItemFactory';
import { spillPurse } from '../entities/LootFactory';
import { sound } from '../audio/SoundPlayer';
import { notify, quietly } from '../game/Notices';

/** Share of the carried coins a fallen player leaves behind. */
export const DEATH_PURSE_SHARE = 0.9;
/** Ticks a dropped gun lies around (40 seconds) and how long it blinks before it goes. */
const WEAPON_LIFE = 60 * 40;
const BLINK_TICKS = 180;
const BLINK_PERIOD = 4;
const PICKUP_REACH = 16;

/** A gun lying on the ground, drawn as its shop icon. */
export function createWeaponPickup(x: number, y: number, kind: string): Entity {
  const def = SHOP_DEFS[kind as ShopKind];
  return world.add({
    position: { x, y },
    radius: { x: 8, y: 8 },
    yOffset: def.yOffset,
    visual: { sheet: def.sheet, col: def.col },
    weaponPickup: { kind, age: 0, life: WEAPON_LIFE },
  });
}

/**
 * What a player leaves where they fall: nine tenths of their coins, as the biggest gems and
 * coins that fit, and every gun but the starting one. Coins and guns vanish after a while.
 */
export function dropOnDeath(player: Entity): void {
  const pos = player.position;
  if (!pos) return;
  const stats = player.playerStats;
  if (stats && stats.score > 0) {
    const share = Math.floor(stats.score * DEATH_PURSE_SHARE);
    if (share > 0) {
      stats.score -= spillPurse(pos.x, pos.y, share);
    }
  }
  const inv = player.weaponInventory;
  if (!inv || inv.weapons.length < 2) return;
  const spare = inv.weapons.slice(1);
  spare.forEach((kind, i) => {
    const angle = (i / spare.length) * Math.PI * 2 + Math.random();
    createWeaponPickup(pos.x + Math.cos(angle) * 14, pos.y + Math.sin(angle) * 14, kind);
  });
  const starter = inv.weapons[0];
  inv.weapons = [starter];
  inv.current = 0;
  player.weapon = { type: starter, cooldown: WEAPON_STATS[starter].cooldown, currentCooldown: 0 };
}

/** Lets anyone without a dropped gun pick it up by walking over it; unclaimed guns blink and vanish. */
export function updateWeaponPickups(): void {
  const players = [...world.with('position', 'playerStats', 'weaponInventory', 'health')];
  for (const gun of world.with('position', 'weaponPickup')) {
    if (gun.removed) continue;
    const info = gun.weaponPickup!;
    info.age++;
    const left = info.life - info.age;
    if (gun.sprite) gun.sprite.visible = left > BLINK_TICKS || Math.floor(left / BLINK_PERIOD) % 2 === 0;
    if (left <= 0) {
      world.removeComponent(gun, 'weaponPickup');
      world.addComponent(gun, 'removed', true);
      continue;
    }
    const p = gun.position!;
    for (const player of players) {
      const inv = player.weaponInventory!;
      if (player.removed || player.falling || player.respawnTicks !== undefined || player.health!.current <= 0) continue;
      if (inv.weapons.includes(info.kind) || Math.hypot(player.position!.x - p.x, player.position!.y - p.y) > PICKUP_REACH) continue;
      inv.weapons.push(info.kind);
      inv.current = inv.weapons.length - 1;
      player.weapon = {
        type: info.kind,
        cooldown: WEAPON_STATS[info.kind].cooldown,
        currentCooldown: player.weapon?.currentCooldown ?? 0,
      };
      quietly(player.aiPlayer !== undefined, () => notify(`Picked up ${SHOP_DEFS[info.kind as ShopKind].label}`));
      sound.playSound('upgrade', p.x, p.y);
      world.removeComponent(gun, 'weaponPickup');
      world.addComponent(gun, 'removed', true);
      break;
    }
  }
}
