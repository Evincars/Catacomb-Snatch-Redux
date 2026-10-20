import { world, PLAYER_SLOTS, MAX_PLAYERS } from '../world';
import type { Entity, PlayerSlot } from '../world';
import { Level } from '../level/Level';
import type { LevelState } from '../level/Level';
import type { TileData } from '../level/TileType';
import { gameState, aiDifficultyNamed, isAIDifficultyName } from './GameState';
import { cleanName } from './Settings';
import type { CharacterType } from '../entities/PlayerFactory';
import type { Difficulty, LevelInfo, MultiplayerMode, OpponentMode } from './GameState';
import { DIFFICULTIES, LEVELS } from './GameState';
import { isWeaponKind } from '../entities/WeaponStats';
import { destroyAttachments } from '../systems/BarSystem';
import { setVisualFrame } from '../render/AnimatedVisual';
import { ensure } from '../core/errors';
import { hasKey, isRecord } from '../core/guards';

const CHARACTERS: readonly CharacterType[] = ['lord_lard', 'countess_cruller', 'herr_von_speck', 'duchess_donut'];

/** Display objects and per-frame flags: rebuilt on the spot, never saved or sent. */
const RUNTIME_KEYS = [
  'sprite', 'container', 'coinBar', 'healthBar', 'sprintBar', 'hurtOverlay', 'fallMask',
  'priceLabel', 'marker', 'rangeView', 'cargoSprite', 'targeted', 'hovered',
] as const satisfies readonly (keyof Entity)[];
type RuntimeKey = (typeof RUNTIME_KEYS)[number];
const RUNTIME: ReadonlySet<string> = new Set(RUNTIME_KEYS);
/** Keys an entity may never be restored with, whatever a save claims. */
const FORBIDDEN_KEYS: ReadonlySet<string> = new Set(['__proto__', 'constructor', 'prototype', 'wallTile']);

/** Saves this big are not ours; refusing them early keeps a damaged file from stalling the game. */
const MAX_LEVEL_SIDE = 256;
const MAX_ENTITIES = 20000;
const MAX_RESPAWN_TICKS = 600;
const MAX_TILE_TYPE = 10;
const MAX_CRUMBLE = 7;
const MAX_COLLAPSE_TICKS = 5;

export type EntityState = Omit<Entity, RuntimeKey>;
export type WorldState = {
  version: 1;
  settings: {
    character: CharacterType; difficulty: Difficulty; map: LevelInfo; debug: boolean; multiplayerMode?: MultiplayerMode;
    /** Computer opponent, its difficulty name and the character it plays. */
    opponent?: OpponentMode; aiDifficulty?: string; aiCharacter?: CharacterType;
  };
  level: LevelState;
  entities: Array<{ id: number; data: EntityState }>;
};

/** A world update without the bulky terrain and fog, which are sent separately. */
export type NetWorldState = Omit<WorldState, 'level'>;

function persistentState(entity: Entity): EntityState {
  const data: EntityState = {};
  for (const [key, value] of Object.entries(entity)) {
    if (!RUNTIME.has(key)) Object.assign(data, { [key]: value });
  }
  return data;
}

export function captureWorld(level: Level): WorldState;
export function captureWorld(level: Level, withLevel: false): NetWorldState;
export function captureWorld(level: Level, withLevel = true): WorldState | NetWorldState {
  const entities = world.entities.filter(e => !e.wallTile && !e.removed)
    .map(entity => ({ id: world.id(entity)!, data: persistentState(entity) }));
  return structuredClone({
    version: 1, ...(withLevel ? { level: level.snapshot() } : {}), entities,
    settings: { character: gameState.selectedCharacter, difficulty: gameState.difficulty,
      map: gameState.selectedLevel, debug: gameState.debug, multiplayerMode: gameState.multiplayerMode,
      opponent: gameState.opponent, aiDifficulty: gameState.aiDifficulty.name, aiCharacter: gameState.aiCharacter },
  });
}

function validateLevelShape(level: LevelState | undefined, entities: unknown): asserts level is LevelState {
  const fits = (n: unknown) => Number.isInteger(n) && Number(n) >= 1 && Number(n) <= MAX_LEVEL_SIDE;
  ensure(level && fits(level.width) && fits(level.height) && Array.isArray(entities) && entities.length <= MAX_ENTITIES,
    'Unsupported or malformed game state');
  ensure(Array.isArray(level.tiles) && level.tiles.length === level.width * level.height
    && Array.isArray(level.seen) && level.seen.length === (level.width + 1) * (level.height + 1)
    && Array.isArray(level.spawns) && level.spawns.length === 2
    && Array.isArray(level.baseTiles) && Array.isArray(level.spawnTiles) && Array.isArray(level.baseAreas),
  'Unsupported or malformed game state');
}

function validateSettings(settings: WorldState['settings'], level: LevelState): void {
  const { opponent, multiplayerMode, aiDifficulty, aiCharacter } = settings;
  ensure(CHARACTERS.includes(settings.character)
    && (opponent === undefined || opponent === 'none' || opponent === 'ai')
    && !(opponent === 'ai' && multiplayerMode === 'enemy')
    && (aiDifficulty === undefined || isAIDifficultyName(aiDifficulty))
    && (aiCharacter === undefined || CHARACTERS.includes(aiCharacter))
    && DIFFICULTIES.some(d => d.name === settings.difficulty?.name)
    && LEVELS.some(m => m.path === settings.map?.path && m.name === settings.map?.name)
    && typeof settings.debug === 'boolean'
    && (multiplayerMode === undefined || multiplayerMode === 'companion' || multiplayerMode === 'enemy'),
  'Invalid world settings');
  ensure(Number.isFinite(level.targetScore) && level.targetScore >= 1
    && Array.isArray(level.scores) && level.scores.length === 2 && level.scores.every(Number.isFinite)
    && level.seen.every(b => typeof b === 'boolean'), 'Invalid world settings');
}

/** A player character must sit in a free slot, on the team its slot plays for. */
function validatePlayerSlot(data: EntityState, settings: WorldState['settings'], slots: Set<string>): void {
  const slot = data.playerSlot!;
  const enemyMode = settings.multiplayerMode === 'enemy';
  ensure(PLAYER_SLOTS.includes(slot) && !slots.has(slot) && !(enemyMode && slot !== 'host' && slot !== 'guest')
    && data.playerInput && data.playerStats && data.health
    && data.team === (slot !== 'host' && enemyMode ? 2 : 1), 'Invalid multiplayer team state');
  slots.add(slot);
}

function validateComputer(data: EntityState, settings: WorldState['settings']): void {
  const ai = data.aiPlayer!;
  ensure(settings.opponent === 'ai' && !data.playerSlot && data.team === 2 && data.playerInput
    && CHARACTERS.includes(ai.character)
    && (ai.role === undefined || ai.role === 'all' || ai.role === 'builder' || ai.role === 'saboteur')
    && isAIDifficultyName(ai.difficulty), 'Invalid computer opponent');
}

function validateEntry(entry: WorldState['entities'][number], ids: Set<number>): void {
  ensure(entry && Number.isInteger(entry.id) && !ids.has(entry.id) && isRecord(entry.data)
    && !Object.keys(entry.data).some(k => RUNTIME.has(k) || FORBIDDEN_KEYS.has(k)), 'Invalid saved entity');
  ids.add(entry.id);
  checkEntity(entry.data);
}

function validTile(t: TileData): boolean {
  if (!t || !Number.isInteger(t.type) || t.type < 0 || t.type > MAX_TILE_TYPE || typeof t.passable !== 'boolean') return false;
  if (t.team !== undefined && t.team !== 1 && t.team !== 2) return false;
  if (t.crumble !== undefined && (!Number.isInteger(t.crumble) || t.crumble < 0 || t.crumble > MAX_CRUMBLE)) return false;
  if (t.steppedOn !== undefined && typeof t.steppedOn !== 'boolean') return false;
  return t.collapseTicks === undefined || (Number.isInteger(t.collapseTicks) && t.collapseTicks >= 0 && t.collapseTicks <= MAX_COLLAPSE_TICKS);
}

function validateTerrain(level: LevelState): void {
  for (const stack of level.tiles) ensure(Array.isArray(stack) && stack.length > 0 && stack.every(validTile), 'Invalid terrain state');
  for (const points of level.spawns) {
    ensure(Array.isArray(points) && points.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y)), 'Invalid spawn state');
  }
}

/** Throws a ValidationError unless `value` is a complete, self-consistent saved or sent world. */
export function validateWorld(value: unknown): asserts value is WorldState {
  ensure(isRecord(value), 'Invalid game state');
  // A parse boundary: the checks below establish every field this cast claims.
  const s = value as Partial<WorldState>;
  ensure(s.version === 1 && s.settings, 'Unsupported or malformed game state');
  validateLevelShape(s.level, s.entities);
  validateSettings(s.settings, s.level);
  const ids = new Set<number>();
  const slots = new Set<string>();
  let computers = 0;
  for (const entry of s.entities!) {
    validateEntry(entry, ids);
    if (entry.data.playerSlot) validatePlayerSlot(entry.data, s.settings, slots);
    if (!entry.data.aiPlayer) continue;
    validateComputer(entry.data, s.settings);
    computers++;
  }
  validateTerrain(s.level);
  ensure(slots.has('host'), 'Save has no host player');
  ensure(computers <= MAX_PLAYERS, 'Save has too many computer opponents');
}

const COMPONENTS = new Set([
  'playerSlot', 'playerName', 'remoteInput', 'aiPlayer', 'aimWorld', 'respawnTicks', 'spawnProtected', 'position', 'velocity', 'radius', 'blocking', 'physicsSlide', 'team',
  'health', 'hurtTime', 'freezeTime', 'bounceWallTime', 'regenInterval', 'regenAmount', 'regenTimer', 'deathPoints',
  'facing', 'speed', 'friction', 'strength', 'aimVector', 'walkTime', 'stepTime', 'limp', 'bump', 'slide', 'chasing',
  'visual', 'frame', 'yOffset', 'flashTime', 'highlight', 'mobType', 'healthBarOffset', 'coinBarOffset', 'fx',
  'animation', 'playerInput', 'playerStats', 'weapon', 'weaponInventory', 'money', 'buffs', 'loot', 'weaponPickup', 'bullet',
  'building', 'tooltip', 'upgradable', 'rangeTicks', 'ephemeral', 'falling', 'stepTimer', 'railCooldown',
  'treasure', 'chest', 'spikeTrap', 'railDroid', 'explosion', 'dustTimer', 'shopItem', 'carriedBy', 'targetId',
  'carryingId', 'turret', 'bomb', 'harvester', 'facing8', 'ai', 'spawner', 'spawnedBy', 'minimapIcon', 'minimapColor', 'tile',
]);
const REQUIRED: Readonly<Record<string, Readonly<Record<string, 'number' | 'string' | 'boolean' | 'object'>>>> = {
  position: { x: 'number', y: 'number' }, velocity: { x: 'number', y: 'number' },
  radius: { x: 'number', y: 'number' }, aimVector: { x: 'number', y: 'number' },
  aimWorld: { x: 'number', y: 'number' }, slide: { x: 'number', y: 'number' }, bump: { x: 'number', y: 'number' },
  health: { current: 'number', max: 'number' }, visual: { sheet: 'string' },
  animation: { sheet: 'string', frameX: 'number', frameY: 'number', frameCount: 'number', frameTime: 'number', timer: 'number', loop: 'boolean' },
  playerInput: { up: 'boolean', down: 'boolean', left: 'boolean', right: 'boolean', shoot: 'boolean', use: 'boolean',
    sprint: 'boolean', mouseX: 'number', mouseY: 'number', mouseAiming: 'boolean', intents: 'object' },
  playerStats: { score: 'number', level: 'number', exp: 'number', sprint: 'number', maxSprint: 'number',
    sprintLocked: 'boolean', restTicks: 'number', sprinting: 'boolean' },
  weapon: { type: 'string', cooldown: 'number', currentCooldown: 'number' },
  weaponInventory: { weapons: 'object', current: 'number' },
  loot: { value: 'number', kind: 'number', velX: 'number', velY: 'number', suckRadius: 'number',
    glide: 'number', age: 'number', life: 'number' },
  weaponPickup: { kind: 'string', age: 'number', life: 'number' },
  bullet: { damage: 'number', ownerId: 'number', freezeTime: 'number', range: 'number', traveledRange: 'number' },
  building: { type: 'string', health: 'number', maxHealth: 'number' },
  tooltip: { title: 'string' }, upgradable: { level: 'number', maxLevel: 'number', costs: 'object' },
  fx: { age: 'number', duration: 'number', frames: 'number' },
  harvester: { radius: 'number', collected: 'number', capacity: 'number', time: 'number', suckTicks: 'number', emptying: 'boolean' },
  turret: { radius: 'number', delay: 'number', cooldown: 'number', damage: 'number' },
  bomb: { blastTiles: 'number', blastDamage: 'number', lit: 'boolean', fuse: 'number', fuseMax: 'number' },
  chest: { value: 'number', opened: 'boolean', disappearTicks: 'number' },
  spikeTrap: { phase: 'number', ticks: 'number' }, treasure: { timer: 'number' },
  railDroid: { dir: 'number', lastDir: 'number', full: 'boolean', swapTime: 'number' },
  shopItem: { kind: 'string', cost: 'number' }, ai: { type: 'string' },
  aiPlayer: { character: 'string', difficulty: 'string' },
  spawner: { mobType: 'string', interval: 'number', timer: 'number', spawnCount: 'number', maxSpawns: 'number' },
  falling: { age: 'number', duration: 'number' }, ephemeral: { age: 'number', life: 'number', drop: 'number' },
  explosion: { life: 'number', duration: 'number', radius: 'number' }, money: { amount: 'number', max: 'number' },
};

type FieldType = 'number' | 'string' | 'boolean' | 'object';

/** A component with a schema must be an object whose listed fields have the listed types; others are plain values. */
function checkComponent(key: string, value: unknown): void {
  ensure(COMPONENTS.has(key), `Unknown game component: ${key}`, { key });
  if (value === undefined) return;
  const schema: Readonly<Record<string, FieldType>> | undefined = REQUIRED[key];
  if (!schema) {
    ensure(key === 'buffs' || typeof value === 'number' || typeof value === 'boolean' || typeof value === 'string', `Invalid ${key} value`);
    return;
  }
  ensure(isRecord(value), `Invalid ${key} component`);
  for (const [field, type] of Object.entries(schema)) {
    const v = value[field];
    ensure(v !== null && typeof v === type && (type !== 'number' || Number.isFinite(v)), `Invalid ${key}.${field}`);
  }
}

const inRange = (n: unknown, lo: number, hi: number) => Number.isInteger(n) && Number(n) >= lo && Number(n) <= hi;

/** Rules that need more than the field types: timers in range, known guns, clean names, complete controls. */
function checkDetails(data: EntityState): void {
  ensure(data.position, 'Entity has no position');
  ensure(data.playerName === undefined || (typeof data.playerName === 'string' && cleanName(data.playerName) === data.playerName),
    'Invalid player name');
  const intents = data.playerInput?.intents;
  ensure(!data.playerInput || (intents && typeof intents.use === 'boolean' && typeof intents.build === 'boolean'
    && typeof intents.upgrade === 'boolean' && Number.isInteger(intents.weaponSlot) && Number.isInteger(intents.weaponStep)),
  'Invalid saved controls');
  const pickup = data.weaponPickup;
  ensure(!pickup || (isWeaponKind(pickup.kind) && pickup.age >= 0 && pickup.life >= 1 && pickup.life <= 100000), 'Invalid dropped weapon');
  ensure(!data.weaponInventory || (Array.isArray(data.weaponInventory.weapons) && data.weaponInventory.weapons.every(isWeaponKind)),
    'Invalid saved weapons');
  ensure(!data.upgradable || (Array.isArray(data.upgradable.costs) && data.upgradable.costs.every(Number.isFinite)), 'Invalid upgrade costs');
  ensure(data.loot?.burstTicks === undefined || inRange(data.loot.burstTicks, 0, 24), 'Invalid loot burst timer');
  const flash = data.playerStats?.pickupFlashCooldown;
  ensure(flash === undefined || inRange(flash, 0, 8), 'Invalid pickup flash timer');
}

function checkEntity(data: EntityState): void {
  const respawn = data.respawnTicks;
  ensure(respawn === undefined || (Number.isFinite(respawn) && respawn >= 0 && respawn <= MAX_RESPAWN_TICKS), 'Invalid respawn countdown');
  ensure(data.spawnProtected === undefined || typeof data.spawnProtected === 'boolean', 'Invalid spawn protection');
  const owner = data.bomb?.ownerTeam;
  ensure(owner === undefined || owner === 0 || owner === 1 || owner === 2, 'Invalid bomb owner');
  for (const [key, value] of Object.entries(data)) checkComponent(key, value);
  checkDetails(data);
}

/** Pixels beyond which a host correction snaps instead of sliding. */
const MAX_GLIDE = 96;

/** Keeps display objects alive on the guest while remapping host entity references to local ECS ids. */
export class WorldReplica {
  private entities = new Map<number, Entity>();
  /** The player this screen controls; everyone else's character takes remote input. */
  localSlot: PlayerSlot | null = null;
  private glides = new Map<Entity, { fromX: number; fromY: number; toX: number; toY: number }>();
  private arrivedAt = 0;
  private interval = 50;

  /** Moves entities smoothly from where they were drawn to where the last update put them. */
  glide(now: number): void {
    const t = Math.min(1, (now - this.arrivedAt) / this.interval);
    for (const [entity, g] of this.glides) {
      if (!entity.position || !world.has(entity)) {
        this.glides.delete(entity);
        continue;
      }
      entity.position.x = g.fromX + (g.toX - g.fromX) * t;
      entity.position.y = g.fromY + (g.toY - g.fromY) * t;
    }
  }

  apply(state: WorldState, now = performance.now()): void {
    validateWorld(state);
    if (this.arrivedAt) this.interval = Math.min(150, Math.max(33, this.interval * 0.8 + (now - this.arrivedAt) * 0.2));
    this.arrivedAt = now;
    this.glides.clear();
    this.dropVanished(new Set(state.entities.map(e => e.id)));
    for (const { id } of state.entities) {
      const entity = this.entities.get(id);
      if (!entity || !world.has(entity)) this.entities.set(id, world.add({}));
    }
    for (const { id, data } of state.entities) this.update(this.entities.get(id)!, data);
  }

  /** Entities the host no longer has are removed here too, display objects and all. */
  private dropVanished(present: ReadonlySet<number>): void {
    for (const [id, entity] of this.entities) {
      if (present.has(id)) continue;
      this.entities.delete(id);
      if (!world.has(entity)) continue;
      destroyAttachments(entity);
      entity.sprite?.destroy({ children: true });
      world.remove(entity);
    }
  }

  /** The local ECS id of the entity the host calls `id`. */
  private local(id: number | undefined): number | undefined {
    const target = id === undefined ? undefined : this.entities.get(id);
    return target ? world.id(target) : undefined;
  }

  /** Host entity ids inside components are rewritten to the matching local ones. */
  private remap(next: EntityState): void {
    next.carriedBy = this.local(next.carriedBy);
    next.carryingId = this.local(next.carryingId);
    next.targetId = this.local(next.targetId);
    next.spawnedBy = this.local(next.spawnedBy);
    if (next.bullet) next.bullet.ownerId = this.local(next.bullet.ownerId) ?? -1;
    if (next.ai) next.ai.targetId = this.local(next.ai.targetId);
    if (next.harvester) next.harvester.emptyingPlayerId = this.local(next.harvester.emptyingPlayerId);
    if (next.fx) next.fx.orderId = this.local(next.fx.orderId);
    if (next.building) next.building.carriedById = this.local(next.building.carriedById);
  }

  /** Brings the entity's components in line with the host's, adding and removing them through the world. */
  private syncComponents(entity: Entity, next: EntityState): void {
    for (const key of Object.keys(entity)) {
      if (hasKey(entity, key) && !RUNTIME.has(key) && !(key in next)) world.removeComponent(entity, key);
    }
    for (const key of Object.keys(next)) {
      if (hasKey(next, key)) this.syncComponent(entity, key, next[key]);
    }
  }

  private syncComponent<K extends keyof EntityState>(entity: Entity, key: K, value: EntityState[K]): void {
    if (value === undefined) {
      if (key in entity) world.removeComponent(entity, key);
    } else if (entity[key] === undefined) {
      world.addComponent(entity, key, value);
    } else {
      Object.assign(entity, { [key]: value });
    }
  }

  /** Small moves slide over the next update; teleports (respawns, falls) and big corrections snap. */
  private glideFrom(entity: Entity, before: { x: number; y: number } | undefined): void {
    if (!before || !entity.position) return;
    const { x: toX, y: toY } = entity.position;
    const moved = before.x !== toX || before.y !== toY;
    if (!moved || Math.hypot(toX - before.x, toY - before.y) >= MAX_GLIDE) return;
    this.glides.set(entity, { fromX: before.x, fromY: before.y, toX, toY });
    entity.position.x = before.x;
    entity.position.y = before.y;
  }

  private update(entity: Entity, data: EntityState): void {
    const next = structuredClone(data);
    const before = entity.position ? { x: entity.position.x, y: entity.position.y } : undefined;
    this.remap(next);
    this.syncComponents(entity, next);
    this.glideFrom(entity, before);
    if (entity.sprite && entity.visual && !entity.animation) {
      setVisualFrame(entity.sprite, entity.visual.sheet, entity.frame ?? entity.visual.col ?? 0, entity.visual.row ?? 0);
    }
    if (!entity.playerSlot) return;
    if (entity.playerSlot !== this.localSlot) world.addComponent(entity, 'remoteInput', true);
    else world.removeComponent(entity, 'remoteInput');
  }
}

export function restoreSettings(state: WorldState): void {
  gameState.multiplayerMode = state.settings.multiplayerMode ?? 'companion';
  gameState.selectedCharacter = state.settings.character;
  // Old saves must not restore the superseded, effectively unlimited spawn rates.
  gameState.difficulty = DIFFICULTIES.find(d => d.name === state.settings.difficulty.name)!;
  gameState.selectedLevel = state.settings.map;
  gameState.debug = state.settings.debug;
  gameState.opponent = state.settings.opponent ?? 'none';
  gameState.aiDifficulty = aiDifficultyNamed(state.settings.aiDifficulty ?? '');
  if (state.settings.aiCharacter) gameState.aiCharacter = state.settings.aiCharacter;
}
