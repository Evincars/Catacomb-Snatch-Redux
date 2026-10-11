import { Sprite } from 'pixi.js';
import type { Container } from 'pixi.js';
import { q, world } from '../world';
import { frameTexture } from '../render/Sheets';
import { PixelLabel } from '../ui/PixelText';
import { destroyAttachments } from './BarSystem';

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

    // Stalls show their price just beneath, as in Java's ShopItem.render.
    if (entity.shopItem) {
      const price = new PixelLabel(String(entity.shopItem.cost), { align: 'center', outline: true });
      price.x = Math.round(entity.position!.x);
      price.y = Math.round(entity.position!.y) + 10;
      price.zIndex = entity.position!.y + 0.5;
      gameLayer.addChild(price);
      world.addComponent(entity, 'priceLabel', price);
    }
  }

  // Directional art (turrets, bullets) changes cell without being animated.
  for (const entity of world.with('visual', 'sprite', 'facing8')) {
    if (entity.animation) continue;
    const v = entity.visual!;
    if (v.col === entity.facing8) continue;
    v.col = entity.facing8;
    entity.sprite!.texture = frameTexture(v.sheet, v.col, v.row ?? 0);
  }

  // Nests crack open through four frames as they lose health.
  for (const nest of world.with('spawner', 'visual', 'sprite', 'health')) {
    const v = nest.visual!;
    const { current, max } = nest.health!;
    const col = Math.min(3, Math.max(0, Math.trunc(3 - (3 * current) / max)));
    if (v.col === col) continue;
    v.col = col;
    nest.sprite!.texture = frameTexture(v.sheet, col, v.row ?? 0);
  }
}

/** Detaches and destroys all sprites, for tearing a level down. */
export function clearSprites(): void {
  for (const entity of world.with('sprite')) {
    destroyAttachments(entity);
    entity.sprite!.destroy({ children: true });
    world.removeComponent(entity, 'sprite');
  }
}
