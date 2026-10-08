import { world } from '../world';
import type { Spritesheet, Texture } from 'pixi.js';

const sheets = new Map<string, Spritesheet>();

export function registerSheet(name: string, sheet: Spritesheet): void {
  sheets.set(name, sheet);
}

export function updateAnimation(_dt: number): void {
  for (const entity of world.with('animation', 'sprite')) {
    const anim = entity.animation!;
    const sprite = entity.sprite!;

    anim.timer++;
    if (anim.timer >= anim.frameTime) {
      anim.timer = 0;
      anim.frameX++;
      if (anim.frameX >= anim.frameCount) {
        anim.frameX = anim.loop ? 0 : anim.frameCount - 1;
      }
    }

    const sheet = sheets.get(anim.sheet);
    if (!sheet) continue;

    const textures = Object.values(sheet.textures) as Texture[];
    const idx = anim.frameY * anim.frameCount + anim.frameX;
    if (textures[idx]) sprite.texture = textures[idx];
  }
}
