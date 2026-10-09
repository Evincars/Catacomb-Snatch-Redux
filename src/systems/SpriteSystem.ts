import { Sprite } from 'pixi.js';
import type { Container } from 'pixi.js';
import { q, world } from '../world';
import { frameTexture } from '../render/Sheets';

/**
 * Gives every entity that declares a `visual` an actual Pixi sprite in the
 * game layer, so entities created mid-game (bullets, loot, spawned mobs)
 * become visible without the spawning code touching the display list.
 */
export function updateSprites(gameLayer: Container): void {
  for (const entity of q.needsSprite) {
    const v = entity.visual!;
    const sprite = new Sprite(frameTexture(v.sheet, v.col ?? 0, v.row ?? 0));
    sprite.anchor.set(0.5, 0.5);
    gameLayer.addChild(sprite);
    world.addComponent(entity, 'sprite', sprite);
  }
}

/** Detaches and destroys all sprites, for tearing a level down. */
export function clearSprites(): void {
  for (const entity of world.with('sprite')) {
    entity.sprite!.destroy();
    world.removeComponent(entity, 'sprite');
  }
}
