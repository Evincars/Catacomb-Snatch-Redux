import { Container, Sprite, Texture } from 'pixi.js';
import type { Level } from './Level';
import { TILE_WIDTH, TILE_HEIGHT } from './TileType';
import { frameTexture } from '../render/Sheets';
import { camera, GAME_WIDTH, VIEW_HEIGHT } from '../render/Camera';

/** dark.png cells are addressed [col][row], exactly as Java's Art.darkness. */
const D = (col: number, row: number) => frameTexture('dark', col, row);

/** Darkness art hangs half a tile upward, matching Java's `yo = -16`. */
const Y_OFFSET = -16;

/**
 * Draws fog of war over tiles whose corners are still unknown. Which of the
 * four corners are dark selects a shape from the atlas, so the unexplored
 * region gets soft rounded edges instead of hard squares.
 *
 * Only the tiles currently on screen are drawn, into a recycled sprite pool.
 */
export class DarknessRenderer {
  readonly container = new Container();
  private pool: Sprite[] = [];
  private used = 0;

  private take(texture: Texture, x: number, y: number): void {
    let sprite = this.pool[this.used];
    if (!sprite) {
      sprite = new Sprite();
      this.container.addChild(sprite);
      this.pool.push(sprite);
    }
    sprite.texture = texture;
    sprite.x = x;
    sprite.y = y;
    sprite.visible = true;
    this.used++;
  }

  update(level: Level): void {
    this.used = 0;

    const tx0 = Math.max(0, Math.floor(camera.x / TILE_WIDTH) - 1);
    const ty0 = Math.max(0, Math.floor(camera.y / TILE_HEIGHT) - 1);
    const tx1 = Math.min(level.width - 1, Math.ceil((camera.x + GAME_WIDTH) / TILE_WIDTH) + 1);
    const ty1 = Math.min(level.height - 1, Math.ceil((camera.y + VIEW_HEIGHT) / TILE_HEIGHT) + 1);

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        // c0..c3 are the tile's corners, true when still *unseen*.
        const c0 = !level.isSeen(tx, ty);
        const c1 = !level.isSeen(tx + 1, ty);
        const c2 = !level.isSeen(tx, ty + 1);
        const c3 = !level.isSeen(tx + 1, ty + 1);
        if (!c0 && !c1 && !c2 && !c3) continue;

        const x = tx * TILE_WIDTH;
        const y = ty * TILE_HEIGHT + Y_OFFSET;
        const count = (c0 ? 1 : 0) + (c1 ? 1 : 0) + (c2 ? 1 : 0) + (c3 ? 1 : 0);

        if (count === 4) {
          this.take(D(1, 1), x, y);
        } else if (count === 3) {
          if (!c0) this.take(D(1, 4), x, y);
          if (!c1) this.take(D(0, 4), x, y);
          if (!c2) this.take(D(1, 3), x, y);
          if (!c3) this.take(D(0, 3), x, y);
        } else if (count === 1) {
          if (c0) this.take(D(2, 2), x, y);
          if (c1) this.take(D(0, 2), x, y);
          if (c2) this.take(D(2, 0), x, y);
          if (c3) this.take(D(0, 0), x, y);
        } else {
          if (c0 && c3) this.take(D(2, 4), x, y);
          if (c1 && c2) this.take(D(2, 3), x, y);
          if (c0 && c1) this.take(D(1, 2), x, y);
          if (c2 && c3) this.take(D(1, 0), x, y);
          if (c0 && c2) this.take(D(2, 1), x, y);
          if (c1 && c3) this.take(D(0, 1), x, y);
        }
      }
    }

    for (let i = this.used; i < this.pool.length; i++) this.pool[i].visible = false;
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
