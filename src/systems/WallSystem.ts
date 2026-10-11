import { world } from '../world';
import type { Entity } from '../world';
import type { Level } from '../level/Level';
import { TileType, TILE_WIDTH, TILE_HEIGHT } from '../level/TileType';

/** Wall art is 56px tall: the tile itself plus 24px hanging over the row above. */
const WALL_HEIGHT = 56;
const WALL_VARIANTS = 23;

const wallEntities = new Map<number, Entity>();

/**
 * Keeps one depth-sorted entity per wall tile, standing on the tile's bottom
 * edge. Because RenderSystem orders sprites by feet position, anything standing
 * just north of a wall is drawn behind its overhang. Safe to call repeatedly:
 * it only adds walls that appeared and removes walls a bomb has cleared.
 */
export function syncWalls(level: Level): void {
  const present = new Set<number>();

  for (let ty = 0; ty < level.height; ty++) {
    for (let tx = 0; tx < level.width; tx++) {
      const tile = level.getTile(tx, ty);
      if (tile?.type !== TileType.Wall) continue;

      const key = tx + ty * level.width;
      present.add(key);
      if (wallEntities.has(key)) continue;

      wallEntities.set(
        key,
        world.add({
          position: { x: tx * TILE_WIDTH + TILE_WIDTH / 2, y: (ty + 1) * TILE_HEIGHT },
          wallTile: { tileX: tx, tileY: ty },
          visual: { sheet: 'walltiles', col: tile.imageVariant % WALL_VARIANTS },
          yOffset: WALL_HEIGHT / 2,
        }),
      );
    }
  }

  for (const [key, entity] of wallEntities) {
    if (present.has(key)) continue;
    world.addComponent(entity, 'removed', true);
    wallEntities.delete(key);
  }
}

/** Forgets every wall, for tearing a level down. */
export function resetWalls(): void {
  wallEntities.clear();
}
