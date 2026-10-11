import { world, Team, Facing } from '../world';
import type { Entity } from '../world';
import type { Level } from '../level/Level';
import { gameState } from '../game/GameState';

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
  /** Sprite is drawn this far above the feet (Java yOffs). */
  yOffset: number;
  /** Overrides the difficulty's regeneration interval (Java sets 15 for pharaohs). */
  regenInterval?: number;
};

/** Values taken verbatim from the original's resources/constants/constants.txt. */
const MOB_CONFIGS: Record<MobType, MobConfig> = {
  bat: {
    health: 1, speed: 1, strength: 1, deathPoints: 1, limp: 0,
    radius: { x: 6, y: 6 },
    sheet: 'enemy_bat_32',
    frameCount: 4,
    yOffset: 5,
  },
  mummy: {
    health: 7, speed: 0.5, strength: 2, deathPoints: 4, limp: 3,
    radius: { x: 8, y: 8 },
    sheet: 'enemy_mummy_anim_48',
    frameCount: 4,
    yOffset: 10,
  },
  scarab: {
    health: 5, speed: 0.7, strength: 2, deathPoints: 4, limp: 4,
    radius: { x: 6, y: 6 },
    sheet: 'enemy_scarab_anim_48',
    frameCount: 4,
    yOffset: 10,
  },
  snake: {
    health: 3, speed: 1.5, strength: 1, deathPoints: 2, limp: 4,
    radius: { x: 7, y: 7 },
    sheet: 'enemy_snake_anim_48',
    frameCount: 4,
    yOffset: 10,
  },
  pharao: {
    health: 40, speed: 1.0, strength: 3, deathPoints: 30, limp: 3,
    radius: { x: 10, y: 10 },
    sheet: 'enemy_pharao_anim_48',
    frameCount: 4,
    yOffset: 10,
    regenInterval: 15,
  },
};

/** Collision half-size of a mob kind, so spawners can test a spot before creating the mob. */
export function mobRadius(type: string): { x: number; y: number } {
  return (MOB_CONFIGS[type as MobType] ?? MOB_CONFIGS.mummy).radius;
}

export function createMob(
  _level: Level,
  type: string,
  x: number,
  y: number,
): Entity {
  const cfg = MOB_CONFIGS[type as MobType] ?? MOB_CONFIGS.mummy;
  const difficulty = gameState.difficulty;
  const health = cfg.health * difficulty.healthMod;
  const regenInterval = cfg.regenInterval ?? difficulty.regenInterval;

  return world.add({
    position: { x, y },
    velocity: { x: 0, y: 0 },
    radius: { ...cfg.radius },
    blocking: true,
    physicsSlide: true,
    team: Team.Neutral,
    mobType: MOB_CONFIGS[type as MobType] ? type : 'mummy',
    health: { current: health, max: health },
    healthBarOffset: 10,
    hurtTime: 0,
    freezeTime: 0,
    bounceWallTime: 0,
    regenInterval,
    regenAmount: 1,
    regenTimer: regenInterval,
    deathPoints: cfg.deathPoints,
    strength: cfg.strength * difficulty.strengthMod,
    speed: cfg.speed,
    // Mobs bleed off nearly all momentum each tick, as in Java's Mob.walk().
    friction: 0.2,
    facing: Facing.South,
    aimVector: { x: 0, y: 1 },
    walkTime: 0,
    limp: cfg.limp,
    yOffset: cfg.yOffset,
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
