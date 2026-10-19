import type { CharacterType } from '../entities/PlayerFactory';
import { settings } from './Settings';

export type Difficulty = {
  name: string;
  healthMod: number;
  strengthMod: number;
  spawnMod: number;
  shopCostMod: number;
  mobRegen: boolean;
  regenInterval: number;
  /** Most mobs within five tiles of a spawning point. */
  mobDensity: number;
  maxMobs: number;
  maxSpawners: number;
  /** Pharaohs placed around each treasure pile when the level opens; they never respawn. */
  pharaohs: number;
  coinLifespan: number;
};

export const DIFFICULTIES: Difficulty[] = [
  { name: 'Easy',      healthMod: 0.5, strengthMod: 0.5, spawnMod: 1.5,  shopCostMod: 0.5, mobRegen: false, regenInterval: 25, mobDensity: 8, maxMobs: 150, maxSpawners: 22, pharaohs: 1, coinLifespan: 30 },
  { name: 'Normal',    healthMod: 1.0, strengthMod: 1.0, spawnMod: 1.25, shopCostMod: 1.0, mobRegen: false, regenInterval: 25, mobDensity: 12, maxMobs: 220, maxSpawners: 32, pharaohs: 2, coinLifespan: 20 },
  { name: 'Hard',      healthMod: 3.0, strengthMod: 3.0, spawnMod: 1.25, shopCostMod: 1.5, mobRegen: true,  regenInterval: 25, mobDensity: 12, maxMobs: 220, maxSpawners: 32, pharaohs: 3, coinLifespan: 15 },
  { name: 'Nightmare', healthMod: 6.0, strengthMod: 5.0, spawnMod: 1.0,  shopCostMod: 2.5, mobRegen: true,  regenInterval: 15, mobDensity: 14, maxMobs: 270, maxSpawners: 40, pharaohs: 4, coinLifespan: 10 },
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
  { name: 'DevMap',          path: '/levels/DevMap.tmx',       preview: '/levels/DevMap.bmp' },
];

export type MultiplayerMode = 'companion' | 'enemy';
export type OpponentMode = 'none' | 'ai';

/** How a computer opponent plays; every number is a tuning knob, not a rule. */
export type AIDifficulty = {
  name: string;
  /** Ticks between re-planning what to do next. */
  thinkTicks: number;
  /** Ticks before it notices and turns on a new target. */
  reactionTicks: number;
  /** Largest random aim error, in radians. */
  aimError: number;
  /** Farthest distance, in pixels, it will open fire from. */
  engageRange: number;
  /** Chance per ready shot that it actually pulls the trigger. */
  fireRate: number;
  /** Coins a harvester must hold before it walks over to empty it. */
  drainThreshold: number;
  maxCarriages: number;
  maxTurrets: number;
  /** Further turrets, beyond maxTurrets, it stands along its laid track. */
  trackTurrets: number;
  /** Highest level it will upgrade its buildings to. */
  maxUpgrade: number;
  /** Ticks into the match before it starts laying track. */
  railDelay: number;
  sprint: boolean;
  /** Fraction of health below which it falls back to its base. */
  retreatHealth: number;
  /** Coins kept back when buying anything that is not track. */
  reserve: number;
  /** Price multiplier on the computer's own stalls; harder opponents shop a little cheaper. */
  shopDiscount: number;
  /** Whether it works out shots that bounce off walls to hit a rival hiding behind them. */
  ricochet: boolean;
  /** 0-1: how readily it hunts rivals, defends the track and wrecks the rival's, instead of only building. */
  aggression: number;
};

export const AI_DIFFICULTIES: AIDifficulty[] = [
  { name: 'Easy',   thinkTicks: 45, reactionTicks: 40, aimError: 0.35, engageRange: 150, fireRate: 0.45, drainThreshold: 400,
    maxCarriages: 1, maxTurrets: 2, trackTurrets: 1, maxUpgrade: 1, railDelay: 60 * 90, sprint: false, retreatHealth: 0.25, reserve: 100, shopDiscount: 1, ricochet: false, aggression: 0.25 },
  { name: 'Normal', thinkTicks: 25, reactionTicks: 22, aimError: 0.18, engageRange: 200, fireRate: 0.8,  drainThreshold: 250,
    maxCarriages: 3, maxTurrets: 5, trackTurrets: 4, maxUpgrade: 3, railDelay: 60 * 40, sprint: true,  retreatHealth: 0.3,  reserve: 50,  shopDiscount: 1, ricochet: true, aggression: 0.6 },
  { name: 'Hard',   thinkTicks: 12, reactionTicks: 10, aimError: 0.09, engageRange: 240, fireRate: 1,    drainThreshold: 150,
    maxCarriages: 4, maxTurrets: 6, trackTurrets: 5, maxUpgrade: 3, railDelay: 60 * 15, sprint: true,  retreatHealth: 0.35, reserve: 25,  shopDiscount: 0.9, ricochet: true, aggression: 0.85 },
  { name: 'Insane', thinkTicks: 6,  reactionTicks: 4,  aimError: 0.04, engageRange: 280, fireRate: 1,    drainThreshold: 100,
    maxCarriages: 5, maxTurrets: 7, trackTurrets: 6, maxUpgrade: 3, railDelay: 0,       sprint: true,  retreatHealth: 0.4,  reserve: 0,   shopDiscount: 0.8, ricochet: true, aggression: 1 },
];

// Mutable singleton, carries choices across scenes
export const gameState = {
  multiplayerMode: 'companion' as MultiplayerMode,
  /** A computer-controlled opponent on Team Two in the current run; not combined with an enemy guest. */
  opponent: 'none' as OpponentMode,
  /** The menu's opponent choice. Kept apart from `opponent` so a map without a
   *  second base, an enemy match or a loaded save never silently clears it. */
  opponentChoice: settings.opponent as OpponentMode,
  aiDifficulty: AI_DIFFICULTIES.find(d => d.name === settings.aiDifficulty) ?? AI_DIFFICULTIES[1],
  /** Character the computer plays, picked when a match starts; never the player's. */
  aiCharacter: 'herr_von_speck' as CharacterType,
  selectedCharacter: 'lord_lard' as CharacterType,
  difficulty: DIFFICULTIES[1],
  selectedLevel: LEVELS[0],
  winningTeam: 0,
  /** Retired debug switch, kept only so saved games still validate. The ~ console replaced it. */
  debug: false,
  // Solo/companion GoldRush counts carried coins. Enemy matches instead use
  // the original versus treasury target of 100, with two points per delivery.
  targetScore: 5000,
};

/** Two sides compete for the treasury: an enemy guest, or the computer opponent. */
export function isVersus(): boolean {
  return gameState.multiplayerMode === 'enemy' || gameState.opponent === 'ai';
}

export function characterName(character: CharacterType): string {
  return character.replace(/_/g, ' ').toUpperCase();
}
