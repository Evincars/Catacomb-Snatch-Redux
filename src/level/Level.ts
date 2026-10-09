import { createTile, TileType, TILE_WIDTH, TILE_HEIGHT } from './TileType';
import type { TileData } from './TileType';
import { BB } from '../math/BB';
import { Team } from '../world';

export type SpawnPoint = { x: number; y: number };

/** A decorative piece of a player's home base, drawn over the floor. */
export type BaseTile = {
  tileX: number;
  tileY: number;
  team: Team;
  side: 'left' | 'right';
  /** Index 0-5 into the character's base sheet, laid out as [img % 2][img / 2]. */
  img: number;
};

export class Level {
  readonly width: number;
  readonly height: number;

  // Each cell is a stack of tiles (top = active). Same as Java's LinkedList per cell.
  private tileStacks: TileData[][];

  private spawnPointsP1: SpawnPoint[] = [];
  private spawnPointsP2: SpawnPoint[] = [];

  readonly baseTiles: BaseTile[] = [];

  /**
   * Fog of war, stored per tile *corner* on a (width+1) x (height+1) grid so
   * each tile can pick a darkness shape from which of its 4 corners are known.
   */
  readonly seen: boolean[];

  targetScore = 100;
  player1Score = 0;
  player2Score = 0;

  constructor(width: number, height: number) {
    this.width = width;
    this.height = height;
    this.tileStacks = [];

    for (let i = 0; i < width * height; i++) {
      this.tileStacks[i] = [createTile(TileType.Floor, Math.floor(Math.random() * 4))];
    }

    this.seen = new Array((width + 1) * (height + 1)).fill(false);
  }

  isSeen(cornerX: number, cornerY: number): boolean {
    if (cornerX < 0 || cornerY < 0 || cornerX > this.width || cornerY > this.height) return false;
    return this.seen[cornerX + cornerY * (this.width + 1)];
  }

  /** Marks the four corners of a tile as known. */
  markSeen(tileX: number, tileY: number): void {
    const w = this.width + 1;
    this.seen[tileX + tileY * w] = true;
    this.seen[tileX + 1 + tileY * w] = true;
    this.seen[tileX + (tileY + 1) * w] = true;
    this.seen[tileX + 1 + (tileY + 1) * w] = true;
  }

  /**
   * Reveals a disc around a tile by walking rays out to the perimeter of the
   * bounding square, stopping at walls. Ported from Java's Level.reveal().
   */
  reveal(tileX: number, tileY: number, radius: number): void {
    for (let i = 0; i < radius * 2 + 1; i++) {
      this.revealLine(tileX, tileY, tileX - radius + i, tileY - radius, radius);
      this.revealLine(tileX, tileY, tileX - radius + i, tileY + radius, radius);
      this.revealLine(tileX, tileY, tileX - radius, tileY - radius + i, radius);
      this.revealLine(tileX, tileY, tileX + radius, tileY - radius + i, radius);
    }
  }

  private revealLine(x0: number, y0: number, x1: number, y1: number, radius: number): void {
    for (let i = 0; i <= radius; i++) {
      const xx = x0 + Math.trunc(((x1 - x0) * i) / radius);
      const yy = y0 + Math.trunc(((y1 - y0) * i) / radius);
      if (xx < 0 || yy < 0 || xx >= this.width || yy >= this.height) return;

      const dx = xx - x0;
      const dy = yy - y0;
      if (dx * dx + dy * dy > radius * radius) return;

      // Walls are revealed but block anything behind them.
      const tile = this.getTile(xx, yy);
      if (tile?.type === TileType.Wall) return;

      this.markSeen(xx, yy);
    }
  }

  getTile(x: number, y: number): TileData | null {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
    const stack = this.tileStacks[x + y * this.width];
    return stack[stack.length - 1] ?? null;
  }

  getTileAt(worldX: number, worldY: number): TileData | null {
    return this.getTile(Math.floor(worldX / TILE_WIDTH), Math.floor(worldY / TILE_HEIGHT));
  }

  setTile(x: number, y: number, tile: TileData): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.tileStacks[x + y * this.width].push(tile);
  }

  removeTile(x: number, y: number): void {
    const stack = this.tileStacks[x + y * this.width];
    if (stack.length > 1) stack.pop();
  }

  canPass(worldX: number, worldY: number): boolean {
    const tile = this.getTileAt(worldX, worldY);
    return tile === null ? false : tile.passable;
  }

  /** Returns AABB obstacles for physics movement around the given world rect. */
  getClipBBs(cx: number, cy: number, rx: number, ry: number): BB[] {
    const result: BB[] = [];
    const tx0 = Math.floor((cx - rx) / TILE_WIDTH) - 1;
    const ty0 = Math.floor((cy - ry) / TILE_HEIGHT) - 1;
    const tx1 = Math.ceil((cx + rx) / TILE_WIDTH) + 1;
    const ty1 = Math.ceil((cy + ry) / TILE_HEIGHT) + 1;

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const tile = this.getTile(tx, ty);
        // A null tile is outside the map, which must block or entities walk into the void.
        if (!tile || !tile.passable) {
          result.push(new BB(
            tx * TILE_WIDTH,
            ty * TILE_HEIGHT,
            (tx + 1) * TILE_WIDTH,
            (ty + 1) * TILE_HEIGHT,
          ));
        }
      }
    }
    return result;
  }

  addBaseTile(tileX: number, tileY: number, team: Team, side: 'left' | 'right', img: number): void {
    this.baseTiles.push({ tileX, tileY, team, side, img });
  }

  addSpawnPoint(x: number, y: number, team: Team): void {
    if (team === Team.One) this.spawnPointsP1.push({ x, y });
    else if (team === Team.Two) this.spawnPointsP2.push({ x, y });
  }

  getRandomSpawnPoint(team: Team): SpawnPoint | null {
    const list = team === Team.One ? this.spawnPointsP1 : this.spawnPointsP2;
    if (list.length === 0) return null;
    return list[Math.floor(Math.random() * list.length)];
  }

  canPlayersSpawn(): boolean {
    return this.spawnPointsP1.length > 0 && this.spawnPointsP2.length > 0;
  }

  checkLineOfSight(
    x0: number, y0: number,
    x1: number, y1: number,
  ): boolean {
    let tx0 = Math.floor(x0 / TILE_WIDTH);
    let ty0 = Math.floor(y0 / TILE_HEIGHT);
    const tx1 = Math.floor(x1 / TILE_WIDTH);
    const ty1 = Math.floor(y1 / TILE_HEIGHT);

    const dx = Math.abs(tx1 - tx0);
    const dy = Math.abs(ty1 - ty0);
    const sx = tx0 < tx1 ? 1 : -1;
    const sy = ty0 < ty1 ? 1 : -1;
    let err = dx - dy;

    while (tx0 !== tx1 || ty0 !== ty1) {
      const tile = this.getTile(tx0, ty0);
      if (!tile || !tile.passable) return false;
      const e2 = 2 * err;
      if (e2 > -dy) { err -= dy; tx0 += sx; }
      if (e2 < dx) { err += dx; ty0 += sy; }
    }
    return true;
  }
}
