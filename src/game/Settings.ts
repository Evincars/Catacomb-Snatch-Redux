/** Persisted player preferences and key bindings. */

export type ActionName =
  | 'up' | 'down' | 'left' | 'right' | 'sprint'
  | 'fire' | 'build' | 'use' | 'upgrade';

export const ACTION_LABELS: Record<ActionName, string> = {
  up: 'UP',
  down: 'DOWN',
  left: 'LEFT',
  right: 'RIGHT',
  sprint: 'SPRINT',
  fire: 'FIRE',
  build: 'BUILD',
  use: 'USE',
  upgrade: 'UPGRADE',
};

/** Defaults match the original's key bindings screen. */
const DEFAULT_BINDINGS: Record<ActionName, string> = {
  up: 'KeyW',
  down: 'KeyS',
  left: 'KeyA',
  right: 'KeyD',
  sprint: 'ShiftLeft',
  fire: 'Space',
  build: 'KeyR',
  use: 'KeyE',
  upgrade: 'KeyF',
};

export type Settings = {
  bindings: Record<ActionName, string>;
  sfxVolume: number;
  musicVolume: number;
  showFps: boolean;
  fullscreen: boolean;
};

const STORAGE_KEY = 'catacomb-snatch-settings';

function load(): Settings {
  const base: Settings = {
    bindings: { ...DEFAULT_BINDINGS },
    sfxVolume: 0.6,
    musicVolume: 0.35,
    showFps: false,
    fullscreen: false,
  };

  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return base;
    const saved = JSON.parse(raw) as Partial<Settings>;
    return {
      ...base,
      ...saved,
      bindings: { ...base.bindings, ...(saved.bindings ?? {}) },
    };
  } catch {
    // Corrupt or unavailable storage must not stop the game from starting.
    return base;
  }
}

export const settings: Settings = load();

export function saveSettings(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Private browsing and the like; preferences simply will not persist.
  }
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
    default: return code.toUpperCase();
  }
}
