import { validateWorld } from './WorldState';
import type { WorldState } from './WorldState';
import { PLAYER_SLOTS } from '../world';
import { attempt, ensure } from '../core/errors';
import type { Result } from '../core/errors';
import { isRecord } from '../core/guards';

export type SavedGame = { id: string; name: string; updatedAt: string; coop: boolean; state: WorldState };
const KEY = 'catacomb-redux-saves-v1';
const NAME_MAX = 40;

function validateMode(state: WorldState, coop: boolean): void {
  const players = state.entities.filter(entry => entry.data.playerSlot);
  const slots = players.map(entry => entry.data.playerSlot);
  // Guests take the slots after the host in order, so a save never skips one.
  const contiguous = PLAYER_SLOTS.slice(0, players.length).every(slot => slots.includes(slot));
  ensure(contiguous && (coop ? players.length >= 2 : players.length === 1), 'Save player count does not match its game mode');
}

function validateSave(save: unknown): asserts save is SavedGame {
  ensure(isRecord(save) && typeof save.id === 'string' && typeof save.name === 'string'
    && typeof save.updatedAt === 'string' && typeof save.coop === 'boolean', 'Invalid save entry');
  validateWorld(save.state);
  validateMode(save.state, save.coop);
}

/** Every saved game in this browser; throws a ValidationError if the list is damaged. */
export function readSaves(): SavedGame[] {
  const raw = localStorage.getItem(KEY);
  if (!raw) return [];
  const value: unknown = JSON.parse(raw);
  ensure(Array.isArray(value), 'Saved-game list is damaged');
  for (const save of value) validateSave(save);
  return value;
}

/** readSaves as a Result, for screens that show the problem instead of failing. */
export function loadSaves(): Result<SavedGame[]> {
  return attempt(readSaves, 'invalid-data');
}

export function writeSave(name: string, state: WorldState, coop: boolean, id: string = crypto.randomUUID()): SavedGame {
  validateWorld(state);
  validateMode(state, coop);
  const saves = readSaves();
  const save = { id, name: name.trim().slice(0, NAME_MAX) || 'Catacomb save', updatedAt: new Date().toISOString(), coop, state };
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
