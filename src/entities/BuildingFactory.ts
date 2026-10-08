import { world } from '../world';
import type { Entity } from '../world';
import type { Team } from '../world';

export type BuildingType = 'harvester' | 'turret' | 'bomb' | 'chest' | 'treasure' | 'shop';

type BuildingConfig = {
  health: number;
  radius: { x: number; y: number };
};

const BUILDING_CONFIGS: Record<BuildingType, BuildingConfig> = {
  harvester: { health: 20, radius: { x: 10, y: 10 } },
  turret:    { health: 15, radius: { x: 10, y: 10 } },
  bomb:      { health: 1,  radius: { x: 8,  y: 8  } },
  chest:     { health: 10, radius: { x: 8,  y: 8  } },
  treasure:  { health: 50, radius: { x: 10, y: 10 } },
  shop:      { health: 30, radius: { x: 10, y: 10 } },
};

export function createBuilding(
  x: number,
  y: number,
  type: BuildingType,
  team?: Team,
): Entity {
  const cfg = BUILDING_CONFIGS[type];
  return world.add({
    position: { x, y },
    radius: { ...cfg.radius },
    blocking: true,
    physicsSlide: true,
    team,
    health: { current: cfg.health, max: cfg.health },
    hurtTime: 0,
    freezeTime: 0,
    building: {
      type,
      health: cfg.health,
      maxHealth: cfg.health,
    },
    yOffset: 8,
    minimapColor: 0xaaaaaa,
  });
}
