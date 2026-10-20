import { Graphics, Sprite } from 'pixi.js';
import { world } from '../world';
import type { Entity } from '../world';
import { whiteFrame } from '../render/Sheets';
import { TileType, TILE_WIDTH, TILE_HEIGHT } from '../level/TileType';
import type { Level } from '../level/Level';

type Overlay = { color: number; alpha: number };

/** Overlays are read the moment they are chosen, so fixed ones are shared and the one that varies is reused. */
const PLAYER_HURT: Overlay = { color: 0xff0000, alpha: 0.5 };
const IMPACT: Overlay = { color: 0xffffff, alpha: 160 / 256 };
const FUSE: Overlay = { color: 0xff0000, alpha: 0.7 };
const PLAYER_FLASH: Overlay = { color: 0xffff80, alpha: 0.18 };
const FLASH: Overlay = { color: 0xffff80, alpha: 0.5 };
const wound: Overlay = { color: 0xff0000, alpha: 0 };

/** Pixels a falling player sinks by the end of the fall. */
const FALL_DEPTH = 48;

const drawn = world.with('position', 'sprite');

/** Mobs flash white on impact, then settle into a red that deepens as health drops. */
function hurtOverlay(entity: Entity, t: number): Overlay | null {
  // Players blink red on alternate ticks.
  if (entity.playerInput) return t % 2 !== 0 ? PLAYER_HURT : null;
  if (t > 34 && Math.floor(t / 2) % 2 === 0) return IMPACT;
  const h = entity.health;
  const hp = Math.max(0, h?.current ?? 0);
  const full = Math.trunc(180 - (hp * 180) / (h?.max || 1));
  const strength = t < 10 ? Math.trunc((full * t) / 10) : full;
  if (strength <= 0) return null;
  wound.alpha = strength / 256;
  return wound;
}

/**
 * Flat colour laid over an entity while it is hurt or flashing. Java blends the
 * sprite toward the colour (colorBlit); here a white copy of the sprite is
 * tinted and alpha-faded on top, which gives the same result.
 */
function overlayFor(entity: Entity): Overlay | null {
  const t = entity.hurtTime ?? 0;
  if (t > 0) return hurtOverlay(entity, t);
  // A lit bomb blinks red, faster as its fuse runs short.
  if (entity.bomb?.lit) {
    const { fuse, fuseMax } = entity.bomb;
    const interval = fuse > fuseMax / 3 ? 6 : 3;
    return Math.floor(fuse / interval) % 2 === 0 ? FUSE : null;
  }
  if ((entity.flashTime ?? 0) > 0) return entity.playerInput ? PLAYER_FLASH : FLASH;
  return null;
}

function overlayLayer(entity: Entity, sprite: Sprite): Sprite {
  if (entity.hurtOverlay) return entity.hurtOverlay;
  const layer = new Sprite();
  layer.anchor.set(0.5, 0.5);
  sprite.parent?.addChild(layer);
  world.addComponent(entity, 'hurtOverlay', layer);
  return layer;
}

function syncOverlay(entity: Entity, sprite: Sprite): void {
  const overlay = sprite.visible ? overlayFor(entity) : null;
  if (!overlay) {
    if (entity.hurtOverlay) entity.hurtOverlay.visible = false;
    return;
  }
  const sheet = entity.animation?.sheet ?? entity.visual?.sheet;
  if (!sheet) return;
  const layer = overlayLayer(entity, sprite);
  layer.x = sprite.x;
  layer.y = sprite.y;
  layer.zIndex = sprite.zIndex + 0.01;
  layer.texture = whiteFrame(sheet, sprite.texture.frame);
  layer.tint = overlay.color;
  layer.alpha = overlay.alpha;
  layer.visible = true;
  layer.mask = entity.fallMask ?? null;
}

/**
 * Entities overlap back-to-front by feet position. Something held overhead is drawn with its carrier, in
 * front of them, so a wall the carrier stands below cannot cover it; an effect may follow another entity.
 */
function drawOrder(entity: Entity): number {
  const pos = entity.position!;
  const fx = entity.fx;
  if (fx?.orderId !== undefined) return (world.entity(fx.orderId)?.position?.y ?? pos.y) + (fx.orderBias ?? 0);
  if (entity.carriedBy !== undefined) return (world.entity(entity.carriedBy)?.position?.y ?? pos.y) + 0.2;
  return entity.spikeTrap ? pos.y - TILE_HEIGHT / 2 : pos.y;
}

/** The entity whose fall this sprite follows: its own, or that of the player an exclamation mark hangs over. */
function fallOf(entity: Entity): Entity | undefined {
  if (entity.falling) return entity;
  const owner = entity.fx?.orderId !== undefined ? world.entity(entity.fx.orderId) : undefined;
  return owner?.falling && entity.visual?.sheet === 'exclamation_mark' ? owner : undefined;
}

/** Sinks a falling sprite; returns the y below which the foreground floor hides it, if it does. */
function sink(level: Level, entity: Entity, sprite: Sprite): number | undefined {
  const falling = fallOf(entity);
  if (!falling?.falling) return undefined;
  const t = Math.min(1, falling.falling.age / falling.falling.duration);
  sprite.y += Math.round(FALL_DEPTH * t);
  const tx = Math.floor(falling.position!.x / TILE_WIDTH);
  const ty = Math.floor(falling.position!.y / TILE_HEIGHT);
  // The foreground floor occludes the fall; adjacent holes do not.
  return level.getTile(tx, ty + 1)?.type !== TileType.Hole ? (ty + 1) * TILE_HEIGHT : undefined;
}

function clipFall(level: Level, entity: Entity, sprite: Sprite, clipBottom: number | undefined): void {
  if (clipBottom === undefined) {
    if (!entity.fallMask) return;
    sprite.mask = null;
    if (entity.hurtOverlay) entity.hurtOverlay.mask = null;
    entity.fallMask.destroy();
    world.removeComponent(entity, 'fallMask');
    return;
  }
  let mask = entity.fallMask;
  if (!mask) {
    mask = new Graphics();
    sprite.parent!.addChild(mask);
    world.addComponent(entity, 'fallMask', mask);
  }
  mask.clear().rect(0, 0, level.width * TILE_WIDTH, clipBottom).fill(0xffffff);
  sprite.mask = mask;
}

/** Players, and whatever they carry, are hidden while they wait to respawn. */
function hideWhileRespawning(entity: Entity, sprite: Sprite): void {
  const carrier = entity.carriedBy === undefined ? undefined : world.entity(entity.carriedBy);
  if (entity.playerInput || carrier?.playerInput) sprite.visible = entity.respawnTicks === undefined && carrier?.respawnTicks === undefined;
}

/** Sync Pixi sprite transforms and hit flashes from ECS state. */
export function updateRender(_dt: number, level: Level): void {
  for (const entity of drawn) {
    const pos = entity.position!;
    const sprite = entity.sprite!;
    hideWhileRespawning(entity, sprite);
    sprite.tint = 0xffffff;
    sprite.x = Math.round(pos.x);
    sprite.y = Math.round(pos.y - (entity.yOffset ?? 0));
    sprite.zIndex = drawOrder(entity);
    clipFall(level, entity, sprite, sink(level, entity, sprite));
    syncOverlay(entity, sprite);
  }
}
