import { Container, RenderTexture, Sprite, Texture, Rectangle } from 'pixi.js';
import type { Application } from 'pixi.js';
import type { Level } from './Level';
import { TileType, TILE_WIDTH, TILE_HEIGHT } from './TileType';
import { getTexture } from '../assets/AssetLoader';

/** Walls are taller than a tile and hang upward over the row above. */
const WALL_HEIGHT = 56;
const WALL_OVERHANG = WALL_HEIGHT - TILE_HEIGHT;

const FLOOR_COLS = 8;
const WALL_COLS = 23;

/**
 * Index into floortiles.png, matching Java's Tile.img:
 * floor variants 0-3, hole 4, sand 5, unpassable sand 6.
 */
function floorImageIndex(type: TileType, variant: number): number {
  switch (type) {
    case TileType.Hole:           return 4;
    case TileType.Sand:           return 5;
    case TileType.UnpassableSand: return 6;
    default:                      return variant & 3;
  }
}

function frameOf(tex: Texture, col: number, row: number, w: number, h: number): Texture {
  return new Texture({
    source: tex.source,
    frame: new Rectangle(col * w, row * h, w, h),
  });
}

/** Renders the static tilemap into a single texture. */
export function buildLevelSprite(app: Application, level: Level): Sprite {
  const floorTex = getTexture('floortiles');
  const wallTex = getTexture('walltiles');
  const railTex = getTexture('rails');

  const container = new Container();

  // Floors first so wall overhang draws on top of them.
  for (let ty = 0; ty < level.height; ty++) {
    for (let tx = 0; tx < level.width; tx++) {
      const tile = level.getTile(tx, ty);
      if (!tile || tile.type === TileType.Wall) continue;

      const img = floorImageIndex(tile.type, tile.imageVariant);
      const s = new Sprite(frameOf(floorTex, img % FLOOR_COLS, Math.floor(img / FLOOR_COLS), TILE_WIDTH, TILE_HEIGHT));
      s.x = tx * TILE_WIDTH;
      s.y = ty * TILE_HEIGHT;
      container.addChild(s);
    }
  }

  // Rails sit on top of the floor.
  for (let ty = 0; ty < level.height; ty++) {
    for (let tx = 0; tx < level.width; tx++) {
      const tile = level.getTile(tx, ty);
      if (!tile) continue;
      if (tile.type !== TileType.Rail && tile.type !== TileType.UnbreakableRail) continue;

      const s = new Sprite(frameOf(railTex, 0, 0, TILE_WIDTH, TILE_HEIGHT));
      s.x = tx * TILE_WIDTH;
      s.y = ty * TILE_HEIGHT;
      container.addChild(s);
    }
  }

  // Walls last, top-to-bottom so lower walls overlap higher ones.
  for (let ty = 0; ty < level.height; ty++) {
    for (let tx = 0; tx < level.width; tx++) {
      const tile = level.getTile(tx, ty);
      if (!tile || tile.type !== TileType.Wall) continue;

      const col = tile.imageVariant % WALL_COLS;
      const s = new Sprite(frameOf(wallTex, col, 0, TILE_WIDTH, WALL_HEIGHT));
      s.x = tx * TILE_WIDTH;
      s.y = ty * TILE_HEIGHT - WALL_OVERHANG;
      container.addChild(s);
    }
  }

  const rt = RenderTexture.create({
    width: level.width * TILE_WIDTH,
    height: level.height * TILE_HEIGHT,
  });
  app.renderer.render({ container, target: rt });
  container.destroy({ children: true });

  return new Sprite(rt);
}
