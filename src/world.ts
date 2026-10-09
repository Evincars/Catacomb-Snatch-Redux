import { World } from 'miniplex';
import type { Sprite, Container } from 'pixi.js';

export const enum Team {
  Neutral = 0,
  One = 1,
  Two = 2,
}

export const enum Facing {
  North = 0,
  East = 1,
  South = 2,
  West = 3,
}

export type Entity = {
  // --- spatial ---
  position?: { x: number; y: number };
  velocity?: { x: number; y: number };
  radius?: { x: number; y: number };
  blocking?: true;
  physicsSlide?: true;

  // --- team ---
  team?: Team;

  // --- health / combat timers ---
  health?: { current: number; max: number; immortal?: boolean };
  hurtTime?: number;
  freezeTime?: number;
  bounceWallTime?: number;
  regenInterval?: number;
  regenAmount?: number;
  regenTimer?: number;
  deathPoints?: number;

  // --- movement ---
  facing?: Facing;
  speed?: number;
  aimVector?: { x: number; y: number };
  walkTime?: number;
  stepTime?: number;
  limp?: number;
  bump?: { x: number; y: number };
  slide?: { x: number; y: number };
  chasing?: boolean;

  // --- rendering ---
  /** Declares what this entity looks like; SpriteSystem turns it into a `sprite`. */
  visual?: { sheet: string; col?: number; row?: number };
  sprite?: Sprite;
  container?: Container;
  yOffset?: number;
  flashTime?: number;
  highlight?: boolean;

  // --- animation ---
  animation?: {
    sheet: string;
    frameX: number;
    frameY: number;
    frameCount: number;
    frameTime: number;
    timer: number;
    loop: boolean;
  };

  // --- player ---
  playerInput?: {
    up: boolean;
    down: boolean;
    left: boolean;
    right: boolean;
    shoot: boolean;
    use: boolean;
    mouseX: number;
    mouseY: number;
    mouseAiming: boolean;
  };
  playerStats?: {
    score: number;
    level: number;
    exp: number;
    sprint: number;
    maxSprint: number;
    muzzleTicks: number;
    muzzleX: number;
    muzzleY: number;
  };

  // --- weapon ---
  weapon?: {
    type: string;
    cooldown: number;
    currentCooldown: number;
  };
  weaponInventory?: { weapons: string[]; current: number };

  // --- money ---
  money?: { amount: number; max: number };

  // --- buffs ---
  buffs?: Array<{ type: 'poison' | 'troll_perk'; duration: number; strength: number }>;

  // --- loot ---
  loot?: { value: number; velX: number; velY: number; suckRadius: number };

  // --- bullet ---
  bullet?: {
    damage: number;
    ownerId: number;
    freezeTime: number;
    range: number;
    traveledRange: number;
  };

  // --- building (harvesters, turrets, bombs) ---
  building?: {
    type: 'harvester' | 'turret' | 'bomb' | 'chest' | 'treasure' | 'shop';
    health: number;
    maxHealth: number;
    carriedById?: number;
    justDroppedTicks?: number;
  };

  // --- AI ---
  ai?: {
    type: 'wander' | 'chase' | 'path';
    targetId?: number;
    /** Cached A* route and the countdown until it is recomputed. */
    path?: Array<{ x: number; y: number }>;
    repathIn?: number;
    retargetIn?: number;
  };

  // --- spawner ---
  spawner?: {
    mobType: string;
    interval: number;
    timer: number;
    spawnCount: number;
    maxSpawns: number;
  };

  // --- minimap ---
  minimapIcon?: number;
  minimapColor?: number;

  // --- level tile reference (for tile entities) ---
  tile?: {
    tileX: number;
    tileY: number;
    type: string;
    solid: boolean;
    passable: boolean;
  };

  // --- lifecycle ---
  removed?: true;
};

export const world = new World<Entity>();

// Pre-build queries used by multiple systems
export const q = {
  positioned:    world.with('position'),
  physical:      world.with('position', 'velocity', 'radius'),
  renderable:    world.with('position', 'sprite'),
  animated:      world.with('animation', 'sprite'),
  needsSprite:   world.with('visual', 'position').without('sprite'),
  players:       world.with('position', 'playerInput', 'playerStats', 'health'),
  mobs:          world.with('position', 'health', 'ai'),
  bullets:       world.with('position', 'velocity', 'bullet'),
  loot:          world.with('position', 'loot'),
  buildings:     world.with('position', 'building'),
  spawners:      world.with('position', 'spawner'),
  buffed:        world.with('buffs'),
};
