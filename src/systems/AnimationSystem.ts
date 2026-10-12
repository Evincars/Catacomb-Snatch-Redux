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

    // Player sheets hold 8 facings, then the same 8 again for carrying.
    let row = entity.facing ?? anim.frameY;
    if (entity.playerInput && entity.carryingId !== undefined) row += 8;
    // Mob sheets run left, up, right, down: Java picks row (facing + 1) & 3. Bats have one row.
    if (entity.mobType && !entity.playerInput) {
      row = entity.mobType === 'bat' ? 0 : ((entity.facing ?? 2) + 1) & 3;
    }

    entity.sprite!.texture = frameTexture(anim.sheet, anim.frameX % cols, row);
  }
}
