import { World } from 'miniplex';
import type { Sprite, Container, Graphics } from 'pixi.js';
import type { PixelLabel } from './ui/PixelText';

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

/** Edge-triggered player requests, cleared by InputSystem at the start of every tick. */
export type PlayerIntents = {
  /** Zero-based inventory slot to equip, or -1. */
  weaponSlot: number;
  /** +1 / -1 to step through the inventory, 0 for none. */
  weaponStep: number;
  use: boolean;
  build: boolean;
  upgrade: boolean;
};

export type ShopKind = 'turret' | 'harvester' | 'bomb' | 'rifle' | 'shotgun' | 'raygun';

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
  /** Per-tick velocity retention: 0.2 for mobs, 0.4 for players (from Java). */
  friction?: number;
  strength?: number;
  aimVector?: { x: number; y: number };
  walkTime?: number;
  stepTime?: number;
  limp?: number;
  bump?: { x: number; y: number };
  /** A building that was just put down, sliding to rest the way it was tossed (Java's xSlide/ySlide). */
  slide?: { x: number; y: number };
  chasing?: boolean;

  // --- rendering ---
  /** Declares what this entity looks like; SpriteSystem turns it into a `sprite`. */
  visual?: { sheet: string; col?: number; row?: number; scale?: number };
  /** Sprite column set by a system each tick (harvester animation); SpriteSystem applies it. */
  frame?: number;
  sprite?: Sprite;
  container?: Container;
  yOffset?: number;
  flashTime?: number;
  highlight?: boolean;
  /** Mob kind (`bat`, `mummy`, ...), used to pick death effects and spawn limits. */
  mobType?: string;
  /** Shows a depleting health bar this many px below the feet once damaged. */
  healthBarOffset?: number;
  /** Shows a bar of a harvester's stored coins this many px below the feet. */
  coinBarOffset?: number;
  /** Runtime display objects for the bars; owned by BarSystem. */
  coinBar?: { container: Container; fill: Sprite };
  healthBar?: { container: Container; fill: Sprite };
  sprintBar?: Sprite;
  /** Solid-colour copy of `sprite` laid over it for hit flashes. */
  hurtOverlay?: Sprite;
  /** Cost text under a shop stall. */
  priceLabel?: PixelLabel;
  /** Short-lived animated sprite (muzzle flash, death blast) that removes itself when done. */
  fx?: {
    age: number;
    duration: number;
    frames: number;
    /** Steps through frames every tick instead of spreading them over `duration`. */
    cycle?: boolean;
    scale?: number;
    /** Entity whose y fixes draw order, so the effect can sit just behind or in front of it. */
    orderId?: number;
    orderBias?: number;
    /** Pixels the effect climbs each tick. */
    rise?: number;
  };

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
    sprint: boolean;
    mouseX: number;
    mouseY: number;
    mouseAiming: boolean;
    /** Aim set by the directional fire keys; overrides the cursor while held. */
    keyAim: { x: number; y: number } | null;
    /** One-shot requests raised for a single tick by key presses. */
    intents: PlayerIntents;
  };
  playerStats?: {
    score: number;
    level: number;
    exp: number;
    /** Ticks spent sprinting; refills one per tick while not sprinting (Java's timeSprint). */
    sprint: number;
    maxSprint: number;
    /** Set when the meter fills; sprinting stays off until the key is released. */
    sprintLocked: boolean;
    /** Ticks since the player last fired; a pause long enough triggers coin harvesting. */
    restTicks: number;
    /** True on ticks where the player is actually sprinting (aim error doubles). */
    sprinting: boolean;
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
  loot?: {
    value: number;
    /** Index into LOOT_KINDS, which picks the art and the pickup sound. */
    kind: number;
    velX: number;
    velY: number;
    /** Distance at which a nearby player starts drawing the coin in. */
    suckRadius: number;
    /** Current glide speed toward a player; zero until harvesting locks the coin on. */
    glide: number;
    /** Ticks since the coin dropped; it vanishes once the difficulty's lifespan is up. */
    age: number;
    /** Ticks it may lie around before vanishing. */
    life: number;
  };

  // --- bullet ---
  bullet?: {
    damage: number;
    ownerId: number;
    freezeTime: number;
    range: number;
    traveledRange: number;
    /** Wall bounces left before the shot dies (plasma balls). */
    bounces?: number;
    /** Damage lost per tick down to a floor of 0.5 (shotgun pellets). */
    damageFalloff?: number;
    /** Picks one of this many sheet frames at random each tick (plasma balls). */
    randomFrames?: number;
  };

  // --- building (harvesters, turrets, bombs) ---
  building?: {
    type: 'harvester' | 'turret' | 'bomb' | 'chest' | 'treasure' | 'shop';
    health: number;
    maxHealth: number;
    carriedById?: number;
    justDroppedTicks?: number;
  };

  /** Text shown in a tooltip while a player hovers over or stands next to this entity. */
  tooltip?: { title: string; lines?: string[]; image?: string };
  /** Levels a building can be raised through; `costs[i]` buys level i + 2. */
  upgradable?: { level: number; maxLevel: number; costs: number[] };
  /** Set while it is the thing a player would interact with, so a marker is drawn. */
  targeted?: true;
  /** Set while the pointer is over it. */
  hovered?: true;
  /** Runtime corner brackets drawn around a targeted entity; owned by MarkerSystem. */
  marker?: Container;
  /** Ticks left to keep the range circle visible; refreshed while the entity is focused or carried. */
  rangeTicks?: number;
  /** Runtime range circle and the radius it was drawn for; owned by RangeSystem. */
  rangeView?: { gfx: Graphics; radius: number };
  /** A short-lived prop (a dropped coin) that falls, blinks and removes itself. */
  ephemeral?: { age: number; life: number; drop: number };
  /** A player dropping down a hole: ticks elapsed of the fall before they respawn. */
  falling?: { age: number; duration: number };
  /** Ticks until the player's next footstep sound. */
  stepTimer?: number;
  /** Ticks before a player may lay or lift another rail. */
  railCooldown?: number;
  /** The treasure pile; `timer` counts down to the next pharaoh rising beside it. */
  treasure?: { timer: number };

  /** A rail carriage: heading (0 N, 1 E, 2 S, 3 W, -1 stopped), last heading for its sprite, and its load of treasure. */
  railDroid?: { dir: number; lastDir: number; full: boolean; swapTime: number };
  /** The pot a carriage holds over its head, drawn separately from its body sprite. */
  cargoSprite?: Sprite;
  /** A blast in progress that keeps throwing out fireballs until `life` runs out. */
  /** A blast scattering fireballs over a square reaching `radius` pixels from its centre. */
  explosion?: { life: number; duration: number; radius: number };
  /** Ticks until the next footstep puff of dust. */
  dustTimer?: number;
  /** A wall tile drawn as a depth-sorted sprite so actors can walk behind it. */
  wallTile?: { tileX: number; tileY: number };

  /** A purchasable item sitting in a player's base. */
  shopItem?: { kind: ShopKind; cost: number };
  /** Set while a player is carrying this building around. */
  carriedBy?: number;
  /** Set on the player: the entity within reach that use / upgrade would act on. */
  targetId?: number;
  /** Set on the player, pointing at whatever they are carrying. */
  carryingId?: number;
  /** Auto-targeting gun turret. */
  turret?: { radius: number; delay: number; cooldown: number; damage: number };
  /** Explodes when destroyed, damaging nearby mobs. `lit` counts down the fuse. */
  /** `blastTiles` is how many tiles the blast reaches beyond the bomb's own, in every direction. */
  bomb?: { blastTiles: number; blastDamage: number; lit: boolean; fuse: number; fuseMax: number };
  /** Vacuums up nearby loot. */
  harvester?: {
    radius: number;
    collected: number;
    capacity: number;
    /** Free-running tick counter driving the animation. */
    time: number;
    /** Ticks left in which the harvester counts as working (it has just pulled in a coin). */
    suckTicks: number;
    /** True while a player is draining its stored coins. */
    emptying: boolean;
    emptyingPlayerId?: number;
  };
  /** 8-way sprite column, for things whose art is directional. */
  facing8?: number;

  // --- AI ---
  ai?: {
    type: 'wander' | 'chase' | 'path';
    targetId?: number;
    /** Cached A* route and the countdown until it is recomputed. */
    path?: Array<{ x: number; y: number }>;
    repathIn?: number;
    retargetIn?: number;
    /** Ticks until a ranged mob spits again. */
    shootIn?: number;
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
  shopItems:     world.with('position', 'shopItem'),
  turrets:       world.with('position', 'turret'),
  harvesters:    world.with('position', 'harvester'),
  tooltips:      world.with('position', 'tooltip'),
  targeted:      world.with('position', 'targeted'),
  upgradables:   world.with('position', 'upgradable'),
  walls:         world.with('position', 'wallTile'),
  rangeViews:    world.with('position', 'rangeTicks'),
  ephemerals:    world.with('position', 'ephemeral'),
};
