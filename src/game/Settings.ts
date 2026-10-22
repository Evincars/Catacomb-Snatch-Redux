/** Persisted player preferences and key bindings. */
import { MathUtils } from 'yuka';
import { attempt } from '../core/errors';
import { hasKey, isFiniteNumber, isRecord } from '../core/guards';
import { createLog } from '../core/log';

const log = createLog('settings');

export const ACTION_NAMES = [
  'up', 'down', 'left', 'right', 'sprint',
  'fire', 'fire_up', 'fire_down', 'fire_left', 'fire_right',
  'build', 'use', 'upgrade',
  'weapon_slot_1', 'weapon_slot_2', 'weapon_slot_3',
  'next_weapon', 'prev_weapon', 'drop_weapon', 'give_coins',
  'console', 'chat',
] as const;

export type ActionName = (typeof ACTION_NAMES)[number];

export const ACTION_LABELS: Record<ActionName, string> = {
  up: 'UP',
  down: 'DOWN',
  left: 'LEFT',
  right: 'RIGHT',
  sprint: 'SPRINT',
  fire: 'FIRE',
  fire_up: 'FIRE UP',
  fire_down: 'FIRE DOWN',
  fire_left: 'FIRE LEFT',
  fire_right: 'FIRE RIGHT',
  build: 'BUILD',
  use: 'USE',
  upgrade: 'UPGRADE',
  weapon_slot_1: 'WEAPON SLOT 1',
  weapon_slot_2: 'WEAPON SLOT 2',
  weapon_slot_3: 'WEAPON SLOT 3',
  next_weapon: 'NEXT WEAPON',
  prev_weapon: 'PREV WEAPON',
  drop_weapon: 'DROP WEAPON',
  give_coins: 'GIVE COINS',
  console: 'CONSOLE',
  chat: 'CHAT',
};

/** Defaults match the original's key bindings screen. */
const DEFAULT_BINDINGS: Record<ActionName, string> = {
  up: 'KeyW',
  down: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  sprint: 'ShiftLeft',
  fire: 'Space',
  fire_up: 'ArrowUp',
  fire_down: 'ArrowDown',
  fire_left: 'ArrowLeft',
  fire_right: 'ArrowRight',
  build: 'KeyR',
  use: 'KeyE',
  upgrade: 'KeyF',
  weapon_slot_1: 'Digit1',
  weapon_slot_2: 'Digit2',
  weapon_slot_3: 'Digit3',
  next_weapon: 'KeyZ',
  prev_weapon: 'KeyX',
  drop_weapon: 'KeyG',
  give_coins: 'KeyH',
  console: 'Backquote',
  chat: 'KeyT',
};

/**
 * Coins the host may hand each computer player when a match starts: none by default, a fixed sum, or
 * 'full', enough for its best gun and first buildings.
 */
export const AI_START_GOLD = [0, 500, 1000, 2500, 5000, 'full'] as const;

export type AIStartGold = (typeof AI_START_GOLD)[number];

export function isAIStartGold(value: unknown): value is AIStartGold {
  return AI_START_GOLD.some((choice) => choice === value);
}

export type Settings = {
  bindings: Record<ActionName, string>;
  sfxVolume: number;
  musicVolume: number;
  showFps: boolean;
  fullscreen: boolean;
  /** Last opponent picked on the difficulty screen; the computer by default. */
  opponent: 'none' | 'ai';
  aiDifficulty: string;
  /** Head start the computer players get; chosen by whoever hosts the match. */
  aiStartGold: AIStartGold;
  /** Name other players see above this character in multiplayer. */
  playerName: string;
};

export const NAME_MAX = 12;

/** Trims and strips anything but letters, digits, spaces and a few separators. */
export function cleanName(text: unknown): string {
  return typeof text === 'string'
    ? text.replace(/[^\p{L}\p{N} _.-]/gu, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX) : '';
}

const STORAGE_KEY = 'catacomb-snatch-settings';

function defaults(): Settings {
  return {
    bindings: { ...DEFAULT_BINDINGS },
    sfxVolume: 0.6,
    musicVolume: 0.35,
    showFps: false,
    fullscreen: false,
    opponent: 'ai',
    aiDifficulty: 'Normal',
    aiStartGold: 0,
    playerName: '',
  };
}

function isActionName(key: string): key is ActionName {
  return hasKey(DEFAULT_BINDINGS, key);
}

/** Saved key bindings: known actions bound to key codes, anything else ignored. */
function readBindings(value: unknown): Partial<Record<ActionName, string>> {
  const bindings: Partial<Record<ActionName, string>> = {};
  if (!isRecord(value)) return bindings;
  for (const [action, code] of Object.entries(value)) {
    if (isActionName(action) && typeof code === 'string') bindings[action] = code;
  }
  // Tab now shows the scoreboard; the console moved to the classic ~ key.
  if (bindings.console === 'Tab') bindings.console = 'Backquote';
  return bindings;
}

/** Takes what is valid from stored settings, keeping the default for anything missing or damaged. */
function parseSettings(value: unknown, base: Settings): Settings {
  if (!isRecord(value)) return base;
  const volume = (v: unknown, fallback: number) => (isFiniteNumber(v) ? MathUtils.clamp(v, 0, 1) : fallback);
  const flag = (v: unknown, fallback: boolean) => (typeof v === 'boolean' ? v : fallback);
  return {
    bindings: { ...base.bindings, ...readBindings(value.bindings) },
    sfxVolume: volume(value.sfxVolume, base.sfxVolume),
    musicVolume: volume(value.musicVolume, base.musicVolume),
    showFps: flag(value.showFps, base.showFps),
    fullscreen: flag(value.fullscreen, base.fullscreen),
    opponent: value.opponent === 'none' || value.opponent === 'ai' ? value.opponent : base.opponent,
    aiDifficulty: typeof value.aiDifficulty === 'string' ? value.aiDifficulty : base.aiDifficulty,
    aiStartGold: isAIStartGold(value.aiStartGold) ? value.aiStartGold : base.aiStartGold,
    playerName: cleanName(value.playerName),
  };
}

function load(): Settings {
  const base = defaults();
  // Corrupt or unavailable storage must not stop the game from starting.
  const stored = attempt(() => {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? parseSettings(JSON.parse(raw), base) : base;
  });
  if (stored.ok) return stored.value;
  log.warn('Stored settings unreadable; using defaults', { reason: stored.error.message });
  return base;
}

export const settings: Settings = load();

export function saveSettings(): void {
  // Private browsing and the like: preferences simply will not persist.
  const saved = attempt(() => localStorage.setItem(STORAGE_KEY, JSON.stringify(settings)));
  if (!saved.ok) log.warn('Settings could not be saved', { reason: saved.error.message });
}

export function resetBindings(): void {
  settings.bindings = { ...DEFAULT_BINDINGS };
  saveSettings();
}

export function bindingFor(action: ActionName): string {
  return settings.bindings[action];
}

/** Human-readable form of a KeyboardEvent.code, for menus and prompts. */
export function keyLabel(action: ActionName): string {
  return codeLabel(settings.bindings[action]);
}

export function codeLabel(code: string): string {
  if (!code) return '—';
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Arrow')) return code.slice(5).toUpperCase();
  switch (code) {
    case 'ShiftLeft': return 'L SHIFT';
    case 'ShiftRight': return 'R SHIFT';
    case 'ControlLeft': return 'L CTRL';
    case 'ControlRight': return 'R CTRL';
    case 'AltLeft': return 'L ALT';
    case 'AltRight': return 'R ALT';
    case 'Space': return 'SPACE';
    case 'Escape': return 'ESC';
    case 'Backquote': return '~';
    default: return code.toUpperCase();
  }
}
