import { world, Team } from '../world';
import type { Entity } from '../world';
import { TILE_WIDTH } from '../level/TileType';

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

  // Turret stats are the Java level-0 upgrade values.
  if (type === 'turret') {
    entity.turret = { radius: 3 * TILE_WIDTH, delay: 24, cooldown: 10, damage: 1 };
    entity.facing8 = 0;
  }
  if (type === 'bomb') entity.bomb = { blastRadius: 50, blastDamage: 5 };
  if (type === 'harvester') entity.harvester = { radius: 60, collected: 0 };

  return world.add(entity);
}
