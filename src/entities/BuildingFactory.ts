import { world, Team } from '../world';
import type { Entity } from '../world';
import { TILE_WIDTH } from '../level/TileType';
import { gameState } from '../game/GameState';
import { setVisualFrame } from '../render/AnimatedVisual';

export type BuildingType = 'harvester' | 'turret' | 'bomb' | 'chest' | 'treasure' | 'shop';

type BuildingConfig = {
  health: number;
  radius: { x: number; y: number };
  yOffset: number;
  sheet?: string;
};

/** Health values and art match the Java Building subclasses. */
const BUILDING_CONFIGS: Record<BuildingType, BuildingConfig> = {
  harvester: { health: 20, radius: { x: 10, y: 10 }, yOffset: 22, sheet: 'harvester' },
  turret:    { health: 20, radius: { x: 10, y: 10 }, yOffset: 10, sheet: 'turret' },
  bomb:      { health: 5,  radius: { x: 8,  y: 8  }, yOffset: 7,  sheet: 'bomb' },
  chest:     { health: 10, radius: { x: 8,  y: 8  }, yOffset: 8,  sheet: 'chest_small' },
  treasure:  { health: 50, radius: { x: 10, y: 10 }, yOffset: 12, sheet: 'treasure' },
  shop:      { health: 30, radius: { x: 10, y: 10 }, yOffset: 8 },
};

type TurretTier = { radius: number; delay: number; damage: number };
/** `radius` is how far the harvester reaches, in pixels. */
type HarvesterTier = { radius: number; capacity: number };

type UpgradeTrack<T> = {
  /** Sprite sheet for each level, lowest first. */
  sheets: string[];
  /** Price of moving from level i + 1 to level i + 2. */
  costs: number[];
  tiers: T[];
};

const TURRET_UPGRADES: UpgradeTrack<TurretTier> = {
  sheets: ['turret', 'turret2', 'turret3'],
  costs: [500, 1000],
  tiers: [
    { radius: 3 * TILE_WIDTH, delay: 24, damage: 1 },
    { radius: 5 * TILE_WIDTH, delay: 21, damage: 2 },
    { radius: 7 * TILE_WIDTH, delay: 18, damage: 3 },
  ],
};

const HARVESTER_UPGRADES: UpgradeTrack<HarvesterTier> = {
  sheets: ['harvester', 'harvester2', 'harvester3'],
  costs: [500, 1000],
  tiers: [
    { radius: 60, capacity: 1500 },
    { radius: 60 + TILE_WIDTH, capacity: 2500 },
    { radius: 60 + 2 * TILE_WIDTH, capacity: 3500 },
  ],
};

const BUILDING_TITLES: Partial<Record<BuildingType, { title: string; lines: string[] }>> = {
  turret:    { title: 'Turret',    lines: ['Shoots nearby enemies.'] },
  harvester: { title: 'Harvester', lines: ['Collects coins nearby.'] },
  bomb:      { title: 'Bomb',      lines: ['Shoot it to light the fuse.'] },
  chest:     { title: 'Treasure chest', lines: ['Open it to release its treasure.'] },
};

/** How far a turret of the given level (1-based) shoots, in pixels. */
export function turretRadiusAt(level: number): number {
  return TURRET_UPGRADES.tiers[Math.min(TURRET_UPGRADES.tiers.length, Math.max(1, level)) - 1].radius;
}

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
    entity.harvester.capacity = HARVESTER_UPGRADES.tiers[idx].capacity;
    setSheet(entity, HARVESTER_UPGRADES.sheets[idx]);
  }
}

function setSheet(entity: Entity, sheet: string): void {
  if (!entity.visual) return;
  entity.visual.sheet = sheet;
  if (entity.sprite) {
    setVisualFrame(entity.sprite, sheet, entity.visual.col ?? 0, entity.visual.row ?? 0);
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
    // Bombs belong to nobody, so a player's own shot lights them.
    team: type === 'bomb' ? Team.Neutral : team,
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
    entity.rangeTicks = 0;
    entity.healthBarOffset = 14;
  }
  // The treasure pile is scenery that cannot be shot away.
  if (type === 'treasure') {
    entity.health!.immortal = true;
    entity.treasure = { timer: 0 };
  }
  // Bombs ignore damage entirely; a bullet lights the fuse instead.
  if (type === 'bomb') {
    entity.bomb = { ownerTeam: team, blastTiles: 1, blastDamage: 5, lit: false, fuse: 60, fuseMax: 60 };
    entity.health!.immortal = true;
  }
  if (type === 'chest') {
    entity.health!.immortal = true;
    entity.chest = { value: 800, opened: false, disappearTicks: 0 };
    entity.frame = 0;
  }
  if (type === 'harvester') {
    entity.harvester = { ...HARVESTER_UPGRADES.tiers[0], collected: 0, time: 0, suckTicks: 0, emptying: false };
    entity.frame = 0;
    entity.coinBarOffset = 14;
    entity.healthBarOffset = 20;
    entity.rangeTicks = 0;
    entity.upgradable = {
      level: 1,
      maxLevel: HARVESTER_UPGRADES.sheets.length,
      costs: HARVESTER_UPGRADES.costs,
    };
  }

  return world.add(entity);
}
