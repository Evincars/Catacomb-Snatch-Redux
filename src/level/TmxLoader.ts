import { Level } from './Level';
import { createTile, TileType, TILE_WIDTH, TILE_HEIGHT } from './TileType';
import { Team } from '../world';
import type { ShopKind } from '../world';
import { createMob } from '../entities/MobFactory';
import { createSpawner } from '../entities/SpawnerFactory';
import { createBuilding } from '../entities/BuildingFactory';
import { createShopItem } from '../entities/ShopItemFactory';

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

/**
 * Arranges each base around its spawn flag: weapons stand in a column on the
 * flag's left, turret/harvester/bomb in a row beneath it, and the stumps that
 * fence the base are hidden. The rifle stall is dropped because players
 * start with a rifle. A team with no flag keeps the stalls where the map put them.
 */
function layoutSpawnAreas(level: Level, shops: PendingShop[], costMod: number): void {
  const place = (tx: number, ty: number, kind: ShopKind, team: Team) =>
    createShopItem(tx * TILE_WIDTH + TILE_WIDTH / 2, ty * TILE_HEIGHT + TILE_HEIGHT / 2, kind, team, costMod);

  for (const team of [Team.One, Team.Two]) {
    const teamShops = shops.filter((s) => s.team === team);
    const flag = level.spawnTiles.filter((t) => t.team === team);

    if (flag.length === 0) {
      for (const s of teamShops) place(s.tx, s.ty, s.kind, team);
      continue;
    }

    const minX = Math.min(...flag.map((t) => t.tileX));
    const minY = Math.min(...flag.map((t) => t.tileY));
    const maxY = Math.max(...flag.map((t) => t.tileY));

    WEAPON_STALLS.filter((k) => teamShops.some((s) => s.kind === k)).forEach((kind, i) =>
      place(minX - 1, minY + 1 + i, kind, team),
    );
    GEAR_STALLS.filter((k) => teamShops.some((s) => s.kind === k)).forEach((kind, i) =>
      place(minX + i, maxY + 1, kind, team),
    );

    const base = level.baseTiles.filter((t) => t.team === team);
    const x0 = Math.min(minX, ...base.map((t) => t.tileX));
    const x1 = Math.max(...flag.map((t) => t.tileX), ...base.map((t) => t.tileX));
    // The map fences the base with unpassable sand. It must keep blocking, but the
    // original shows plain sand there, so it becomes an invisible barrier.
    for (let ty = minY - 1; ty <= maxY + 1; ty++) {
      for (let tx = x0; tx <= x1; tx++) {
        if (level.getTile(tx, ty)?.type === TileType.UnpassableSand) {
          level.setTile(tx, ty, createTile(TileType.Barrier, 0));
        }
      }
    }
  }
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

function parseTmx(xml: string): { width: number; height: number; layers: TmxLayer[] } {
  const parser = new DOMParser();
  const doc = parser.parseFromString(xml, 'text/xml');
  const mapEl = doc.querySelector('map');
  if (!mapEl) throw new Error('TMX has no <map> element (wrong path?)');
  const width = parseInt(mapEl.getAttribute('width') ?? '64');
  const height = parseInt(mapEl.getAttribute('height') ?? '64');

  const layers: TmxLayer[] = [];
  for (const layerEl of Array.from(doc.querySelectorAll('layer'))) {
    const name = layerEl.getAttribute('name') ?? '';
    const dataEl = layerEl.querySelector('data');
    if (dataEl) layers.push({ name, data: dataEl.textContent ?? '' });
  }
  return { width, height, layers };
}

/** `costMod` scales shop prices by the selected difficulty. */
export async function loadTmxLevel(path: string, costMod = 1): Promise<Level> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`HTTP ${response.status} loading ${path}`);
  const xml = await response.text();
  const { width, height, layers } = parseTmx(xml);

  const level = new Level(width, height);
  const shops: PendingShop[] = [];

  for (const layer of layers) {
    const ids = await decodeLayerData(layer.data);

    for (let ty = 0; ty < height; ty++) {
      for (let tx = 0; tx < width; tx++) {
        const id = ids[tx + ty * width];
        if (!id) continue;

        const wx = tx * TILE_WIDTH + TILE_WIDTH / 2;
        const wy = ty * TILE_HEIGHT + TILE_HEIGHT / 2;

        if (id >= FLOOR_BASE && id < OVERLAY_BASE) {
          // Floor layer: id encodes floor type and variant
          const local = id - FLOOR_BASE;
          switch (local) {
            case 0: break; // plain floor (default)
            case 1: level.setTile(tx, ty, createTile(TileType.Sand, 0)); break;
            case 2: level.setTile(tx, ty, createTile(TileType.UnpassableSand, 0)); break;
            case 3: level.setTile(tx, ty, createTile(TileType.Hole, 0)); break;
            case 8: level.setTile(tx, ty, createTile(TileType.DropTrap, 0)); break;
            default: {
              // floor variant (visual only)
              const existing = level.getTile(tx, ty);
              if (existing) existing.imageVariant = local % 4;
              break;
            }
          }
        } else if (id >= OVERLAY_BASE && id < WALL_BASE) {
          const local = id - OVERLAY_BASE;
          switch (local) {
            case 0: createBuilding(wx, wy, 'treasure'); break;
            case 1: level.setTile(tx, ty, createTile(TileType.Rail, 0)); break;
            case 2: level.setTile(tx, ty, createTile(TileType.UnbreakableRail, 0)); break;
            // 3 = spike trap entity
            case 4: createBuilding(wx, wy, 'chest'); break;
            case 8:  createMob(level, 'bat',    wx, wy); break;
            case 9:  createMob(level, 'snake',  wx, wy); break;
            case 10: createMob(level, 'scarab', wx, wy); break;
            case 11: createMob(level, 'mummy',  wx, wy); break;
            case 12: createMob(level, 'pharao', wx, wy); break;
            case 16: createSpawner(wx, wy, 'bat');    break;
            case 17: createSpawner(wx, wy, 'snake');  break;
            case 18: createSpawner(wx, wy, 'scarab'); break;
            case 19: createSpawner(wx, wy, 'mummy');  break;
            // "Do not darken": the map author marks these tiles pre-explored.
            case 24: level.markSeen(tx, ty); break;
          }
        } else if (id >= WALL_BASE && id < P1_BASE) {
          const local = id - WALL_BASE;
          if (local === 0 || local === 1) {
            const wall = createTile(TileType.Wall, Math.floor(Math.random() * WALL_VARIANTS));
            // Offset 1 is the destroyable "cracked" wall.
            if (local === 1) wall.destroyable = true;
            level.setTile(tx, ty, wall);
          }
        } else if (id >= P1_BASE && id < P2_BASE) {
          readPlayerTile(level, id - P1_BASE, tx, ty, Team.One, shops);
        } else if (id >= P2_BASE) {
          readPlayerTile(level, id - P2_BASE, tx, ty, Team.Two, shops);
        }
      }
    }
  }

  layoutSpawnAreas(level, shops, costMod);
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
