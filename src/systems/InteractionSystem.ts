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
import { SLIDE_DRAG } from './MovementSystem';
import { createRailDroid } from './RailDroidSystem';
import { BB } from '../math/BB';
import type { Level } from '../level/Level';

/** Carried buildings float above the player's head. */
const CARRY_OFFSET_Y = 20;
/** Initial speed of a building put down, as Java's Player.drop (aim * 5). */
const DROP_SLIDE = 5;

/** Base price of one piece of track, before the difficulty multiplier. */
const RAIL_COST = 10;
/** Base price of a rail carriage, bought on the base's own track. */
const DROID_COST = 50;
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
 * anywhere (its sprite follows whatever it later gets joined to), or, on a
 * removable piece, takes it up again.
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

  // Taking track up is free.
  if (tile.type === TileType.Rail) {
    level.removeTile(tx, ty);
    player.railCooldown = RAIL_DELAY_TICKS;
    sound.playSound('trackPlace', pos.x, pos.y);
    return;
  }

  // The base's fixed track is where carriages are bought (Java Player.handleRailBuilding).
  if (tile.type === TileType.UnbreakableRail || tile.type === TileType.PlayerRail) {
    const cost = Math.max(1, Math.round(DROID_COST * mod));
    if (stats.score < cost) {
      notify(`Need ${cost} coins for a carriage`);
      sound.playSound('fail');
      return;
    }
    stats.score -= cost;
    createRailDroid(pos.x, pos.y, player.team ?? 0);
    player.railCooldown = RAIL_DELAY_TICKS;
    sound.playSound('trackPlace', pos.x, pos.y);
    spawnSpentCoin(player);
    return;
  }

  if (!tile.buildable || hasBuildingOn(tx, ty) || level.inBaseArea(tx, ty)) {
    notify('Cannot build a rail here');
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

function fitsAt(level: Level, building: Entity, x: number, y: number): boolean {
  const tile = level.getTileAt(x, y);
  if (!tile || !tile.buildable) return false;
  const r = building.radius ?? { x: 8, y: 8 };
  const bb = BB.fromCenter(x, y, r.x, r.y);
  return !level.getClipBBs(x, y, r.x, r.y).some((clip) => clip.intersects(bb));
}

/**
 * Where a carried building comes down: at the player's feet as in Java, or,
 * when that will not do, the nearest open spot around the player, favouring
 * the side away from the wall they face.
 */
function dropSpot(level: Level, player: Entity, building: Entity): { x: number; y: number } | null {
  const p = player.position!;
  if (fitsAt(level, building, p.x, p.y)) return { x: p.x, y: p.y };

  const aim = player.aimVector ?? { x: 0, y: 1 };
  const len = Math.hypot(aim.x, aim.y) || 1;
  const ax = aim.x / len;
  const ay = aim.y / len;
  const candidates: Array<{ x: number; y: number; score: number }> = [];
  for (let dy = -24; dy <= 24; dy += 4) {
    for (let dx = -24; dx <= 24; dx += 4) {
      const dist = Math.hypot(dx, dy);
      if (dist > 24) continue;
      // Closer is better; ties go to spots behind the way the player faces.
      candidates.push({ x: p.x + dx, y: p.y + dy, score: dist + (dx * ax + dy * ay) * 0.5 });
    }
  }
  candidates.sort((a, b) => a.score - b.score);
  return candidates.find((c) => fitsAt(level, building, c.x, c.y)) ?? null;
}

/** A bomb rests this far below the middle of its tile, so its round body is what sits in the tile's centre. */
const BOMB_REST_OFFSET = 6;

/**
 * Where a bomb comes to rest: the middle of the tile the player faces (right,
 * left, up or down). When that tile is blocked, as when the player stands
 * against a wall facing it, the nearest free tile around them instead.
 */
function bombSpot(level: Level, player: Entity, bomb: Entity): { x: number; y: number } | null {
  const p = player.position!;
  const tx = Math.floor(p.x / TILE_WIDTH);
  const ty = Math.floor(p.y / TILE_HEIGHT);
  const aim = player.aimVector ?? { x: 0, y: 1 };
  const facing = Math.abs(aim.x) > Math.abs(aim.y)
    ? { x: Math.sign(aim.x), y: 0 }
    : { x: 0, y: Math.sign(aim.y) || 1 };

  const around = [{ x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 }]
    .filter((d) => d.x !== facing.x || d.y !== facing.y)
    .sort((a, b) => b.x * aim.x + b.y * aim.y - (a.x * aim.x + a.y * aim.y));

  for (const d of [facing, { x: 0, y: 0 }, ...around]) {
    const x = tx + d.x;
    const y = ty + d.y;
    const spot = { x: x * TILE_WIDTH + TILE_WIDTH / 2, y: y * TILE_HEIGHT + TILE_HEIGHT / 2 + BOMB_REST_OFFSET };
    if (fitsAt(level, bomb, spot.x, spot.y) && !hasBuildingOn(x, y)) return spot;
  }
  return null;
}

/** Puts a carried building down, shifting it out of any wall; refuses only when there is no room at all. */
function drop(player: Entity, building: Entity, level: Level): boolean {
  const landing = building.bomb ? bombSpot(level, player, building) : null;
  const spot = dropSpot(level, player, building) ?? landing;
  if (!spot) {
    notify('Cannot build there');
    sound.playSound('fail');
    return false;
  }
  const pos = building.position!;
  pos.x = spot.x;
  pos.y = spot.y;

  world.removeComponent(building, 'carriedBy');
  world.removeComponent(player, 'carryingId');
  world.addComponent(building, 'blocking', true);
  if (landing) {
    // A bomb is tossed from the player's feet onto the tile they face; the speed is
    // chosen so the glide, which loses SLIDE_DRAG of its speed per tick, ends on the tile.
    const push = 1 - SLIDE_DRAG;
    world.addComponent(building, 'slide', { x: (landing.x - pos.x) * push, y: (landing.y - pos.y) * push });
  } else if (!building.bomb) {
    // It is tossed down and slides a short way in the direction the player faces,
    // or back the other way when they face a wall, so it never ends up under their feet.
    const aim = player.aimVector ?? { x: 0, y: 1 };
    const len = Math.hypot(aim.x, aim.y) || 1;
    let dx = aim.x / len;
    let dy = aim.y / len;
    const reach = Math.max(building.radius?.x ?? 8, building.radius?.y ?? 8) + 4;
    if (!fitsAt(level, building, pos.x + dx * reach, pos.y + dy * reach)) {
      dx = -dx;
      dy = -dy;
    }
    world.addComponent(building, 'slide', { x: dx * DROP_SLIDE, y: dy * DROP_SLIDE });
  }
  if (building.building) building.building.justDroppedTicks = 80;
  sound.playSound('trackPlace', pos.x, pos.y);
  return true;
}

function carriedBy(player: Entity): Entity | null {
  const id = world.id(player);
  for (const b of world.with('carriedBy')) {
    if (b.carriedBy === id) return b;
  }
  return null;
}

/**
 * Carried buildings ride above their carrier's head. Run after everything that
 * moves the player, so the load is never a tick behind and does not wobble.
 */
export function updateCarried(): void {
  for (const held of world.with('position', 'carriedBy')) {
    const carrier = world.entity(held.carriedBy!)?.position;
    if (!carrier) continue;
    held.position!.x = carrier.x;
    held.position!.y = carrier.y - CARRY_OFFSET_Y;
  }
}

/** Handles the use, build and upgrade intents: buy, pick up, place and upgrade. */
export function updateInteraction(level: Level): void {
  updateNotices();

  for (const player of world.with('position', 'playerInput', 'playerStats', 'weaponInventory')) {
    const held = carriedBy(player);

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
    } else if (target.harvester && intents.use && (target.harvester.collected > 0 || target.harvester.emptying)) {
      takeCoins(player, target);
    } else if (target.building || target.spawner) {
      // The build key lifts any building or nest; use does so too, except on a harvester, which it empties.
      pickUp(player, target);
    }
  }
}
