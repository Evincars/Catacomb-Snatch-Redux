import { world } from '../world';
import type { Entity, ShopKind } from '../world';
import { createBuilding, applyUpgradeLevel, upgradeCostOf } from '../entities/BuildingFactory';
import type { BuildingType } from '../entities/BuildingFactory';
import { SHOP_DEFS } from '../entities/ShopItemFactory';
import { WEAPON_STATS } from '../entities/WeaponStats';
import { sound } from '../audio/SoundPlayer';
import { notify, updateNotices } from '../game/Notices';
import { keyLabel } from '../game/Settings';
import { spawnSpentCoin } from '../entities/FxFactory';
import { gameState } from '../game/GameState';
import { createTile, TileType, TILE_WIDTH, TILE_HEIGHT } from '../level/TileType';
import { targetOf } from './TargetingSystem';
import { touchesTrack } from '../level/RailLayout';
import type { Level } from '../level/Level';

/** Carried buildings float above the player's head. */
const CARRY_OFFSET_Y = 20;

/** Base price of one piece of track, before the difficulty multiplier. */
const RAIL_COST = 10;
const RAIL_REMOVE_COST = 15;
/** Ticks before the next piece can be laid or lifted. */
const RAIL_DELAY_TICKS = 15;

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
    spawnSpentCoin(player);
    return;
  }

  // Buildings are handed to the player to carry and place.
  stats.score -= cost;
  const built = createBuilding(player.position!.x, player.position!.y, kind as BuildingType, player.team);
  pickUp(player, built);
  notify(`Bought ${SHOP_DEFS[kind].label} - press ${keyLabel('use')} to place`);
  sound.playSound('upgrade');
  spawnSpentCoin(player);
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
  spawnSpentCoin(player);
}

function hasBuildingOn(tx: number, ty: number): boolean {
  for (const b of world.with('position', 'building')) {
    if (b.carriedBy !== undefined) continue;
    if (Math.floor(b.position!.x / TILE_WIDTH) === tx && Math.floor(b.position!.y / TILE_HEIGHT) === ty) return true;
  }
  return false;
}

/**
 * The build key works the tile the player stands on: it lays a piece of track
 * that continues an existing line, or, on a removable piece, takes it up again.
 */
function toggleRail(player: Entity, level: Level): void {
  if ((player.railCooldown ?? 0) > 0) return;

  const pos = player.position!;
  const tx = Math.floor(pos.x / TILE_WIDTH);
  const ty = Math.floor(pos.y / TILE_HEIGHT);
  const tile = level.getTile(tx, ty);
  if (!tile) return;
  const stats = player.playerStats!;
  const mod = gameState.difficulty.shopCostMod;

  if (tile.type === TileType.Rail) {
    const cost = Math.max(1, Math.round(RAIL_REMOVE_COST * mod));
    if (stats.score < cost) {
      notify(`Need ${cost} coins to remove a rail`);
      sound.playSound('fail');
      return;
    }
    stats.score -= cost;
    level.removeTile(tx, ty);
    player.railCooldown = RAIL_DELAY_TICKS;
    sound.playSound('trackPlace', pos.x, pos.y);
    spawnSpentCoin(player);
    return;
  }

  if (tile.type === TileType.UnbreakableRail || tile.type === TileType.PlayerRail) {
    notify("That track can't be removed");
    sound.playSound('fail');
    return;
  }

  if (!tile.buildable || hasBuildingOn(tx, ty)) {
    notify('Cannot build a rail here');
    sound.playSound('fail');
    return;
  }
  if (!touchesTrack(level, tx, ty)) {
    notify('Rails must connect to an existing track');
    sound.playSound('fail');
    return;
  }

  const cost = Math.max(1, Math.round(RAIL_COST * mod));
  if (stats.score < cost) {
    notify(`Need ${cost} coins for a rail`);
    sound.playSound('fail');
    return;
  }

  stats.score -= cost;
  level.setTile(tx, ty, createTile(TileType.Rail, 0));
  level.tilesDirty = true;
  player.railCooldown = RAIL_DELAY_TICKS;
  sound.playSound('trackPlace', pos.x, pos.y);
  spawnSpentCoin(player);
}

/** Starts draining a harvester's stash into the player's purse. */
function takeCoins(player: Entity, harvester: Entity): void {
  const h = harvester.harvester!;
  if (h.collected <= 0) {
    notify('Harvester is empty');
    return;
  }
  h.emptying = true;
  h.emptyingPlayerId = world.id(player);
}

function pickUp(player: Entity, building: Entity): void {
  // Lifting a harvester interrupts a transfer in progress.
  if (building.harvester) building.harvester.emptying = false;
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

    if ((player.railCooldown ?? 0) > 0) player.railCooldown!--;
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

    if (!target) {
      if (intents.build) toggleRail(player, level);
      continue;
    }
    if (target.shopItem) {
      // Stalls only answer to the use key.
      if (intents.use) buy(player, target);
    } else if (target.harvester && intents.use) {
      takeCoins(player, target);
    } else if (target.building) {
      // The build key lifts any building; use does so too, except on a harvester, which it empties.
      pickUp(player, target);
    }
  }
}
