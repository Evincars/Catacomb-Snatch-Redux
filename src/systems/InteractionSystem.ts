import { world } from '../world';
import type { Entity, ShopKind } from '../world';
import { createBuilding } from '../entities/BuildingFactory';
import type { BuildingType } from '../entities/BuildingFactory';
import { SHOP_DEFS } from '../entities/ShopItemFactory';
import { sound } from '../audio/SoundPlayer';
import { wasUsePressed } from './InputSystem';

/** Matches Java's INTERACT_DISTANCE of 20px, measured from the reach point. */
const INTERACT_RANGE = 20;
/** Java probes a point this far in front of the player rather than the player itself. */
const INTERACT_REACH = 30;
/** Carried buildings float above the player's head. */
const CARRY_OFFSET_Y = 20;

const WEAPON_KINDS: ShopKind[] = ['rifle', 'shotgun', 'raygun'];

const WEAPON_STATS: Record<string, { cooldown: number }> = {
  rifle:   { cooldown: 15 },
  shotgun: { cooldown: 28 },
  raygun:  { cooldown: 10 },
};

export type Notice = { text: string; ticks: number };
const notices: Notice[] = [];

export function takeNotices(): Notice[] {
  return notices;
}

function notify(text: string): void {
  notices.push({ text, ticks: 120 });
  if (notices.length > 3) notices.shift();
}

export function updateNotices(): void {
  for (let i = notices.length - 1; i >= 0; i--) {
    if (--notices[i].ticks <= 0) notices.splice(i, 1);
  }
}

/** Exposed so the HUD can prompt for whatever the player is standing next to. */
export function shopItemNear(player: Entity): Entity | null {
  return nearestShopItem(player);
}

export function carriedByPlayer(player: Entity): Entity | null {
  return carriedBy(player);
}

/** The point the player is reaching toward, ahead of them in their aim direction. */
function reachPoint(player: Entity): { x: number; y: number } {
  const pos = player.position!;
  const aim = player.aimVector;
  const len = aim ? Math.hypot(aim.x, aim.y) : 0;
  if (!aim || len === 0) return { x: pos.x, y: pos.y };
  return { x: pos.x + (aim.x / len) * INTERACT_REACH, y: pos.y + (aim.y / len) * INTERACT_REACH };
}

function nearestShopItem(player: Entity): Entity | null {
  const reach = reachPoint(player);
  let best: Entity | null = null;
  let bestDist = INTERACT_RANGE * INTERACT_RANGE;

  for (const item of world.with('position', 'shopItem')) {
    if (item.team !== player.team) continue;
    const d = (item.position!.x - reach.x) ** 2 + (item.position!.y - reach.y) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = item;
    }
  }
  return best;
}

/** A dropped building the player is standing next to, so it can be picked back up. */
function nearestCarryable(player: Entity): Entity | null {
  const reach = reachPoint(player);
  let best: Entity | null = null;
  let bestDist = INTERACT_RANGE * INTERACT_RANGE;

  for (const b of world.with('position', 'building')) {
    if (b.carriedBy !== undefined) continue;
    if (b.building!.type === 'treasure' || b.building!.type === 'chest') continue;
    const d = (b.position!.x - reach.x) ** 2 + (b.position!.y - reach.y) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = b;
    }
  }
  return best;
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
    player.weapon = { type: kind, cooldown: WEAPON_STATS[kind].cooldown, currentCooldown: 0 };
    notify(`Bought ${SHOP_DEFS[kind].label}`);
    sound.playSound('upgrade');
    return;
  }

  // Buildings are handed to the player to carry and place.
  stats.score -= cost;
  const built = createBuilding(player.position!.x, player.position!.y, kind as BuildingType, player.team);
  pickUp(player, built);
  notify(`Bought ${SHOP_DEFS[kind].label} — press E to place`);
  sound.playSound('upgrade');
}

function pickUp(player: Entity, building: Entity): void {
  world.addComponent(building, 'carriedBy', world.id(player)!);
  // A carried building must not collide with its carrier.
  world.removeComponent(building, 'blocking');
}

function drop(building: Entity): void {
  world.removeComponent(building, 'carriedBy');
  world.addComponent(building, 'blocking', true);
  building.building!.justDroppedTicks = 80;
  sound.playSound('trackPlace', building.position!.x, building.position!.y);
}

function carriedBy(player: Entity): Entity | null {
  const id = world.id(player);
  for (const b of world.with('building', 'carriedBy')) {
    if (b.carriedBy === id) return b;
  }
  return null;
}

/** Handles the use key: buy, pick up, and place. */
export function updateInteraction(): void {
  updateNotices();

  for (const player of world.with('position', 'playerInput', 'playerStats', 'weaponInventory')) {
    const held = carriedBy(player);

    // Carried buildings follow the player above their head.
    if (held) {
      held.position!.x = player.position!.x;
      held.position!.y = player.position!.y - CARRY_OFFSET_Y;
    }

    if (!wasUsePressed()) continue;

    if (held) {
      drop(held);
      continue;
    }

    const shop = nearestShopItem(player);
    if (shop) {
      buy(player, shop);
      continue;
    }

    const carryable = nearestCarryable(player);
    if (carryable) pickUp(player, carryable);
  }
}
