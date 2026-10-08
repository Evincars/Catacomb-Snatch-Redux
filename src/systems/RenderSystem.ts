import type { Application, Container } from 'pixi.js';
import { world } from '../world';
import type { Level } from '../level/Level';
import { TILE_WIDTH, TILE_HEIGHT, TileType } from '../level/TileType';

/** Sync Pixi sprite positions from ECS world positions. */
export function updateRender(_dt: number): void {
  for (const entity of world.with('position', 'sprite')) {
    const pos = entity.position!;
    const sprite = entity.sprite!;
    const yOff = entity.yOffset ?? 0;

    sprite.x = pos.x;
    sprite.y = pos.y - yOff;

    // Hurt flash tint
    if ((entity.hurtTime ?? 0) > 0) {
      const t = entity.hurtTime!;
      sprite.tint = t > 34 && Math.floor(t / 2) % 2 === 0 ? 0xaaffffff : 0xff0000ff;
    } else if ((entity.flashTime ?? 0) > 0) {
      sprite.tint = 0x80ffff80;
    } else {
      sprite.tint = 0xffffffff;
    }
  }
}

/** Sort sprites by Y position for depth ordering. */
export function sortByDepth(gameLayer: Container): void {
  gameLayer.children.sort((a, b) => a.y - b.y);
}
