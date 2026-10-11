import { world, Team } from '../world';
import type { Entity } from '../world';
import { TILE_WIDTH } from '../level/TileType';
import { gameState } from '../game/GameState';
import { frameTexture } from '../render/Sheets';

export type BuildingType = 'harvester' | 'turret' | 'bomb' | 'chest' | 'treasure' | 'shop';

type BuildingConfig = {
  health: number;
  radius: { x: number; y: number };
  yOffset: number;
  sheet?: string;
};

/** Health values and art match the Java Building subclasses. */
const BUILDING_CONFIGS: Record<BuildingType, BuildingConfig> = {
  harvester: { health: 10, radius: { x: 10, y: 10 }, yOffset: 22, sheet: 'harvester' },
  turret:    { health: 10, radius: { x: 10, y: 10 }, yOffset: 10, sheet: 'turret' },
  bomb:      { health: 8,  radius: { x: 8,  y: 8  }, yOffset: 7,  sheet: 'bomb' },
  chest:     { health: 10, radius: { x: 8,  y: 8  }, yOffset: 8,  sheet: 'chest_small' },
  treasure:  { health: 50, radius: { x: 10, y: 10 }, yOffset: 12, sheet: 'treasure' },
  shop:      { health: 30, radius: { x: 10, y: 10 }, yOffset: 8 },
};

type TurretTier = { radius: number; delay: number; damage: number };
type HarvesterTier = { radius: number };

type UpgradeTrack<T> = {
  /** Sprite sheet for each level, lowest first. */
  sheets: string[];
  /** Price of moving from level i + 1 to level i + 2. */
  costs: number[];
  tiers: T[];
};

const TURRET_UPGRADES: UpgradeTrack<TurretTier> = {
  sheets: ['turret', 'turret2', 'turret3'],
  costs: [200, 400],
  tiers: [
    { radius: 3 * TILE_WIDTH, delay: 24, damage: 1 },
    { radius: 4 * TILE_WIDTH, delay: 17, damage: 2 },
    { radius: 5 * TILE_WIDTH, delay: 11, damage: 3 },
  ],
};

const HARVESTER_UPGRADES: UpgradeTrack<HarvesterTier> = {
  sheets: ['harvester', 'harvester2', 'harvester3'],
  costs: [250, 500],
  tiers: [{ radius: 60 }, { radius: 90 }, { radius: 130 }],
};

const BUILDING_TITLES: Partial<Record<BuildingType, { title: string; lines: string[] }>> = {
  turret:    { title: 'Turret',    lines: ['Shoots nearby enemies.'] },
  harvester: { title: 'Harvester', lines: ['Collects coins nearby.'] },
  bomb:      { title: 'Bomb',      lines: ['Shoot it to light the fuse.'] },
};

/** Price of the next upgrade, scaled by difficulty like shop prices, or null at max level. */
export function upgradeCostOf(entity: Entity): number | null {
  const up = entity.upgradable;
  if (!up || up.level >= up.maxLevel) return null;
  return Math.round(up.costs[up.level - 1] * gameState.difficulty.shopCostMod);
}

/** Changes a turret or harvester to the stats and art of its current level. */
export function applyUpgradeLevel(entity: Entity): void {
  const up = entity.upgradable;
  if (!up) return;
  const idx = up.level - 1;

  if (entity.turret) {
    const tier = TURRET_UPGRADES.tiers[idx];
    entity.turret.radius = tier.radius;
    entity.turret.delay = tier.delay;
    entity.turret.damage = tier.damage;
    setSheet(entity, TURRET_UPGRADES.sheets[idx]);
  } else if (entity.harvester) {
    entity.harvester.radius = HARVESTER_UPGRADES.tiers[idx].radius;
    setSheet(entity, HARVESTER_UPGRADES.sheets[idx]);
  }
}

function setSheet(entity: Entity, sheet: string): void {
  if (!entity.visual) return;
  entity.visual.sheet = sheet;
  if (entity.sprite) {
    entity.sprite.texture = frameTexture(sheet, entity.visual.col ?? 0, entity.visual.row ?? 0);
  }
}

export function createBuilding(
  x: number,
  y: number,
  type: BuildingType,
  team: Team = Team.Neutral,
): Entity {
  const cfg = BUILDING_CONFIGS[type];

  const entity: Entity = {
    position: { x, y },
    radius: { ...cfg.radius },
    blocking: true,
    physicsSlide: true,
    team,
    health: { current: cfg.health, max: cfg.health },
    hurtTime: 0,
    freezeTime: 0,
    building: { type, health: cfg.health, maxHealth: cfg.health },
    yOffset: cfg.yOffset,
    minimapColor: 0xaaaaaa,
  };

  if (cfg.sheet) entity.visual = { sheet: cfg.sheet };
  entity.tooltip = BUILDING_TITLES[type];

  // Turret stats are the Java level-0 upgrade values.
  if (type === 'turret') {
    const tier = TURRET_UPGRADES.tiers[0];
    entity.turret = { ...tier, cooldown: 10 };
    entity.upgradable = { level: 1, maxLevel: TURRET_UPGRADES.sheets.length, costs: TURRET_UPGRADES.costs };
    entity.facing8 = 0;
  }
  // Bombs ignore damage entirely; a bullet lights the fuse instead.
  if (type === 'bomb') {
    entity.bomb = { blastRadius: 50, blastDamage: 5, lit: false, fuse: 40 };
    entity.health!.immortal = true;
  }
  if (type === 'harvester') {
    entity.harvester = { ...HARVESTER_UPGRADES.tiers[0], collected: 0 };
    entity.upgradable = {
      level: 1,
      maxLevel: HARVESTER_UPGRADES.sheets.length,
      costs: HARVESTER_UPGRADES.costs,
    };
  }

  return world.add(entity);
}
