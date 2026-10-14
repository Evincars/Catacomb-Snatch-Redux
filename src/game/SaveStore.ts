import { validateWorld } from './WorldState';
import type { WorldState } from './WorldState';

export type SavedGame = { id: string; name: string; updatedAt: string; coop: boolean; state: WorldState };
const KEY = 'catacomb-redux-saves-v1';

function validateMode(state: WorldState, coop: boolean): void {
  const players = state.entities.filter(entry => entry.data.playerSlot);
  if (players.length !== (coop ? 2 : 1)
    || coop && !players.some(entry => entry.data.playerSlot === 'guest')) {
    throw new Error('Save player count does not match its game mode');
  }
}

export function readSaves(): SavedGame[] {
  const raw = localStorage.getItem(KEY);
  if (!raw) return [];
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value)) throw new Error('Saved-game list is damaged');
  for (const save of value) {
    if (!save || typeof save.id !== 'string' || typeof save.name !== 'string'
      || typeof save.updatedAt !== 'string' || typeof save.coop !== 'boolean') throw new Error('Invalid save entry');
    validateWorld(save.state);
    validateMode(save.state, save.coop);
  }
  return value;
}

export function writeSave(name: string, state: WorldState, coop: boolean, id: string = crypto.randomUUID()): SavedGame {
  validateWorld(state);
  validateMode(state, coop);
  const saves = readSaves();
  const save = { id, name: name.trim().slice(0, 40) || 'Catacomb save', updatedAt: new Date().toISOString(), coop, state };
  const index = saves.findIndex(s => s.id === id);
  if (index < 0) saves.push(save);
  else saves[index] = save;
  localStorage.setItem(KEY, JSON.stringify(saves));
  return save;
}

export function deleteSave(id: string): void {
  localStorage.setItem(KEY, JSON.stringify(readSaves().filter(s => s.id !== id)));
}

export const savedRun: { pending: SavedGame | null } = { pending: null };
export const saveMenu: { state: WorldState | null } = { state: null };
