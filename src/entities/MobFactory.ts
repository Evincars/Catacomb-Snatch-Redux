import { world, Team, Facing } from '../world';
import type { Entity } from '../world';
import type { Level } from '../level/Level';

export type MobType = 'mummy' | 'scarab' | 'snake' | 'bat' | 'pharao';

type MobConfig = {
  health: number;
  speed: number;
  strength: number;
  deathPoints: number;
  /** Stutter in the walk cycle; the mob pauses when walkTime/12 % limp === 0. */
  limp: number;
  radius: { x: number; y: number };
  sheet: string;
  frameCount: number;
  regenInterval: number;
};

/** Values taken verbatim from the original's resources/constants/constants.txt. */
const MOB_CONFIGS: Record<MobType, MobConfig> = {
  bat: {
    health: 1, speed: 1, strength: 1, deathPoints: 1, limp: 0,
    radius: { x: 6, y: 6 },
    sheet: 'enemy_bat_32',
    frameCount: 4,
    regenInterval: 150,
  },
  mummy: {
    health: 7, speed: 0.5, strength: 2, deathPoints: 4, limp: 3,
    radius: { x: 8, y: 8 },
    sheet: 'enemy_mummy_anim_48',
    frameCount: 4,
    regenInterval: 300,
  },
  scarab: {
    health: 5, speed: 0.7, strength: 2, deathPoints: 4, limp: 4,
    radius: { x: 6, y: 6 },
    sheet: 'enemy_scarab_anim_48',
    frameCount: 4,
    regenInterval: 200,
  },
  snake: {
    health: 3, speed: 1.5, strength: 1, deathPoints: 2, limp: 4,
    radius: { x: 7, y: 7 },
    sheet: 'enemy_snake_anim_48',
    frameCount: 4,
    regenInterval: 240,
  },
  pharao: {
    health: 40, speed: 1.0, strength: 3, deathPoints: 30, limp: 3,
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
    strength: cfg.strength,
    speed: cfg.speed,
    // Mobs bleed off nearly all momentum each tick, as in Java's Mob.walk().
    friction: 0.2,
    facing: Facing.South,
    aimVector: { x: 0, y: 1 },
    walkTime: 0,
    limp: cfg.limp,
    yOffset: 8,
    bump: { x: 0, y: 0 },
    slide: { x: 0, y: 0 },
    chasing: false,
    ai: { type: 'wander' },
    visual: { sheet: cfg.sheet },
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
