import { AnimatedSprite, Sprite } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { frameTexture, sheetCols } from './Sheets';

const sequences = new Map<string, Texture[]>();
const selected = new WeakMap<AnimatedSprite, Texture[]>();

export function animationFrames(sheet: string, row = 0): Texture[] {
  const key = `${sheet}:${row}`;
  let frames = sequences.get(key);
  if (!frames) {
    frames = Array.from({ length: sheetCols(sheet) }, (_, col) => frameTexture(sheet, col, row));
    sequences.set(key, frames);
  }
  return frames;
}

/** ECS ticks own the clock, rather than Pixi's shared ticker, for saves and co-op. */
export function createAnimatedVisual(sheet: string, col = 0, row = 0): AnimatedSprite {
  const sprite = new AnimatedSprite({ textures: animationFrames(sheet, row), autoUpdate: false });
  setVisualFrame(sprite, sheet, col, row);
  return sprite;
}

export function setVisualFrame(sprite: Sprite, sheet: string, col: number, row = 0): void {
  if (sprite instanceof AnimatedSprite) {
    const frames = animationFrames(sheet, row);
    if (selected.get(sprite) !== frames) {
      sprite.textures = frames;
      selected.set(sprite, frames);
    }
    sprite.gotoAndStop(Math.min(frames.length - 1, Math.max(0, col)));
  } else {
    sprite.texture = frameTexture(sheet, col, row);
  }
}
