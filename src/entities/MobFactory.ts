import { world, Team, Facing } from '../world';
import type { Entity } from '../world';
import type { Level } from '../level/Level';

export type MobType = 'mummy' | 'scarab' | 'snake' | 'bat' | 'pharao';

type MobConfig = {
  health: number;
  speed: number;
  deathPoints: number;
  radius: { x: number; y: number };
  sheet: string;
  frameCount: number;
  regenInterval: number;
};

const MOB_CONFIGS: Record<MobType, MobConfig> = {
  mummy: {
    health: 8, speed: 0.7, deathPoints: 2,
    radius: { x: 8, y: 8 },
    sheet: 'enemy_mummy_anim_48',
    frameCount: 4,
    regenInterval: 300,
  },
  scarab: {
    health: 4, speed: 1.1, deathPoints: 1,
    radius: { x: 6, y: 6 },
    sheet: 'enemy_scarab_anim_48',
    frameCount: 4,
    regenInterval: 200,
  },
  snake: {
    health: 6, speed: 0.9, deathPoints: 2,
    radius: { x: 7, y: 7 },
    sheet: 'enemy_snake_anim_48',
    frameCount: 4,
    regenInterval: 240,
  },
  bat: {
    health: 3, speed: 1.4, deathPoints: 1,
    radius: { x: 6, y: 6 },
    sheet: 'enemy_bat_32',
    frameCount: 4,
    regenInterval: 150,
  },
  pharao: {
    health: 30, speed: 0.6, deathPoints: 10,
    radius: { x: 10, y: 10 },
    sheet: 'enemy_pharao_anim_48',
    frameCount: 4,
    regenInterval: 120,
  },
};

export function createMob(
  _level: Level,
  type: string,
  x: number,
  y: number,
): Entity {
  const cfg = MOB_CONFIGS[type as MobType] ?? MOB_CONFIGS.mummy;
  return world.add({
    position: { x, y },
    velocity: { x: 0, y: 0 },
    radius: { ...cfg.radius },
    blocking: true,
    physicsSlide: true,
    team: Team.Neutral,
    health: { current: cfg.health, max: cfg.health },
    hurtTime: 0,
    freezeTime: 0,
    bounceWallTime: 0,
    regenInterval: cfg.regenInterval,
    regenAmount: 1,
    regenTimer: cfg.regenInterval,
    deathPoints: cfg.deathPoints,
    speed: cfg.speed,
    facing: Facing.South,
    aimVector: { x: 0, y: 1 },
    walkTime: 0,
    limp: 2,
    yOffset: 8,
    bump: { x: 0, y: 0 },
    slide: { x: 0, y: 0 },
    chasing: false,
    ai: { type: 'wander' },
    animation: {
      sheet: cfg.sheet,
      frameX: 0,
      frameY: 0,
      frameCount: cfg.frameCount,
      frameTime: 8,
      timer: 0,
      loop: true,
    },
    minimapColor: 0xff8800,
  });
}
