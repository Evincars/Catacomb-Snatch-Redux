import { createTile, TileType, TILE_WIDTH, TILE_HEIGHT } from './TileType';
import type { TileData } from './TileType';
import { BB } from '../math/BB';
import { Team } from '../world';

export type SpawnPoint = { x: number; y: number };
export type LevelState = {
  width: number;
  height: number;
  tiles: TileData[][];
  seen: boolean[];
  baseTiles: BaseTile[];
  spawnTiles: SpawnTile[];
  baseAreas: Level['baseAreas'];
  spawns: [SpawnPoint[], SpawnPoint[]];
  targetScore: number;
  scores: [number, number];
};

/** How far a wall's collision box rises above its tile (Java WallTile.addClipBBs). */
const WALL_CLIP_RISE = 6;

/** Pixels a player-base tile's collision box is pulled in from each side. */
const BASE_CLIP_INSET = 5;

/** A decorative piece of a player's home base, drawn over the floor. */
export type BaseTile = {
  tileX: number;
  tileY: number;
  team: Team;
  side: 'left' | 'right';
  /** Index 0-5 into the character's base sheet, laid out as [img % 2][img / 2]. */
  img: number;
};

/**
 * A tile of the central spawn-platform art drawn under the player's spawn
 * positions. Java uses start_<char>.png (4 cols × 3 rows) with frame
 * selection [img % 4][img / 4], img 0-11.
 */
export type SpawnTile = {
  tileX: number;
  tileY: number;
  team: Team;
  /** 0-11, mapped to col = img%4, row = img/4 in the spawn sheet. */
  img: number;
  /** Pixels the art is drawn away from its tile, to line the flag up with the rail loop. */
  offsetX: number;
};

export class Level {
  readonly width: number;
  readonly height: number;

  // Each cell is a stack of tiles (top = active). Same as Java's LinkedList per cell.
  private tileStacks: TileData[][];

  private spawnPointsP1: SpawnPoint[] = [];
  private spawnPointsP2: SpawnPoint[] = [];

  readonly baseTiles: BaseTile[] = [];
  readonly spawnTiles: SpawnTile[] = [];
  /** Tile rectangles (inclusive) of the players' bases, where no track may be laid. */
  readonly baseAreas: Array<{ x0: number; y0: number; x1: number; y1: number; team?: Team }> = [];

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

  /** Whether every tile under a box centred at (x, y) can take a building, so nothing overhangs track or holes. */
  footprintBuildable(x: number, y: number, rx: number, ry: number): boolean {
    const x0 = Math.floor((x - rx + 1) / TILE_WIDTH);
    const x1 = Math.floor((x + rx - 1) / TILE_WIDTH);
    const y0 = Math.floor((y - ry + 1) / TILE_HEIGHT);
    const y1 = Math.floor((y + ry - 1) / TILE_HEIGHT);
    for (let ty = y0; ty <= y1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (!this.getTile(tx, ty)?.buildable) return false;
      }
    }
    return true;
  }

  setTile(x: number, y: number, tile: TileData): void {
    if (x < 0 || y < 0 || x >= this.width || y >= this.height) return;
    this.tileStacks[x + y * this.width].push(tile);
  }

  /** Set when tiles change, so the cached level sprite can be rebuilt. */
  tilesDirty = false;

  removeTile(x: number, y: number): void {
    const stack = this.tileStacks[x + y * this.width];
    if (stack.length > 1) {
      stack.pop();
      this.tilesDirty = true;
    }
  }

  canPass(worldX: number, worldY: number): boolean {
    const tile = this.getTileAt(worldX, worldY);
    return tile === null ? false : tile.passable;
  }

  /** Returns AABB obstacles for physics movement around the given world rect. */
  getClipBBs(cx: number, cy: number, rx: number, ry: number): BB[] {
    const W = this.width * TILE_WIDTH;
    const H = this.height * TILE_HEIGHT;
    // Hard map boundary walls — Java's Level.getClipBBs adds these explicitly
    // so entities can never leave the map regardless of tile types.
    const result: BB[] = [
      new BB(-TILE_WIDTH, 0, 0, H),
      new BB(0, -TILE_HEIGHT, W, 0),
      new BB(W, 0, W + TILE_WIDTH, H),
      new BB(0, H, W, H + TILE_HEIGHT),
    ];

    const tx0 = Math.floor((cx - rx) / TILE_WIDTH) - 1;
    const ty0 = Math.floor((cy - ry) / TILE_HEIGHT) - 1;
    const tx1 = Math.ceil((cx + rx) / TILE_WIDTH) + 1;
    const ty1 = Math.ceil((cy + ry) / TILE_HEIGHT) + 1;

    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const tile = this.getTile(tx, ty);
        // A null tile is outside the map, which must block or entities walk into the void.
        if (!tile || !tile.passable) {
          // Walls stand 56px tall, so Java extends their box 6px above the tile;
          // without this you can walk up into the base of a wall.
          const topInset = !tile || tile.type === TileType.Wall ? WALL_CLIP_RISE : 0;
          // Base pieces are slightly smaller than their tile (Java PlayerBaseLeft.addClipBBs).
          const sideInset = tile?.type === TileType.PlayerBase ? BASE_CLIP_INSET : 0;
          result.push(new BB(
            tx * TILE_WIDTH + sideInset,
            ty * TILE_HEIGHT - topInset + sideInset,
            (tx + 1) * TILE_WIDTH - sideInset,
            (ty + 1) * TILE_HEIGHT - sideInset,
          ));
        }
      }
    }
    return result;
  }

  inBaseArea(tx: number, ty: number): boolean {
    return this.baseAreas.some((a) => tx >= a.x0 && tx <= a.x1 && ty >= a.y0 && ty <= a.y1);
  }

  inOwnBase(x: number, y: number, team: Team): boolean {
    const tx = Math.floor(x / TILE_WIDTH);
    const ty = Math.floor(y / TILE_HEIGHT);
    const spawns = team === Team.One ? this.spawnPointsP1 : this.spawnPointsP2;
    return this.baseAreas.some(a => tx >= a.x0 && tx <= a.x1 && ty >= a.y0 && ty <= a.y1
      && (a.team === team || a.team === undefined && spawns.some(p =>
        p.x / TILE_WIDTH >= a.x0 && p.x / TILE_WIDTH < a.x1 + 1
        && p.y / TILE_HEIGHT >= a.y0 && p.y / TILE_HEIGHT < a.y1 + 1)));
  }

  addBaseTile(tileX: number, tileY: number, team: Team, side: 'left' | 'right', img: number): void {
    this.baseTiles.push({ tileX, tileY, team, side, img });
  }

  addSpawnTile(tileX: number, tileY: number, team: Team, img: number): void {
    this.spawnTiles.push({ tileX, tileY, team, img, offsetX: 0 });
  }

  addSpawnPoint(x: number, y: number, team: Team): void {
    if (team === Team.One) this.spawnPointsP1.push({ x, y });
    else if (team === Team.Two) this.spawnPointsP2.push({ x, y });
  }

  /** Replaces a team's spawn points. */
  setSpawnPoints(team: Team, points: SpawnPoint[]): void {
    if (team === Team.One) this.spawnPointsP1 = points;
    else if (team === Team.Two) this.spawnPointsP2 = points;
  }

  getRandomSpawnPoint(team: Team): SpawnPoint | null {
    const list = team === Team.One ? this.spawnPointsP1 : this.spawnPointsP2;
    if (list.length === 0) return null;
    // Java draws nextInt(size - 1), so the last point is never chosen.
    return list[Math.floor(Math.random() * Math.max(1, list.length - 1))];
  }

  canPlayersSpawn(): boolean {
    return this.spawnPointsP1.length > 0 && this.spawnPointsP2.length > 0;
  }

  snapshot(): LevelState {
    return {
      width: this.width, height: this.height, tiles: this.tileStacks, seen: this.seen,
      baseTiles: this.baseTiles, spawnTiles: this.spawnTiles, baseAreas: this.baseAreas,
      spawns: [this.spawnPointsP1, this.spawnPointsP2],
      targetScore: this.targetScore, scores: [this.player1Score, this.player2Score],
    };
  }

  static restore(state: LevelState): Level {
    const level = new Level(state.width, state.height);
    level.tileStacks = state.tiles;
    level.seen.splice(0, level.seen.length, ...state.seen);
    level.baseTiles.push(...state.baseTiles);
    level.spawnTiles.push(...state.spawnTiles);
    level.baseAreas.push(...state.baseAreas);
    [level.spawnPointsP1, level.spawnPointsP2] = state.spawns;
    level.targetScore = state.targetScore;
    [level.player1Score, level.player2Score] = state.scores;
    return level;
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
