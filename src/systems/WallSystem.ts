import { world } from '../world';
import type { Entity } from '../world';
import type { Level } from '../level/Level';
import { TileType, TILE_WIDTH, TILE_HEIGHT } from '../level/TileType';
import type { TileData } from '../level/TileType';
import { forEachTile } from '../level/Grid';

/** Wall art is 56px tall: the tile itself plus 24px hanging over the row above. */
const WALL_HEIGHT = 56;
const WALL_VARIANTS = 23;
const CRACKED_WALL_COLUMN = 4;

const wallEntities = new Map<number, Entity>();

/**
 * Keeps one depth-sorted entity per wall tile, standing on the tile's bottom
 * edge. Because RenderSystem orders sprites by feet position, anything standing
 * just north of a wall is drawn behind its overhang. Safe to call repeatedly:
 * it only adds walls that appeared and removes walls a bomb has cleared.
 */
export function syncWalls(level: Level): void {
  const present = new Set<number>();
  forEachTile(0, 0, level.width - 1, level.height - 1, (tx, ty) => {
    const tile = level.getTile(tx, ty);
    if (tile?.type !== TileType.Wall) return;
    const key = tx + ty * level.width;
    present.add(key);
    if (!wallEntities.has(key)) wallEntities.set(key, createWall(tile, tx, ty));
  });
  for (const [key, entity] of wallEntities) {
    if (present.has(key)) continue;
    world.addComponent(entity, 'removed', true);
    wallEntities.delete(key);
  }
}

function createWall(tile: TileData, tx: number, ty: number): Entity {
  return world.add({
    position: { x: tx * TILE_WIDTH + TILE_WIDTH / 2, y: (ty + 1) * TILE_HEIGHT },
    wallTile: { tileX: tx, tileY: ty },
    // Cracked walls, the only ones a bomb can clear, use the treasure sheet's rubble tile.
    visual: tile.destroyable
      ? { sheet: 'treasure', col: CRACKED_WALL_COLUMN }
      : { sheet: 'walltiles', col: tile.imageVariant % WALL_VARIANTS },
    yOffset: WALL_HEIGHT / 2,
  });
}

/** Forgets every wall, for tearing a level down. */
export function resetWalls(): void {
  wallEntities.clear();
}
