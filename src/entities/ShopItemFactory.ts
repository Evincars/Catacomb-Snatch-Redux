import { world } from '../world';
import type { Entity, ShopKind, Team } from '../world';

/**
 * What an item is for, so a computer opponent can weigh items it has never seen:
 * weapons are carried, defence shoots for its owner, economy gathers coins and
 * explosives clear terrain.
 */
export type ShopRole = 'weapon' | 'defense' | 'economy' | 'explosive';

type ShopDef = {
  /** Base price before the difficulty multiplier. */
  cost: number;
  role: ShopRole;
  sheet: string;
  col: number;
  yOffset: number;
  label: string;
  tooltip: { title: string; lines?: string[]; image?: string };
};

/** Base shop prices; difficulty scaling is applied when stalls are created. */
export const SHOP_DEFS: Record<ShopKind, ShopDef> = {
  turret:    { cost: 75,  role: 'defense',  sheet: 'turret',      col: 0, yOffset: 10, label: 'Turret', tooltip: { title: 'Turret', image: 'tooltip_turret' } },
  harvester: { cost: 300, role: 'economy', sheet: 'harvester',   col: 0, yOffset: 22, label: 'Harvester', tooltip: { title: 'Harvester', image: 'tooltip_harvester' } },
  bomb:      { cost: 500, role: 'explosive', sheet: 'bomb',        col: 0, yOffset: 7,  label: 'Bomb', tooltip: { title: 'Bomb', image: 'tooltip_bomb' } },
  rifle:     { cost: 0,   role: 'weapon', sheet: 'weapon_list', col: 0, yOffset: 5,  label: 'Rifle', tooltip: { title: 'Rifle', lines: ['Your starting weapon.', 'Fast and accurate.'] } },
  shotgun:   { cost: 300, role: 'weapon', sheet: 'weapon_list', col: 1, yOffset: 5,  label: 'Shotgun', tooltip: { title: 'Shotgun', lines: ['Fires a spread of pellets.', 'Deadly up close.'] } },
  raygun:    { cost: 800, role: 'weapon', sheet: 'weapon_list', col: 2, yOffset: 5,  label: 'Raygun', tooltip: { title: 'Raygun', lines: ['Fires bolts of plasma.', 'Hits hard from afar.'] } },
};

export function createShopItem(x: number, y: number, kind: ShopKind, team: Team, costMod = 1): Entity {
  const def = SHOP_DEFS[kind];
  return world.add({
    position: { x, y },
    radius: { x: 10, y: 10 },
    team,
    shopItem: { kind, cost: Math.round(def.cost * costMod) },
    tooltip: def.tooltip,
    yOffset: def.yOffset,
    visual: { sheet: def.sheet, col: def.col },
    minimapColor: 0x44ff44,
  });
}
