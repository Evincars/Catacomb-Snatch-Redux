import { world } from '../world';
import type { Entity } from '../world';
import type { Level } from '../level/Level';
import { TILE_WIDTH, TILE_HEIGHT } from '../level/TileType';

export function createSpikeTrap(level: Level, tx: number, ty: number, offset = 0): Entity {
  const tile = level.getTile(tx, ty);
  if (!tile) throw new Error(`Spike trap outside level: ${tx}, ${ty}`);
  tile.buildable = false;
  return world.add({
    position: { x: (tx + 0.5) * TILE_WIDTH, y: (ty + 0.5) * TILE_HEIGHT },
    visual: { sheet: 'spiketrap' },
    frame: 0,
    spikeTrap: { phase: 0, ticks: offset },
    minimapColor: 0x0000ff,
  });
}
