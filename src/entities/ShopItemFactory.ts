import { world } from '../world';
import type { Entity, ShopKind, Team } from '../world';

type ShopDef = {
  /** Base price before the difficulty multiplier. */
  cost: number;
  sheet: string;
  col: number;
  yOffset: number;
  label: string;
};

/** Costs and sprites taken from the Java ShopItem* subclasses. */
export const SHOP_DEFS: Record<ShopKind, ShopDef> = {
  turret:    { cost: 150, sheet: 'turret',      col: 0, yOffset: 10, label: 'Turret' },
  harvester: { cost: 300, sheet: 'harvester',   col: 0, yOffset: 22, label: 'Harvester' },
  bomb:      { cost: 500, sheet: 'bomb',        col: 0, yOffset: 7,  label: 'Bomb' },
  rifle:     { cost: 0,   sheet: 'weapon_list', col: 0, yOffset: 5,  label: 'Rifle' },
  shotgun:   { cost: 300, sheet: 'weapon_list', col: 1, yOffset: 5,  label: 'Shotgun' },
  raygun:    { cost: 800, sheet: 'weapon_list', col: 2, yOffset: 5,  label: 'Raygun' },
};

export function createShopItem(x: number, y: number, kind: ShopKind, team: Team, costMod = 1): Entity {
  const def = SHOP_DEFS[kind];
  return world.add({
    position: { x, y },
    radius: { x: 10, y: 10 },
    team,
    shopItem: { kind, cost: Math.round(def.cost * costMod) },
    yOffset: def.yOffset,
    visual: { sheet: def.sheet, col: def.col },
    minimapColor: 0x44ff44,
  });
}
