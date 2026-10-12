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
  raildroid:            { frameWidth: 32, frameHeight: 32 },

  pickup_coin_gold_16:   { frameWidth: 16, frameHeight: 16 },
  pickup_coin_silver_16: { frameWidth: 16, frameHeight: 16 },
  pickup_coin_bronze_16: { frameWidth: 16, frameHeight: 16 },

  turret:      { frameWidth: 32, frameHeight: 32 },
  turret2:     { frameWidth: 32, frameHeight: 32 },
  turret3:     { frameWidth: 32, frameHeight: 32 },
  harvester:   { frameWidth: 32, frameHeight: 56 },
  harvester2:  { frameWidth: 32, frameHeight: 56 },
  harvester3:  { frameWidth: 32, frameHeight: 56 },
  pickup_gem_emerald_12: { frameWidth: 16, frameHeight: 16 },
  pickup_gem_ruby_12:    { frameWidth: 16, frameHeight: 16 },
  pickup_gem_diamond_24: { frameWidth: 24, frameHeight: 24 },
  exclamation_mark:      { frameWidth: 4, frameHeight: 13 },
  effect_shine_small:    { frameWidth: 13, frameHeight: 13 },
  fx_steam2_12:          { frameWidth: 12, frameHeight: 12 },
  pickup_coin_gold_small_8:   { frameWidth: 8, frameHeight: 8 },
  pickup_coin_silver_small_8: { frameWidth: 8, frameHeight: 8 },
  pickup_coin_bronze_small_8: { frameWidth: 8, frameHeight: 8 },
  font_default: { frameWidth: 8, frameHeight: 8 },
  button:       { frameWidth: 128, frameHeight: 24 },
  walltiles:    { frameWidth: 32, frameHeight: 56 },
  treasure:    { frameWidth: 32, frameHeight: 56 },
  chest_small: { frameWidth: 32, frameHeight: 53 },
  spawner:     { frameWidth: 32, frameHeight: 40 },
  bomb:        { frameWidth: 32, frameHeight: 32 },
  muzzle:      { frameWidth: 16, frameHeight: 16 },
  rails:       { frameWidth: 32, frameHeight: 38 },
  bullet:      { frameWidth: 16, frameHeight: 16 },
  bullet_buckshot: { frameWidth: 16, frameHeight: 16 },
  bullet_poison: { frameWidth: 16, frameHeight: 16 },
  plasmaball:  { frameWidth: 16, frameHeight: 16 },

  // Health / sprint bars: 21 fill steps of 32x4.
  bar_green:           { frameWidth: 32, frameHeight: 4 },
  bar_green_underlay:  { frameWidth: 32, frameHeight: 4 },
  bar_outline:         { frameWidth: 32, frameHeight: 4 },
  sprint_bar:          { frameWidth: 32, frameHeight: 4 },

  fx_enemydie_64:           { frameWidth: 64, frameHeight: 64 },
  fx_enemydie_tiny_32:      { frameWidth: 32, frameHeight: 32 },
  fx_bombsplosion_big_32:   { frameWidth: 32, frameHeight: 32 },
  fx_bombsplosion_small_32: { frameWidth: 32, frameHeight: 32 },
  fx_dust1_24:              { frameWidth: 24, frameHeight: 24 },
  fx_dust2_12:              { frameWidth: 12, frameHeight: 12 },
  weapon_list: { frameWidth: 32, frameHeight: 32 },
  dark:        { frameWidth: 32, frameHeight: 32 },
  // 101-frame depletion strips, one row per percentage step.
  panel_healthbar: { frameWidth: 100, frameHeight: 6 },
  panel_xpbar:     { frameWidth: 100, frameHeight: 6 },

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

  // Spawn platform art: 4 cols × 3 rows (art[img%4][img/4] in Java).
  start_lordlard:    { frameWidth: 32, frameHeight: 32 },
  start_herrspeck:   { frameWidth: 32, frameHeight: 32 },
  start_donut:       { frameWidth: 32, frameHeight: 32 },
  start_cruller:     { frameWidth: 32, frameHeight: 32 },
  start_no_opponent: { frameWidth: 32, frameHeight: 32 },
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

const whiteSheets = new Map<string, Texture>();
const whiteFrames = new Map<string, Texture>();

/** Flat-white copy of a sheet with identical alpha, so a tint paints the shape one solid colour (Java's colorBlit). */
function whiteSheet(key: string): Texture | null {
  const hit = whiteSheets.get(key);
  if (hit) return hit;

  const base = getTexture(key);
  const resource = base.source?.resource as CanvasImageSource | undefined;
  if (!resource || base.width === 0) return null;

  const canvas = document.createElement('canvas');
  canvas.width = base.source.pixelWidth;
  canvas.height = base.source.pixelHeight;
  const ctx = canvas.getContext('2d')!;
  ctx.drawImage(resource, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  const tex = Texture.from(canvas);
  whiteSheets.set(key, tex);
  return tex;
}

/** White silhouette of the region of `key` covered by `frame`. */
export function whiteFrame(key: string, frame: Rectangle): Texture {
  const id = `${key}:${frame.x}:${frame.y}:${frame.width}:${frame.height}`;
  const hit = whiteFrames.get(id);
  if (hit) return hit;

  const sheet = whiteSheet(key);
  if (!sheet) return Texture.EMPTY;

  const tex = new Texture({
    source: sheet.source,
    frame: new Rectangle(frame.x, frame.y, frame.width, frame.height),
  });
  whiteFrames.set(id, tex);
  return tex;
}

export function whiteFrameTexture(key: string, col: number, row: number): Texture {
  const base = frameTexture(key, col, row);
  return base === Texture.EMPTY ? Texture.EMPTY : whiteFrame(key, base.frame);
}
