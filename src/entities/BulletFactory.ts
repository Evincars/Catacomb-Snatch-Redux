import { world } from '../world';
import type { Entity } from '../world';

export type BulletType = 'rifle' | 'shotgun' | 'cannon' | 'flame' | 'poison' | 'ray' | 'melee';

type BulletConfig = {
  damage: number;
  speed: number;
  range: number;
  freezeTime: number;
  radius: { x: number; y: number };
};

const BULLET_CONFIGS: Record<BulletType, BulletConfig> = {
  rifle:   { damage: 3,  speed: 6,   range: 200, freezeTime: 5,  radius: { x: 2, y: 2 } },
  shotgun: { damage: 2,  speed: 5,   range: 100, freezeTime: 3,  radius: { x: 2, y: 2 } },
  cannon:  { damage: 8,  speed: 4,   range: 300, freezeTime: 20, radius: { x: 5, y: 5 } },
  flame:   { damage: 1,  speed: 3,   range: 80,  freezeTime: 2,  radius: { x: 3, y: 3 } },
  poison:  { damage: 1,  speed: 4,   range: 150, freezeTime: 0,  radius: { x: 2, y: 2 } },
  ray:     { damage: 5,  speed: 10,  range: 400, freezeTime: 5,  radius: { x: 2, y: 2 } },
  melee:   { damage: 4,  speed: 1,   range: 32,  freezeTime: 10, radius: { x: 8, y: 8 } },
};

export function createBullet(
  owner: Entity,
  type: BulletType,
  dirX: number,
  dirY: number,
): Entity {
  const cfg = BULLET_CONFIGS[type];
  const pos = owner.position!;
  const len = Math.sqrt(dirX * dirX + dirY * dirY) || 1;
  const ownerId = world.id(owner) ?? -1;

  return world.add({
    position: { x: pos.x, y: pos.y },
    velocity: { x: (dirX / len) * cfg.speed, y: (dirY / len) * cfg.speed },
    radius: { ...cfg.radius },
    // blocking intentionally omitted — bullets don't block movement
    bullet: {
      damage: cfg.damage,
      ownerId,
      freezeTime: cfg.freezeTime,
      range: cfg.range,
      traveledRange: 0,
    },
    team: owner.team,
  });
}
