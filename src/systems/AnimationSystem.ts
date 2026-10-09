import { world } from '../world';
import { frameTexture, sheetCols } from '../render/Sheets';

/**
 * Picks each entity's sheet cell: the column is the animation step, the row the
 * facing. Players step through their walk cycle from walkTime (as in the Java
 * original) so they stand still when idle; everything else free-runs.
 */
export function updateAnimation(_dt: number): void {
  for (const entity of world.with('animation', 'sprite')) {
    const anim = entity.animation!;
    const cols = sheetCols(anim.sheet);

    if (entity.playerInput) {
      const walk = entity.walkTime ?? 0;
      anim.frameX = walk === 0 ? 0 : Math.floor(walk / 4) % anim.frameCount;
    } else {
      anim.timer++;
      if (anim.timer >= anim.frameTime) {
        anim.timer = 0;
        anim.frameX++;
        if (anim.frameX >= anim.frameCount) {
          anim.frameX = anim.loop ? 0 : anim.frameCount - 1;
        }
      }
    }

    const row = entity.facing ?? anim.frameY;
    entity.sprite!.texture = frameTexture(anim.sheet, anim.frameX % cols, row);
  }
}
