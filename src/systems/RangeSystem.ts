import { Graphics } from 'pixi.js';
import type { Container } from 'pixi.js';
import { world } from '../world';
import type { Entity } from '../world';
import { TILE_HEIGHT } from '../level/TileType';

/** Ticks a range circle stays after focus is lost, the last FADE of which fade it out. */
const LINGER = 180;
const FADE = 40;
/** A held building shows its range more softly than one being inspected. */
const CARRIED_ALPHA = 0.6;
/** Above the floor, below every actor. */
const RANGE_Z = -1_000_000;

function rangeOf(entity: Entity): number {
  return entity.turret?.radius ?? entity.harvester?.radius ?? 0;
}

function draw(gfx: Graphics, radius: number): void {
  gfx.clear();
  gfx.circle(0, 0, radius).fill({ color: 0xffffff, alpha: 0.1 });
}

/**
 * Shows the reach of turrets and harvesters while one is carried or focused, and
 * for a few seconds afterwards. The circle follows the current upgrade's radius.
 */
export function updateRanges(gameLayer: Container): void {
  for (const entity of world.with('position', 'rangeTicks')) {
    if (entity.removed) continue;

    const carrier = entity.carriedBy !== undefined ? world.entity(entity.carriedBy) : undefined;
    const carried = carrier !== undefined && !carrier.aiPlayer;
    if (carried || entity.targeted) entity.rangeTicks = LINGER;
    else if (entity.rangeTicks! > 0) entity.rangeTicks!--;

    const ticks = entity.rangeTicks!;
    const view = entity.rangeView;
    if (ticks <= 0) {
      if (view) view.gfx.visible = false;
      continue;
    }

    const radius = rangeOf(entity);
    let gfx = view?.gfx;
    if (!view || !gfx) {
      gfx = new Graphics();
      gfx.zIndex = RANGE_Z;
      gameLayer.addChild(gfx);
      world.addComponent(entity, 'rangeView', { gfx, radius: -1 });
    }
    const current = entity.rangeView!;
    if (current.radius !== radius) {
      draw(gfx, radius);
      current.radius = radius;
    }

    gfx.x = Math.round(entity.position!.x);
    gfx.y = Math.round(entity.position!.y - (entity.harvester ? (entity.yOffset ?? 0) - TILE_HEIGHT / 2 : 0));
    gfx.alpha = Math.min(1, ticks / FADE) * (carried ? CARRIED_ALPHA : 1);
    gfx.visible = true;
  }
}
