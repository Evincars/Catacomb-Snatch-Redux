import { Graphics, Sprite } from 'pixi.js';
import { world } from '../world';
import type { Entity } from '../world';
import { whiteFrame } from '../render/Sheets';
import { TileType, TILE_WIDTH, TILE_HEIGHT } from '../level/TileType';
import type { Level } from '../level/Level';

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

  // A lit bomb blinks red, faster as its fuse runs short.
  if (entity.bomb?.lit) {
    const { fuse, fuseMax } = entity.bomb;
    const interval = fuse > fuseMax / 3 ? 6 : 3;
    return Math.floor(fuse / interval) % 2 === 0 ? { color: 0xff0000, alpha: 0.7 } : null;
  }

  if ((entity.flashTime ?? 0) > 0) return { color: 0xffff80, alpha: entity.playerInput ? 0.18 : 0.5 };
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
  layer.mask = entity.fallMask ?? null;
}

/** Sync Pixi sprite transforms and hit flashes from ECS state. */
export function updateRender(_dt: number, level: Level): void {
  for (const entity of world.with('position', 'sprite')) {
    const pos = entity.position!;
    const sprite = entity.sprite!;
    sprite.tint = entity.playerSlot === 'guest' ? 0x80dfff : 0xffffff;
    const yOff = entity.yOffset ?? 0;

    sprite.x = Math.round(pos.x);
    sprite.y = Math.round(pos.y - yOff);

    // Entities overlap back-to-front by feet position.
    let order = pos.y;
    if (entity.spikeTrap) order -= TILE_HEIGHT / 2;
    // Something held overhead is drawn with its carrier, in front of them, so a wall
    // the carrier stands below cannot cover it.
    if (entity.carriedBy !== undefined) {
      order = (world.entity(entity.carriedBy)?.position?.y ?? pos.y) + 0.2;
    }
    const fx = entity.fx;
    if (fx?.orderId !== undefined) {
      order = world.entity(fx.orderId)?.position?.y ?? pos.y;
      order += fx.orderBias ?? 0;
    }
    sprite.zIndex = order;

    const owner = fx?.orderId !== undefined ? world.entity(fx.orderId) : undefined;
    const falling = entity.falling ? entity : owner?.falling && entity.visual?.sheet === 'exclamation_mark' ? owner : undefined;
    let clipBottom: number | undefined;
    if (falling?.falling) {
      const t = Math.min(1, falling.falling.age / falling.falling.duration);
      sprite.y += Math.round(48 * t);
      const fp = falling.position!;
      const tx = Math.floor(fp.x / TILE_WIDTH);
      const ty = Math.floor(fp.y / TILE_HEIGHT);
      // The foreground floor occludes the fall; adjacent holes do not.
      if (level.getTile(tx, ty + 1)?.type !== TileType.Hole) {
        clipBottom = (ty + 1) * TILE_HEIGHT;
      }
    }
    if (clipBottom !== undefined) {
      let mask = entity.fallMask;
      if (!mask) {
        mask = new Graphics();
        sprite.parent!.addChild(mask);
        world.addComponent(entity, 'fallMask', mask);
      }
      mask.clear().rect(0, 0, level.width * TILE_WIDTH, clipBottom).fill(0xffffff);
      sprite.mask = mask;
    } else if (entity.fallMask) {
      sprite.mask = null;
      if (entity.hurtOverlay) entity.hurtOverlay.mask = null;
      entity.fallMask.destroy();
      world.removeComponent(entity, 'fallMask');
    }

    syncOverlay(entity, sprite);
  }
}
