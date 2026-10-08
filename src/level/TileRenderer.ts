import { Container, Graphics, RenderTexture, Sprite, Application, Texture, Rectangle } from 'pixi.js';
import type { Level } from './Level';
import { TileType, TILE_WIDTH, TILE_HEIGHT } from './TileType';
import { getTexture } from '../assets/AssetLoader';

const FLOOR_VARIANTS = 4;
const WALL_VARIANTS = 4;

/** Builds a static sprite for the level tilemap. Rebuilds when the level changes. */
export function buildLevelSprite(app: Application, level: Level): Sprite {
  const floorTex = getTexture('floortiles');
  const wallTex = getTexture('walltiles');

  const container = new Container();

  for (let ty = 0; ty < level.height; ty++) {
    for (let tx = 0; tx < level.width; tx++) {
      const tile = level.getTile(tx, ty);
      if (!tile) continue;

      const wx = tx * TILE_WIDTH;
      const wy = ty * TILE_HEIGHT;

      let tex: Texture = Texture.EMPTY;

      if (tile.type === TileType.Wall) {
        const variant = tile.imageVariant % WALL_VARIANTS;
        tex = new Texture({
          source: wallTex.source,
          frame: new Rectangle(variant * TILE_WIDTH, 0, TILE_WIDTH, TILE_HEIGHT),
        });
      } else {
        const variant = tile.imageVariant % FLOOR_VARIANTS;
        tex = new Texture({
          source: floorTex.source,
          frame: new Rectangle(variant * TILE_WIDTH, 0, TILE_WIDTH, TILE_HEIGHT),
        });
      }

      const s = new Sprite(tex);
      s.x = wx;
      s.y = wy;
      container.addChild(s);
    }
  }

  const rt = RenderTexture.create({ width: level.width * TILE_WIDTH, height: level.height * TILE_HEIGHT });
  app.renderer.render({ container, target: rt });
  container.destroy({ children: true });

  return new Sprite(rt);
}
