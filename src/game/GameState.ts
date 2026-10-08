import type { CharacterType } from '../entities/PlayerFactory';

export type Difficulty = {
  name: string;
  healthMod: number;
  strengthMod: number;
  spawnMod: number;
  shopCostMod: number;
  mobRegen: boolean;
  regenInterval: number;
  coinLifespan: number;
};

export const DIFFICULTIES: Difficulty[] = [
  { name: 'Easy',      healthMod: 0.5, strengthMod: 0.5, spawnMod: 1.5, shopCostMod: 0.5, mobRegen: false, regenInterval: 25, coinLifespan: 30 },
  { name: 'Normal',    healthMod: 1.0, strengthMod: 1.0, spawnMod: 1.0, shopCostMod: 1.0, mobRegen: false, regenInterval: 25, coinLifespan: 20 },
  { name: 'Hard',      healthMod: 3.0, strengthMod: 3.0, spawnMod: 0.5, shopCostMod: 1.5, mobRegen: true,  regenInterval: 25, coinLifespan: 15 },
  { name: 'Nightmare', healthMod: 6.0, strengthMod: 5.0, spawnMod: 0.25,shopCostMod: 2.5, mobRegen: true,  regenInterval: 15, coinLifespan: 10 },
];

export type LevelInfo = {
  name: string;
  path: string;
};

export const LEVELS: LevelInfo[] = [
  { name: 'Mojam',        path: '/levels/level1.tmx' },
  { name: 'AsymeTrical',  path: '/levels/AsymeTrical.tmx' },
  { name: 'BlackHole',    path: '/levels/BlackHole.tmx' },
  { name: 'CataBOMB',     path: '/levels/CataBOMB.tmx' },
  { name: 'RailRoads',    path: '/levels/RailRoads.tmx' },
  { name: 'Siege',        path: '/levels/Siege.tmx' },
  { name: 'TheMaze',      path: '/levels/TheMaze.tmx' },
];

// Mutable singleton, carries choices across scenes
export const gameState = {
  selectedCharacter: 'lord_lard' as CharacterType,
  difficulty: DIFFICULTIES[1],
  selectedLevel: LEVELS[0],
  winningTeam: 0,
  targetScore: 100,
};
