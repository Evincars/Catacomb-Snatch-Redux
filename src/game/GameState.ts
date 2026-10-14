import type { CharacterType } from '../entities/PlayerFactory';

export type Difficulty = {
  name: string;
  healthMod: number;
  strengthMod: number;
  spawnMod: number;
  shopCostMod: number;
  mobRegen: boolean;
  regenInterval: number;
  /** Most mobs allowed in one 5x5-tile region before nests stop spawning there. */
  mobDensity: number;
  coinLifespan: number;
};

export const DIFFICULTIES: Difficulty[] = [
  { name: 'Easy',      healthMod: 0.5, strengthMod: 0.5, spawnMod: 1.5, shopCostMod: 0.5, mobRegen: false, regenInterval: 25, mobDensity: 3,      coinLifespan: 30 },
  { name: 'Normal',    healthMod: 1.0, strengthMod: 1.0, spawnMod: 1.25,shopCostMod: 1.0, mobRegen: false, regenInterval: 25, mobDensity: 5,      coinLifespan: 20 },
  { name: 'Hard',      healthMod: 3.0, strengthMod: 3.0, spawnMod: 0.5, shopCostMod: 1.5, mobRegen: true,  regenInterval: 25, mobDensity: 12,     coinLifespan: 15 },
  { name: 'Nightmare', healthMod: 6.0, strengthMod: 5.0, spawnMod: 0.25,shopCostMod: 2.5, mobRegen: true,  regenInterval: 15, mobDensity: 100000, coinLifespan: 10 },
];

export type LevelInfo = {
  name: string;
  /** Map to play, or null for a level whose map file is not part of the game. */
  path: string | null;
  /** Level bitmap the picker draws its preview from. */
  preview: string;
};

/** In the order the original's level picker lists them, row by row. */
export const LEVELS: LevelInfo[] = [
  { name: 'Mojam',           path: '/levels/level1.tmx',       preview: '/levels/level1.bmp' },
  { name: 'AsymeTrical',     path: '/levels/AsymeTrical.tmx',  preview: '/levels/AsymeTrical.bmp' },
  { name: 'CataBOMB',        path: '/levels/CataBOMB.tmx',     preview: '/levels/CataBOMB.bmp' },
  { name: 'Siege',           path: '/levels/Siege.tmx',        preview: '/levels/Siege.bmp' },
  { name: 'TheMaze',         path: '/levels/TheMaze.tmx',      preview: '/levels/TheMaze.bmp' },
  { name: 'Circular_Shapes', path: null,                       preview: '/levels/Circular Shapes.bmp' },
  { name: 'BlackHole',       path: '/levels/BlackHole.tmx',    preview: '/levels/BlackHole.bmp' },
  { name: 'Railroads',       path: '/levels/RailRoads.tmx',    preview: '/levels/RailRoads.bmp' },
  { name: 'DevMap',          path: '/levels/DEV.tmx',          preview: '/levels/DevMap.bmp' },
];

export const DEBUG_COINS = 99999;

// Mutable singleton, carries choices across scenes
export const gameState = {
  selectedCharacter: 'lord_lard' as CharacterType,
  difficulty: DIFFICULTIES[1],
  selectedLevel: LEVELS[0],
  winningTeam: 0,
  /** Debug mode: players start with DEBUG_COINS and the target score cannot end the run. */
  debug: false,
  // Victory is measured in coins carried, as in the Java GoldRush mode, whose
  // target is 5000. Vanilla's 100 applies to a separate deposited-treasury
  // counter and would end the game before any shop item is affordable.
  targetScore: 5000,
};
