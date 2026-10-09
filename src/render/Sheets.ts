import { Texture, Rectangle } from 'pixi.js';
import { getTexture } from '../assets/AssetLoader';

export type SheetInfo = {
  /** Frame size in pixels — matches the Java Art.cut() calls. */
  frameWidth: number;
  frameHeight: number;
};

const SHEETS: Record<string, SheetInfo> = {
  lord_lard_sheet:        { frameWidth: 32, frameHeight: 32 },
  countess_cruller_sheet: { frameWidth: 32, frameHeight: 32 },
  herr_von_speck_sheet:   { frameWidth: 32, frameHeight: 32 },
  duchess_donut_sheet:    { frameWidth: 32, frameHeight: 32 },

  enemy_mummy_anim_48:  { frameWidth: 48, frameHeight: 48 },
  enemy_pharao_anim_48: { frameWidth: 48, frameHeight: 48 },
  enemy_snake_anim_48:  { frameWidth: 48, frameHeight: 48 },
  enemy_scarab_anim_48: { frameWidth: 48, frameHeight: 48 },
  enemy_bat_32:         { frameWidth: 32, frameHeight: 32 },

  pickup_coin_gold_16:   { frameWidth: 16, frameHeight: 16 },
  pickup_coin_silver_16: { frameWidth: 16, frameHeight: 16 },
  pickup_coin_bronze_16: { frameWidth: 16, frameHeight: 16 },

  turret:      { frameWidth: 32, frameHeight: 32 },
  harvester:   { frameWidth: 32, frameHeight: 56 },
  treasure:    { frameWidth: 32, frameHeight: 56 },
  chest_small: { frameWidth: 32, frameHeight: 53 },
  spawner:     { frameWidth: 32, frameHeight: 40 },
  bomb:        { frameWidth: 32, frameHeight: 32 },
  muzzle:      { frameWidth: 16, frameHeight: 16 },
  rails:       { frameWidth: 32, frameHeight: 38 },
  bullet:      { frameWidth: 16, frameHeight: 16 },
  weapon_list: { frameWidth: 32, frameHeight: 32 },

  // Player base pieces: 2 columns x 3 rows per character.
  start_lordlard_left:        { frameWidth: 32, frameHeight: 32 },
  start_lordlard_right:       { frameWidth: 32, frameHeight: 32 },
  start_herrspeck_left:       { frameWidth: 32, frameHeight: 32 },
  start_herrspeck_right:      { frameWidth: 32, frameHeight: 32 },
  start_donut_left:           { frameWidth: 32, frameHeight: 32 },
  start_donut_right:          { frameWidth: 32, frameHeight: 32 },
  start_cruller_left:         { frameWidth: 32, frameHeight: 32 },
  start_cruller_right:        { frameWidth: 32, frameHeight: 32 },
  start_no_opponent_left:     { frameWidth: 32, frameHeight: 32 },
  start_no_opponent_right:    { frameWidth: 32, frameHeight: 32 },
};

const cache = new Map<string, Texture>();

export function sheetInfo(key: string): SheetInfo {
  return SHEETS[key] ?? { frameWidth: 32, frameHeight: 32 };
}

/** Columns available in a sheet, used to wrap animation frames. */
export function sheetCols(key: string): number {
  const base = getTexture(key);
  const { frameWidth } = sheetInfo(key);
  return Math.max(1, Math.floor(base.width / frameWidth));
}

export function sheetRows(key: string): number {
  const base = getTexture(key);
  const { frameHeight } = sheetInfo(key);
  return Math.max(1, Math.floor(base.height / frameHeight));
}

/** Returns a cached sub-texture for one cell of a sheet, clamped to the sheet bounds. */
export function frameTexture(key: string, col: number, row: number): Texture {
  const id = `${key}:${col}:${row}`;
  const hit = cache.get(id);
  if (hit) return hit;

  const base = getTexture(key);
  if (!base.source || base.width === 0) return Texture.EMPTY;

  const { frameWidth, frameHeight } = sheetInfo(key);
  const maxCol = Math.max(0, Math.floor(base.width / frameWidth) - 1);
  const maxRow = Math.max(0, Math.floor(base.height / frameHeight) - 1);
  const c = Math.min(Math.max(col, 0), maxCol);
  const r = Math.min(Math.max(row, 0), maxRow);

  const tex = new Texture({
    source: base.source,
    frame: new Rectangle(c * frameWidth, r * frameHeight, frameWidth, frameHeight),
  });
  cache.set(id, tex);
  return tex;
}
