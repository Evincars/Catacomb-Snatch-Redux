import { world } from '../world';
import type { Entity, ShopKind } from '../world';
import { createBuilding, applyUpgradeLevel, upgradeCostOf } from '../entities/BuildingFactory';
import type { BuildingType } from '../entities/BuildingFactory';
import { SHOP_DEFS } from '../entities/ShopItemFactory';
import { WEAPON_STATS } from '../entities/WeaponStats';
import { sound } from '../audio/SoundPlayer';
import { notify, updateNotices } from '../game/Notices';
import { keyLabel } from '../game/Settings';
import { targetOf } from './TargetingSystem';
import type { Level } from '../level/Level';

/** Carried buildings float above the player's head. */
const CARRY_OFFSET_Y = 20;

const WEAPON_KINDS: ShopKind[] = ['rifle', 'shotgun', 'raygun'];

export function carriedByPlayer(player: Entity): Entity | null {
  return carriedBy(player);
}

function buy(player: Entity, item: Entity): void {
  const stats = player.playerStats!;
  const { kind, cost } = item.shopItem!;

  if (stats.score < cost) {
    notify(`Need ${cost} coins for ${SHOP_DEFS[kind].label}`);
    sound.playSound('fail');
    return;
  }

  if (WEAPON_KINDS.includes(kind)) {
    const inv = player.weaponInventory!;
    if (inv.weapons.includes(kind)) {
      notify(`${SHOP_DEFS[kind].label} already owned`);
      return;
    }
    stats.score -= cost;
    inv.weapons.push(kind);
    inv.current = inv.weapons.length - 1;
    player.weapon = {
      type: kind,
      cooldown: WEAPON_STATS[kind].cooldown,
      currentCooldown: player.weapon?.currentCooldown ?? 0,
    };
    notify(`Bought ${SHOP_DEFS[kind].label}`);
    sound.playSound('upgrade');
    return;
  }

  // Buildings are handed to the player to carry and place.
  stats.score -= cost;
  const built = createBuilding(player.position!.x, player.position!.y, kind as BuildingType, player.team);
  pickUp(player, built);
  notify(`Bought ${SHOP_DEFS[kind].label} - press ${keyLabel('use')} to place`);
  sound.playSound('upgrade');
}

function upgrade(player: Entity, target: Entity | null): void {
  const up = target?.upgradable;
  if (!target || !up) {
    notify('Nothing to upgrade here');
    return;
  }

  const cost = upgradeCostOf(target);
  const name = target.tooltip?.title ?? 'Building';
  if (cost === null) {
    notify(`${name} is fully upgraded`);
    return;
  }

  const stats = player.playerStats!;
  if (stats.score < cost) {
    notify(`Need ${cost} coins to upgrade ${name}`);
    sound.playSound('fail');
    return;
  }

  stats.score -= cost;
  up.level++;
  applyUpgradeLevel(target);
  // An upgrade comes with a repair.
  if (target.health) target.health.current = target.health.max;
  notify(`${name} upgraded to level ${up.level}`);
  sound.playSound('upgrade', target.position!.x, target.position!.y);
}

function pickUp(player: Entity, building: Entity): void {
  // A harvester hands over everything it has sucked up when it is lifted.
  const stash = building.harvester;
  if (stash && stash.collected > 0) {
    player.playerStats!.score += stash.collected;
    notify(`Collected ${stash.collected} coins`);
    stash.collected = 0;
  }
  world.addComponent(building, 'carriedBy', world.id(player)!);
  world.addComponent(player, 'carryingId', world.id(building)!);
  // A carried building must not collide with its carrier.
  world.removeComponent(building, 'blocking');
}

/** Refuses to place into a wall, so buildings cannot end up unreachable. */
function drop(player: Entity, building: Entity, level: Level): boolean {
  const pos = building.position!;
  const tile = level.getTileAt(pos.x, pos.y);
  if (!tile || !tile.buildable) {
    notify('Cannot build there');
    sound.playSound('fail');
    return false;
  }

  world.removeComponent(building, 'carriedBy');
  world.removeComponent(player, 'carryingId');
  world.addComponent(building, 'blocking', true);
  building.building!.justDroppedTicks = 80;
  sound.playSound('trackPlace', pos.x, pos.y);
  return true;
}

function carriedBy(player: Entity): Entity | null {
  const id = world.id(player);
  for (const b of world.with('building', 'carriedBy')) {
    if (b.carriedBy === id) return b;
  }
  return null;
}

/** Handles the use, build and upgrade intents: buy, pick up, place and upgrade. */
export function updateInteraction(level: Level): void {
  updateNotices();

  for (const player of world.with('position', 'playerInput', 'playerStats', 'weaponInventory')) {
    const held = carriedBy(player);

    // Carried buildings follow the player above their head.
    if (held) {
      held.position!.x = player.position!.x;
      held.position!.y = player.position!.y - CARRY_OFFSET_Y;
    }

    const intents = player.playerInput!.intents;
    const target = targetOf(player);

    if (intents.upgrade) {
      if (held) notify('Place it before upgrading');
      else upgrade(player, target);
      continue;
    }

    if (!intents.use && !intents.build) continue;

    if (held) {
      drop(player, held, level);
      continue;
    }

    if (!target) continue;
    if (target.shopItem) {
      // The build key only moves things around; it never spends coins.
      if (intents.use) buy(player, target);
    } else if (target.building) {
      pickUp(player, target);
    }
  }
}
