import { Sprite } from 'pixi.js';
import { world } from '../world';
import type { Entity } from '../world';
import { whiteFrame } from '../render/Sheets';

type Overlay = { color: number; alpha: number };

/**
 * Flat colour laid over an entity while it is hurt or flashing. Java blends the
 * sprite toward the colour (colorBlit); here a white copy of the sprite is
 * tinted and alpha-faded on top, which gives the same result.
 */
function overlayFor(entity: Entity): Overlay | null {
  const t = entity.hurtTime ?? 0;

  if (t > 0) {
    // Players blink red on alternate ticks.
    if (entity.playerInput) return t % 2 !== 0 ? { color: 0xff0000, alpha: 0.5 } : null;

    // Mobs flash white on impact, then settle into a red that deepens as health drops.
    if (t > 34 && Math.floor(t / 2) % 2 === 0) return { color: 0xffffff, alpha: 160 / 256 };

    const h = entity.health;
    const hp = Math.max(0, h?.current ?? 0);
    let strength = Math.trunc(180 - (hp * 180) / (h?.max || 1));
    if (t < 10) strength = Math.trunc((strength * t) / 10);
    return strength > 0 ? { color: 0xff0000, alpha: strength / 256 } : null;
  }

  if ((entity.flashTime ?? 0) > 0) return { color: 0xffff80, alpha: 0.5 };
  return null;
}

function syncOverlay(entity: Entity, sprite: Sprite): void {
  const overlay = overlayFor(entity);
  if (!overlay) {
    if (entity.hurtOverlay) entity.hurtOverlay.visible = false;
    return;
  }

  const sheet = entity.animation?.sheet ?? entity.visual?.sheet;
  if (!sheet) return;

  let layer = entity.hurtOverlay;
  if (!layer) {
    layer = new Sprite();
    layer.anchor.set(0.5, 0.5);
    sprite.parent?.addChild(layer);
    world.addComponent(entity, 'hurtOverlay', layer);
  }

  layer.x = sprite.x;
  layer.y = sprite.y;
  layer.zIndex = sprite.zIndex + 0.01;
  layer.texture = whiteFrame(sheet, sprite.texture.frame);
  layer.tint = overlay.color;
  layer.alpha = overlay.alpha;
  layer.visible = true;
}

/** Sync Pixi sprite transforms and hit flashes from ECS state. */
export function updateRender(_dt: number): void {
  for (const entity of world.with('position', 'sprite')) {
    const pos = entity.position!;
    const sprite = entity.sprite!;
    const yOff = entity.yOffset ?? 0;

    sprite.x = Math.round(pos.x);
    sprite.y = Math.round(pos.y - yOff);

    // Entities overlap back-to-front by feet position.
    let order = pos.y;
    const fx = entity.fx;
    if (fx?.orderId !== undefined) {
      order = world.entity(fx.orderId)?.position?.y ?? pos.y;
      order += fx.orderBias ?? 0;
    }
    sprite.zIndex = order;

    // A falling player shrinks and sinks away into the hole.
    if (entity.falling) {
      const t = Math.min(1, entity.falling.age / entity.falling.duration);
      sprite.scale.set(1 - 0.7 * t);
      sprite.alpha = 1 - 0.6 * t;
      sprite.y += Math.round(10 * t);
    } else if (sprite.scale.x !== (entity.visual?.scale ?? 1) && entity.playerInput) {
      sprite.scale.set(1);
      sprite.alpha = 1;
    }

    syncOverlay(entity, sprite);
  }
}
