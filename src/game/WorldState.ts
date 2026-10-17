import { world } from '../world';
import type { Entity } from '../world';
import { Level } from '../level/Level';
import type { LevelState } from '../level/Level';
import { gameState } from './GameState';
import type { CharacterType } from '../entities/PlayerFactory';
import type { Difficulty, LevelInfo, MultiplayerMode, OpponentMode } from './GameState';
import { AI_DIFFICULTIES, DIFFICULTIES, LEVELS } from './GameState';
import { WEAPON_STATS } from '../entities/WeaponStats';
import { destroyAttachments } from '../systems/BarSystem';
import { setVisualFrame } from '../render/AnimatedVisual';

const CHARACTERS: CharacterType[] = ['lord_lard', 'countess_cruller', 'herr_von_speck', 'duchess_donut'];

const RUNTIME = new Set<keyof Entity>([
  'sprite', 'container', 'coinBar', 'healthBar', 'sprintBar', 'hurtOverlay', 'fallMask',
  'priceLabel', 'marker', 'rangeView', 'cargoSprite', 'targeted', 'hovered',
]);
type RuntimeKey = 'sprite' | 'container' | 'coinBar' | 'healthBar' | 'sprintBar'
  | 'hurtOverlay' | 'fallMask' | 'priceLabel' | 'marker' | 'rangeView' | 'cargoSprite' | 'targeted' | 'hovered';
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

export function captureWorld(level: Level): WorldState {
  const entities = world.entities.filter(e => !e.wallTile && !e.removed).map(entity => {
    const data: EntityState = {};
    for (const key of Object.keys(entity) as Array<keyof Entity>) {
      if (!RUNTIME.has(key)) Object.assign(data, { [key]: entity[key] });
    }
    return { id: world.id(entity)!, data };
  });
  return structuredClone({
    version: 1, level: level.snapshot(), entities,
    settings: { character: gameState.selectedCharacter, difficulty: gameState.difficulty,
      map: gameState.selectedLevel, debug: gameState.debug, multiplayerMode: gameState.multiplayerMode,
      opponent: gameState.opponent, aiDifficulty: gameState.aiDifficulty.name, aiCharacter: gameState.aiCharacter },
  });
}

export function validateWorld(value: unknown): asserts value is WorldState {
  if (!value || typeof value !== 'object') throw new Error('Invalid game state');
  const s = value as Partial<WorldState>;
  if (s.version !== 1 || !s.level || !s.settings || !Array.isArray(s.entities)
    || !Number.isInteger(s.level.width) || !Number.isInteger(s.level.height)
    || s.level.width < 1 || s.level.height < 1 || s.level.width > 256 || s.level.height > 256
    || !Array.isArray(s.level.tiles) || s.level.tiles.length !== s.level.width * s.level.height
    || !Array.isArray(s.level.seen) || s.level.seen.length !== (s.level.width + 1) * (s.level.height + 1)
    || !Array.isArray(s.level.spawns) || s.level.spawns.length !== 2
    || !Array.isArray(s.level.baseTiles) || !Array.isArray(s.level.spawnTiles) || !Array.isArray(s.level.baseAreas)
    || s.entities.length > 20000) throw new Error('Unsupported or malformed game state');
  if (!CHARACTERS.includes(s.settings.character)
    || s.settings.opponent !== undefined && !['none', 'ai'].includes(s.settings.opponent)
    || s.settings.opponent === 'ai' && s.settings.multiplayerMode === 'enemy'
    || s.settings.aiDifficulty !== undefined && !AI_DIFFICULTIES.some(d => d.name === s.settings!.aiDifficulty)
    || s.settings.aiCharacter !== undefined && !CHARACTERS.includes(s.settings.aiCharacter)
    || !DIFFICULTIES.some(d => d.name === s.settings?.difficulty?.name)
    || !LEVELS.some(m => m.path === s.settings!.map?.path && m.name === s.settings!.map?.name)
    || typeof s.settings.debug !== 'boolean'
    || s.settings.multiplayerMode !== undefined && !['companion', 'enemy'].includes(s.settings.multiplayerMode)
    || !Number.isFinite(s.level.targetScore) || s.level.targetScore < 1
    || !Array.isArray(s.level.scores) || s.level.scores.length !== 2 || !s.level.scores.every(Number.isFinite)
    || !s.level.seen.every(b => typeof b === 'boolean')) throw new Error('Invalid world settings');
  const ids = new Set<number>();
  const slots = new Set<string>();
  let computers = 0;
  for (const entry of s.entities) {
    if (!entry || !Number.isInteger(entry.id) || ids.has(entry.id) || !entry.data
      || typeof entry.data !== 'object' || Object.keys(entry.data).some(k => RUNTIME.has(k as keyof Entity)
        || ['__proto__', 'constructor', 'prototype', 'wallTile'].includes(k))) throw new Error('Invalid saved entity');
    ids.add(entry.id);
    checkEntity(entry.data);
    if (entry.data.playerSlot) {
      if (!['host', 'guest'].includes(entry.data.playerSlot) || slots.has(entry.data.playerSlot)
        || !entry.data.playerInput || !entry.data.playerStats || !entry.data.health
        || entry.data.team !== (entry.data.playerSlot === 'guest' && s.settings.multiplayerMode === 'enemy' ? 2 : 1)) {
        throw new Error('Invalid multiplayer team state');
      }
      slots.add(entry.data.playerSlot);
    }
    if (entry.data.aiPlayer) {
      if (s.settings.opponent !== 'ai' || entry.data.playerSlot || entry.data.team !== 2 || !entry.data.playerInput
        || !CHARACTERS.includes(entry.data.aiPlayer.character)
        || !AI_DIFFICULTIES.some(d => d.name === entry.data.aiPlayer!.difficulty)) throw new Error('Invalid computer opponent');
      computers++;
    }
  }
  for (const stack of s.level.tiles) {
    if (!Array.isArray(stack) || !stack.length || stack.some(t => !t || !Number.isInteger(t.type)
      || t.type < 0 || t.type > 10 || typeof t.passable !== 'boolean'
      || t.team !== undefined && ![1, 2].includes(t.team)
      || t.crumble !== undefined && (!Number.isInteger(t.crumble) || t.crumble < 0 || t.crumble > 7)
      || t.steppedOn !== undefined && typeof t.steppedOn !== 'boolean'
      || t.collapseTicks !== undefined && (!Number.isInteger(t.collapseTicks) || t.collapseTicks < 0 || t.collapseTicks > 5))) throw new Error('Invalid terrain state');
  }
  if (!slots.has('host')) throw new Error('Save has no host player');
  if (computers > 1) throw new Error('Save has more than one computer opponent');
  for (const points of s.level.spawns) {
    if (!Array.isArray(points) || points.some(p => !p || !Number.isFinite(p.x) || !Number.isFinite(p.y))) throw new Error('Invalid spawn state');
  }
}

const COMPONENTS = new Set([
  'playerSlot', 'remoteInput', 'aiPlayer', 'aimWorld', 'respawnTicks', 'spawnProtected', 'position', 'velocity', 'radius', 'blocking', 'physicsSlide', 'team',
  'health', 'hurtTime', 'freezeTime', 'bounceWallTime', 'regenInterval', 'regenAmount', 'regenTimer', 'deathPoints',
  'facing', 'speed', 'friction', 'strength', 'aimVector', 'walkTime', 'stepTime', 'limp', 'bump', 'slide', 'chasing',
  'visual', 'frame', 'yOffset', 'flashTime', 'highlight', 'mobType', 'healthBarOffset', 'coinBarOffset', 'fx',
  'animation', 'playerInput', 'playerStats', 'weapon', 'weaponInventory', 'money', 'buffs', 'loot', 'bullet',
  'building', 'tooltip', 'upgradable', 'rangeTicks', 'ephemeral', 'falling', 'stepTimer', 'railCooldown',
  'treasure', 'chest', 'spikeTrap', 'railDroid', 'explosion', 'dustTimer', 'shopItem', 'carriedBy', 'targetId',
  'carryingId', 'turret', 'bomb', 'harvester', 'facing8', 'ai', 'spawner', 'spawnedBy', 'minimapIcon', 'minimapColor', 'tile',
]);
const REQUIRED: Record<string, Record<string, 'number' | 'string' | 'boolean' | 'object'>> = {
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

function checkEntity(data: EntityState): void {
  if (data.respawnTicks !== undefined && (!Number.isFinite(data.respawnTicks)
    || data.respawnTicks < 0 || data.respawnTicks > 600)) throw new Error('Invalid respawn countdown');
  if (data.spawnProtected !== undefined && typeof data.spawnProtected !== 'boolean') throw new Error('Invalid spawn protection');
  if (data.bomb?.ownerTeam !== undefined && ![0, 1, 2].includes(data.bomb.ownerTeam)) throw new Error('Invalid bomb owner');
  for (const [key, value] of Object.entries(data)) {
    if (!COMPONENTS.has(key)) throw new Error(`Unknown game component: ${key}`);
    if (value === undefined) continue;
    const schema = REQUIRED[key];
    if (schema) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`Invalid ${key} component`);
      const object = value as Record<string, unknown>;
      for (const [field, type] of Object.entries(schema)) {
        if (object[field] === null || typeof object[field] !== type
          || type === 'number' && !Number.isFinite(object[field])) throw new Error(`Invalid ${key}.${field}`);
      }
    } else if (key !== 'buffs' && !['number', 'boolean', 'string'].includes(typeof value)) {
      throw new Error(`Invalid ${key} value`);
    }
  }
  if (!data.position) throw new Error('Entity has no position');
  if (data.playerInput) {
    const i = data.playerInput.intents;
    if (!i || typeof i.use !== 'boolean' || typeof i.build !== 'boolean' || typeof i.upgrade !== 'boolean'
      || !Number.isInteger(i.weaponSlot) || !Number.isInteger(i.weaponStep)) throw new Error('Invalid saved controls');
  }
  if (data.weaponInventory && (!Array.isArray(data.weaponInventory.weapons)
    || !data.weaponInventory.weapons.every(w => Object.prototype.hasOwnProperty.call(WEAPON_STATS, w)))) throw new Error('Invalid saved weapons');
  if (data.upgradable && (!Array.isArray(data.upgradable.costs) || !data.upgradable.costs.every(Number.isFinite))) throw new Error('Invalid upgrade costs');
  if (data.loot?.burstTicks !== undefined && (!Number.isInteger(data.loot.burstTicks)
    || data.loot.burstTicks < 0 || data.loot.burstTicks > 24)) throw new Error('Invalid loot burst timer');
  if (data.playerStats?.pickupFlashCooldown !== undefined && (!Number.isInteger(data.playerStats.pickupFlashCooldown)
    || data.playerStats.pickupFlashCooldown < 0 || data.playerStats.pickupFlashCooldown > 8)) throw new Error('Invalid pickup flash timer');
}

/** Keeps display objects alive on the guest while remapping host entity references to local ECS ids. */
export class WorldReplica {
  private entities = new Map<number, Entity>();

  apply(state: WorldState): void {
    validateWorld(state);
    const present = new Set(state.entities.map(e => e.id));
    for (const [id, entity] of this.entities) {
      if (present.has(id)) continue;
      if (world.has(entity)) {
        destroyAttachments(entity);
        entity.sprite?.destroy({ children: true });
        world.remove(entity);
      }
      this.entities.delete(id);
    }
    for (const { id } of state.entities) {
      const entity = this.entities.get(id);
      if (!entity || !world.has(entity)) this.entities.set(id, world.add({}));
    }
    const reference = (id: number | undefined) => {
      const target = id === undefined ? undefined : this.entities.get(id);
      return target ? world.id(target) : undefined;
    };
    for (const { id, data } of state.entities) {
      const entity = this.entities.get(id)!;
      const next = structuredClone(data);
      next.carriedBy = reference(next.carriedBy);
      next.carryingId = reference(next.carryingId);
      next.targetId = reference(next.targetId);
      next.spawnedBy = reference(next.spawnedBy);
      if (next.bullet) next.bullet.ownerId = reference(next.bullet.ownerId) ?? -1;
      if (next.ai) next.ai.targetId = reference(next.ai.targetId);
      if (next.harvester) next.harvester.emptyingPlayerId = reference(next.harvester.emptyingPlayerId);
      if (next.fx) next.fx.orderId = reference(next.fx.orderId);
      if (next.building) next.building.carriedById = reference(next.building.carriedById);
      for (const key of Object.keys(entity) as Array<keyof Entity>) {
        if (!RUNTIME.has(key) && !(key in next)) world.removeComponent(entity, key);
      }
      for (const key of Object.keys(next) as Array<keyof EntityState>) {
        const value = next[key];
        if (value !== undefined) {
          if (entity[key] === undefined) world.addComponent(entity, key, value);
          else Object.assign(entity, { [key]: value });
        }
        else if (key in entity) world.removeComponent(entity, key);
      }
      if (entity.sprite && entity.visual && !entity.animation) {
        setVisualFrame(entity.sprite, entity.visual.sheet, entity.frame ?? entity.visual.col ?? 0, entity.visual.row ?? 0);
      }
      if (entity.playerSlot) {
        if (entity.playerSlot === 'guest') world.addComponent(entity, 'remoteInput', true);
        else world.removeComponent(entity, 'remoteInput');
      }
    }
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
  gameState.aiDifficulty = AI_DIFFICULTIES.find(d => d.name === state.settings.aiDifficulty) ?? AI_DIFFICULTIES[1];
  if (state.settings.aiCharacter) gameState.aiCharacter = state.settings.aiCharacter;
}
