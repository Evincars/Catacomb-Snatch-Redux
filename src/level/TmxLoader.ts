import { Level } from './Level';
import type { SpawnTile } from './Level';
import { forEachTile } from './Grid';
import { LoadError, ValidationError } from '../core/errors';
import { assetUrl } from '../assets/assetUrl';
import { createTile, TileType, TILE_WIDTH, TILE_HEIGHT } from './TileType';
import { Team } from '../world';
import type { ShopKind } from '../world';
import { createMob } from '../entities/MobFactory';
import { createSpawner } from '../entities/SpawnerFactory';
import { createBuilding } from '../entities/BuildingFactory';
import { createShopItem } from '../entities/ShopItemFactory';
import { createSpikeTrap } from '../entities/SpikeTrapFactory';
import { LEVELS, gameState } from '../game/GameState';
import { spawnTreasureGuards } from '../systems/TreasureSystem';
import { loadLevelBitmap, restoreCrackedFloors } from './LevelBitmap';

// TMX tileset firstgid offsets (from LevelUtils.java)
const FLOOR_BASE   = 1;
const OVERLAY_BASE = 65;
const WALL_BASE    = 129;
const P1_BASE      = 193;
const P2_BASE      = 257;

const WALL_VARIANTS = 23;

/** Offsets from a player tileset base that mark a spawn point (the rest are base/shop tiles). */
const SPAWN_OFFSETS = new Set([0, 1, 2, 3, 8, 9, 10, 11, 16, 17, 18, 19]);

/** Shop stalls in a player's base, keyed by offset from the player tileset base. */
const SHOP_OFFSETS: Record<number, ShopKind> = {
  24: 'turret',
  25: 'harvester',
  26: 'bomb',
  32: 'rifle',
  33: 'shotgun',
  34: 'raygun',
};

/**
 * Base platform pieces. The Java tiles index their art as [img % 2][img / 2],
 * so each offset maps to a column/row in the character's base sheet.
 */
const BASE_LEFT_OFFSETS: Record<number, number> = { 4: 0, 5: 1, 12: 2, 13: 3, 20: 4, 21: 5 };
const BASE_RIGHT_OFFSETS: Record<number, number> = { 6: 0, 7: 1, 14: 2, 15: 3, 22: 4, 23: 5 };

const PLAYER_RAIL_OFFSET = 27;

/** A shop stall found in the map, placed once the whole spawn area is known. */
type PendingShop = { kind: ShopKind; team: Team; tx: number; ty: number };

const WEAPON_STALLS: ShopKind[] = ['shotgun', 'raygun'];
const GEAR_STALLS: ShopKind[] = ['turret', 'harvester', 'bomb'];
/** Pixels between neighbouring gear stalls. */
const GEAR_SPACING = 44;

function isBaseRail(level: Level, tx: number, ty: number, team: Team): boolean {
  const tile = level.getTile(tx, ty);
  return tile?.type === TileType.PlayerRail && tile.team === team;
}

/** How far the base's rail loop is centred from its flag, in pixels; zero when the base has no loop. */
function entryShift(level: Level, team: Team, flagMinX: number, flagMaxX: number): number {
  let minRailX = Infinity;
  let maxRailX = -Infinity;
  forEachTile(0, 0, level.width - 1, level.height - 1, (tx, ty) => {
    if (!isBaseRail(level, tx, ty, team)) return;
    minRailX = Math.min(minRailX, tx);
    maxRailX = Math.max(maxRailX, tx);
  });
  if (maxRailX < minRailX) return 0;
  return ((minRailX + maxRailX + 1) * TILE_WIDTH) / 2 - ((flagMinX + flagMaxX + 1) * TILE_WIDTH) / 2;
}

/** Whether the team's own track leaves the base below its flag rather than above it. */
function railsBelow(level: Level, team: Team, flagMinY: number, flagMaxY: number): boolean {
  let below = 0;
  let above = 0;
  forEachTile(0, 0, level.width - 1, level.height - 1, (tx, ty) => {
    if (!isBaseRail(level, tx, ty, team)) return;
    if (ty > flagMaxY) below++;
    else if (ty < flagMinY) above++;
  });
  return below > above;
}

/**
 * Arranges each base around its spawn flag: weapons stand in a column on the
 * flag's left, turret/harvester/bomb in a row beneath it, and the stumps that
 * fence the base are hidden. The rifle stall is dropped because players
 * start with a rifle. A team with no flag keeps the stalls where the map put them.
 */
function layoutSpawnAreas(level: Level, shops: PendingShop[], baseCostMod: number): void {
  for (const team of [Team.One, Team.Two]) {
    const costMod = team === Team.Two && gameState.opponent === 'ai'
      ? baseCostMod * gameState.aiDifficulty.shopDiscount
      : baseCostMod;
    layoutTeam(level, team, shops.filter((s) => s.team === team), costMod);
  }
}

function layoutTeam(level: Level, team: Team, teamShops: PendingShop[], costMod: number): void {
  const place = (tx: number, ty: number, kind: ShopKind) =>
    createShopItem(tx * TILE_WIDTH + TILE_WIDTH / 2, ty * TILE_HEIGHT + TILE_HEIGHT / 2, kind, team, costMod);
  const flag = level.spawnTiles.filter((t) => t.team === team);
  if (flag.length === 0) {
    for (const s of teamShops) place(s.tx, s.ty, s.kind);
    return;
  }
  const minX = Math.min(...flag.map((t) => t.tileX));
  const maxFlagX = Math.max(...flag.map((t) => t.tileX));
  const minY = Math.min(...flag.map((t) => t.tileY));
  const maxY = Math.max(...flag.map((t) => t.tileY));
  const stocked = (k: ShopKind) => teamShops.some((s) => s.kind === k);

  WEAPON_STALLS.filter(stocked).forEach((kind, i) => place(minX - 1, minY + 1 + i, kind));
  // The flag is four tiles wide but the rail loop at the base's entry only three, so the loop's
  // centre sits half a tile off the flag's. The flag, its shops and the spawn move onto the loop's axis.
  const flagCentreX = ((minX + maxFlagX + 1) * TILE_WIDTH) / 2 + entryShift(level, team, minX, maxFlagX);
  for (const t of flag) t.offsetX = flagCentreX - ((minX + maxFlagX + 1) * TILE_WIDTH) / 2;
  // The gear row is centred on the flag, as in the original, rather than starting at its edge,
  // on the side away from the base's rail loop so it never stands over the track.
  const gear = GEAR_STALLS.filter(stocked);
  const gearRow = railsBelow(level, team, minY, maxY) ? minY - 1 : maxY + 1;
  gear.forEach((kind, i) => createShopItem(
    flagCentreX + (i - (gear.length - 1) / 2) * GEAR_SPACING, gearRow * TILE_HEIGHT + TILE_HEIGHT / 2, kind, team, costMod,
  ));

  // Players start at the middle of the flag's top row, in line with the rails.
  level.setSpawnPoints(team, [{ x: flagCentreX, y: minY * TILE_HEIGHT + TILE_HEIGHT / 2 }]);
  fenceBase(level, team, flag, minX, minY, maxY);
}

/**
 * The map fences the base with unpassable sand. It must keep blocking, but the original shows plain sand
 * there, so it becomes an invisible barrier.
 */
function fenceBase(level: Level, team: Team, flag: readonly SpawnTile[], minX: number, minY: number, maxY: number): void {
  const base = level.baseTiles.filter((t) => t.team === team);
  const x0 = Math.min(minX, ...base.map((t) => t.tileX));
  const x1 = Math.max(...flag.map((t) => t.tileX), ...base.map((t) => t.tileX));
  level.baseAreas.push({ x0, y0: minY - 1, x1, y1: maxY + 1, team });
  forEachTile(x0, minY - 1, x1, maxY + 1, (tx, ty) => {
    if (level.getTile(tx, ty)?.type === TileType.UnpassableSand) level.setTile(tx, ty, createTile(TileType.Barrier, 0));
  });
}

async function decodeLayerData(dataText: string): Promise<number[]> {
  const b64 = dataText.trim().replace(/\s/g, '');
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);

  // Decompress gzip via DecompressionStream (supported in all modern browsers)
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(bytes);
  writer.close();

  const chunks: Uint8Array[] = [];
  const reader = ds.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }

  const total = chunks.reduce((sum, c) => sum + c.length, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }

  // Data is little-endian uint32 per tile
  const tileIds: number[] = [];
  const view = new DataView(result.buffer);
  for (let i = 0; i < result.length; i += 4) {
    tileIds.push(view.getUint32(i, true));
  }
  return tileIds;
}

type TmxLayer = { name: string; data: string };
type TmxEntity = { type: 'spikeTrap' | 'turret'; tx: number; ty: number; offset: number; team: Team };

function parseTmx(xml: string): { width: number; height: number; layers: TmxLayer[]; entities: TmxEntity[] } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  const mapEl = doc.querySelector('map');
  if (!mapEl) throw new ValidationError('TMX has no <map> element (wrong path?)');
  const width = parseInt(mapEl.getAttribute('width') ?? '64');
  const height = parseInt(mapEl.getAttribute('height') ?? '64');

  const layers: TmxLayer[] = [];
  for (const layerEl of Array.from(doc.querySelectorAll('layer'))) {
    const name = layerEl.getAttribute('name') ?? '';
    const dataEl = layerEl.querySelector('data');
    if (dataEl) layers.push({ name, data: dataEl.textContent ?? '' });
  }
  const entities: TmxEntity[] = [];
  for (const obj of Array.from(doc.querySelectorAll('objectgroup[name="entities"] > object'))) {
    const property = (name: string) => obj.querySelector(`property[name="${name}"]`)?.getAttribute('value');
    const type = obj.getAttribute('type') ?? '';
    const x = obj.getAttribute('x');
    const y = obj.getAttribute('y');
    const tx = Number(x) / TILE_WIDTH;
    const ty = Number(y) / TILE_HEIGHT;
    const offset = Number(property('offset') ?? 0);
    const team = Number(property('team') ?? Team.Neutral);
    if ((type !== 'spikeTrap' && type !== 'turret') || x === null || y === null
      || !Number.isInteger(tx) || !Number.isInteger(ty)
      || tx < 0 || ty < 0 || tx >= width || ty >= height || !Number.isInteger(offset) || offset < 0
      || ![Team.Neutral, Team.One, Team.Two].includes(team)) {
      throw new ValidationError(`Invalid TMX entity: ${type} at ${tx}, ${ty}`, { type, tx, ty });
    }
    entities.push({ type, tx, ty, offset, team });
  }
  return { width, height, layers, entities };
}

const FLOOR_TILES: Readonly<Record<number, TileType>> = {
  1: TileType.Sand,
  2: TileType.UnpassableSand,
  3: TileType.Hole,
  8: TileType.DropTrap,
};

const MOB_TILES: Readonly<Record<number, string>> = { 8: 'bat', 9: 'snake', 10: 'scarab', 11: 'mummy', 12: 'pharao' };
const NEST_TILES: Readonly<Record<number, string>> = { 16: 'bat', 17: 'snake', 18: 'scarab', 19: 'mummy' };
/** "Do not darken": the map author marks these tiles pre-explored. */
const PRE_EXPLORED = 24;

/** Floor layer: the id picks a floor type, or just which plain floor variant is drawn. */
function readFloorTile(level: Level, local: number, tx: number, ty: number): void {
  if (local === 0) return;
  const type = FLOOR_TILES[local];
  if (type !== undefined) {
    level.setTile(tx, ty, createTile(type, 0));
    return;
  }
  const existing = level.getTile(tx, ty);
  if (existing) existing.imageVariant = local % 4;
}

/** Overlay layer: the treasure, track, traps, chests, mobs, nests and pre-explored marks. */
function readOverlayTile(level: Level, local: number, tx: number, ty: number): void {
  const wx = tx * TILE_WIDTH + TILE_WIDTH / 2;
  const wy = ty * TILE_HEIGHT + TILE_HEIGHT / 2;
  if (local === 0) createBuilding(wx, wy, 'treasure');
  else if (local === 1) level.setTile(tx, ty, createTile(TileType.Rail, 0));
  else if (local === 2) level.setTile(tx, ty, createTile(TileType.UnbreakableRail, 0));
  else if (local === 3) createSpikeTrap(level, tx, ty);
  else if (local === 4) createBuilding(wx, wy, 'chest');
  else if (MOB_TILES[local]) createMob(level, MOB_TILES[local], wx, wy);
  else if (NEST_TILES[local]) createSpawner(wx, wy, NEST_TILES[local]);
  else if (local === PRE_EXPLORED) level.markSeen(tx, ty);
}

/** Wall layer: offset 0 is a plain wall, offset 1 the destroyable "cracked" wall. */
function readWallTile(level: Level, local: number, tx: number, ty: number): void {
  if (local !== 0 && local !== 1) return;
  const wall = createTile(TileType.Wall, Math.floor(Math.random() * WALL_VARIANTS));
  if (local === 1) wall.destroyable = true;
  level.setTile(tx, ty, wall);
}

/** Dispatches one tile id to the tileset it belongs to. */
function readTile(level: Level, id: number, tx: number, ty: number, shops: PendingShop[]): void {
  if (id >= FLOOR_BASE && id < OVERLAY_BASE) readFloorTile(level, id - FLOOR_BASE, tx, ty);
  else if (id >= OVERLAY_BASE && id < WALL_BASE) readOverlayTile(level, id - OVERLAY_BASE, tx, ty);
  else if (id >= WALL_BASE && id < P1_BASE) readWallTile(level, id - WALL_BASE, tx, ty);
  else if (id >= P1_BASE && id < P2_BASE) readPlayerTile(level, id - P1_BASE, tx, ty, Team.One, shops);
  else if (id >= P2_BASE) readPlayerTile(level, id - P2_BASE, tx, ty, Team.Two, shops);
}

async function fetchText(path: string): Promise<string> {
  const response = await fetch(assetUrl(path));
  if (!response.ok) throw new LoadError(`HTTP ${response.status} loading ${path}`, { context: { path, status: response.status } });
  return response.text();
}

/** `costMod` scales shop prices by the selected difficulty. */
export async function loadTmxLevel(path: string, costMod = 1): Promise<Level> {
  const { width, height, layers, entities } = parseTmx(await fetchText(path));
  const level = new Level(width, height);
  const shops: PendingShop[] = [];
  for (const layer of layers) {
    const ids = await decodeLayerData(layer.data);
    forEachTile(0, 0, width - 1, height - 1, (tx, ty) => {
      const id = ids[tx + ty * width];
      if (id) readTile(level, id, tx, ty, shops);
    });
  }
  for (const { type, tx, ty, offset, team } of entities) {
    if (type === 'spikeTrap') createSpikeTrap(level, tx, ty, offset);
    else createBuilding((tx + 0.5) * TILE_WIDTH, (ty + 0.5) * TILE_HEIGHT, 'turret', team);
  }
  layoutSpawnAreas(level, shops, costMod);
  spawnTreasureGuards(level);
  const bitmapPath = LEVELS.find(map => map.path === path)?.preview;
  if (bitmapPath) restoreCrackedFloors(level, await loadLevelBitmap(bitmapPath));
  return level;
}

/** Handles one tile from either player tileset: spawn points, base art, shops and rails. */
function readPlayerTile(
  level: Level,
  offset: number,
  tx: number,
  ty: number,
  team: Team,
  shops: PendingShop[],
): void {
  const cx = tx * TILE_WIDTH + TILE_WIDTH / 2;
  const cy = ty * TILE_HEIGHT + TILE_HEIGHT / 2;

  if (SPAWN_OFFSETS.has(offset)) {
    level.addSpawnPoint(cx, cy, team);
    // img 0-11 maps the 12 spawn offsets to frames in the 4×3 spawn sheet.
    // offset groups: 0-3 → img 0-3, 8-11 → img 4-7, 16-19 → img 8-11.
    const img = Math.floor(offset / 8) * 4 + (offset % 4);
    level.addSpawnTile(tx, ty, team, img);
    return;
  }

  const shop = SHOP_OFFSETS[offset];
  if (shop) {
    shops.push({ kind: shop, team, tx, ty });
    return;
  }

  const left = BASE_LEFT_OFFSETS[offset];
  if (left !== undefined) {
    level.addBaseTile(tx, ty, team, 'left', left);
    // The machine and tent pieces that form the base wall must block movement.
    level.setTile(tx, ty, createTile(TileType.PlayerBase, 0));
    return;
  }

  const right = BASE_RIGHT_OFFSETS[offset];
  if (right !== undefined) {
    level.addBaseTile(tx, ty, team, 'right', right);
    level.setTile(tx, ty, createTile(TileType.PlayerBase, 0));
    return;
  }

  if (offset === PLAYER_RAIL_OFFSET) {
    const rail = createTile(TileType.PlayerRail, 0);
    rail.team = team;
    level.setTile(tx, ty, rail);
  }
}
