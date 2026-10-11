import { world } from '../world';
import type { Entity } from '../world';
import { Mth } from '../math/Mth';

export type BulletType = 'rifle' | 'shotgun' | 'cannon' | 'flame' | 'poison' | 'ray' | 'melee';

type BulletConfig = {
  damage: number;
  speed: number;
  range: number;
  freezeTime: number;
  radius: { x: number; y: number };
  sheet: string;
  /** The sheet holds 8 facings and the sprite follows the travel direction. */
  directional: boolean;
  /** Frames to pick between at random each tick (plasma). */
  randomFrames?: number;
  /** Sprite centre sits this far above the bullet's position. */
  yOffset: number;
  damageFalloff?: number;
};

/** Rifle, shotgun and ray follow the Java Bullet, BulletBuckshot and BulletRay (speed x duration = range). */
const BULLET_CONFIGS: Record<BulletType, BulletConfig> = {
  rifle:   { damage: 0.5, speed: 6,  range: 240, freezeTime: 5,  radius: { x: 4, y: 4 }, sheet: 'bullet', directional: true, yOffset: 2 },
  shotgun: { damage: 4.5, speed: 18, range: 360, freezeTime: 5,  radius: { x: 2, y: 2 }, sheet: 'bullet_buckshot', directional: false, yOffset: 0, damageFalloff: 0.5 },
  ray:     { damage: 1.5, speed: 5,  range: 250, freezeTime: 5,  radius: { x: 4, y: 4 }, sheet: 'plasmaball', directional: false, randomFrames: 8, yOffset: 2 },
  cannon:  { damage: 8,   speed: 4,  range: 300, freezeTime: 20, radius: { x: 5, y: 5 }, sheet: 'bullet', directional: true, yOffset: 2 },
  flame:   { damage: 1,   speed: 3,  range: 80,  freezeTime: 2,  radius: { x: 3, y: 3 }, sheet: 'bullet', directional: true, yOffset: 2 },
  poison:  { damage: 1,   speed: 4,  range: 150, freezeTime: 0,  radius: { x: 2, y: 2 }, sheet: 'bullet', directional: true, yOffset: 2 },
  melee:   { damage: 4,   speed: 1,  range: 32,  freezeTime: 10, radius: { x: 8, y: 8 }, sheet: 'bullet', directional: true, yOffset: 2 },
};

/** Bullets spawn this far ahead of the shooter, as in Java's Bullet constructor. */
const MUZZLE_REACH = 4;

export function createBullet(
  owner: Entity,
  type: BulletType,
  dirX: number,
  dirY: number,
  damage?: number,
): Entity {
  const cfg = BULLET_CONFIGS[type];
  const pos = owner.position!;
  const len = Math.hypot(dirX, dirY) || 1;
  const nx = dirX / len;
  const ny = dirY / len;
  const ownerId = world.id(owner) ?? -1;
  const facing8 = cfg.directional ? Mth.angleTo8(dirX, dirY) : undefined;

  return world.add({
    // Fired from the feet-level gun position, not the body centre; the sprite
    // is raised by yOffset when drawn.
    position: { x: pos.x + nx * MUZZLE_REACH, y: pos.y + ny * MUZZLE_REACH },
    velocity: { x: nx * cfg.speed, y: ny * cfg.speed },
    radius: { ...cfg.radius },
    yOffset: cfg.yOffset,
    // blocking intentionally omitted — bullets don't block movement
    bullet: {
      damage: damage ?? cfg.damage,
      ownerId,
      freezeTime: cfg.freezeTime,
      range: cfg.range,
      traveledRange: 0,
      damageFalloff: cfg.damageFalloff,
      randomFrames: cfg.randomFrames,
    },
    team: owner.team,
    ...(facing8 !== undefined ? { facing8 } : {}),
    visual: { sheet: cfg.sheet, col: facing8 ?? 0 },
  });
}
