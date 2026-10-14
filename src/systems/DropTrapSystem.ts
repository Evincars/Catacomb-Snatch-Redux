import { world } from '../world';
import type { Level } from '../level/Level';
import { createTile, TileType, TILE_WIDTH, TILE_HEIGHT } from '../level/TileType';

/** Each new visit cracks the floor; the third starts its irreversible collapse. */
export function updateDropTraps(level: Level): void {
  const occupied = new Set<number>();
  for (const player of world.with('position', 'playerInput', 'health')) {
    if (player.removed || player.falling || player.health!.current <= 0) continue;
    const x = Math.floor(player.position!.x / TILE_WIDTH);
    const y = Math.floor(player.position!.y / TILE_HEIGHT);
    occupied.add(x + y * level.width);
  }

  for (let y = 0; y < level.height; y++) {
    for (let x = 0; x < level.width; x++) {
      const tile = level.getTile(x, y);
      if (tile?.type !== TileType.DropTrap) continue;
      const crumble = tile.crumble ?? 0;
      if (crumble >= 3) {
        tile.collapseTicks = Math.max(0, (tile.collapseTicks ?? 5) - 1);
        if (tile.collapseTicks > 0) continue;
        if (crumble === 7) level.setTile(x, y, createTile(TileType.Hole));
        else {
          tile.crumble = crumble + 1;
          tile.collapseTicks = 5;
        }
        level.tilesDirty = true;
        continue;
      }

      const steppedOn = occupied.has(x + y * level.width);
      if (steppedOn && !tile.steppedOn) {
        tile.crumble = crumble + 1;
        tile.collapseTicks = 5;
        level.tilesDirty = true;
      }
      tile.steppedOn = steppedOn;
    }
  }
}
