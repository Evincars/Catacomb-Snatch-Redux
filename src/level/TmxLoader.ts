import { Level } from './Level';
import { createTile, TileType, TILE_WIDTH, TILE_HEIGHT } from './TileType';
import { Team } from '../world';
import { world } from '../world';
import { createMob } from '../entities/MobFactory';
import { createBuilding } from '../entities/BuildingFactory';

// TMX tileset firstgid offsets (from LevelUtils.java)
const FLOOR_BASE   = 1;
const OVERLAY_BASE = 65;
const WALL_BASE    = 129;
const P1_BASE      = 193;
const P2_BASE      = 257;

const WALL_VARIANTS = 23;

/** Offsets from a player tileset base that mark a spawn point (the rest are base/shop tiles). */
const SPAWN_OFFSETS = new Set([0, 1, 2, 3, 8, 9, 10, 11, 16, 17, 18, 19]);

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
  const mapEl = doc.querySelector('map')!;
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

export async function loadTmxLevel(path: string): Promise<Level> {
  const response = await fetch(path);
  const xml = await response.text();
  const { width, height, layers } = parseTmx(xml);

  const level = new Level(width, height);

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
            case 16: spawnSpawner(level, 'bat',    wx, wy); break;
            case 17: spawnSpawner(level, 'snake',  wx, wy); break;
            case 18: spawnSpawner(level, 'scarab', wx, wy); break;
            case 19: spawnSpawner(level, 'mummy',  wx, wy); break;
          }
        } else if (id >= WALL_BASE && id < P1_BASE) {
          const local = id - WALL_BASE;
          if (local === 0 || local === 1) {
            level.setTile(tx, ty, createTile(TileType.Wall, Math.floor(Math.random() * WALL_VARIANTS)));
          }
        } else if (id >= P1_BASE && id < P2_BASE) {
          if (SPAWN_OFFSETS.has(id - P1_BASE)) {
            level.addSpawnPoint(tx * TILE_WIDTH + TILE_WIDTH / 2, ty * TILE_HEIGHT + TILE_HEIGHT / 2, Team.One);
          }
        } else if (id >= P2_BASE) {
          if (SPAWN_OFFSETS.has(id - P2_BASE)) {
            level.addSpawnPoint(tx * TILE_WIDTH + TILE_WIDTH / 2, ty * TILE_HEIGHT + TILE_HEIGHT / 2, Team.Two);
          }
        }
      }
    }
  }

  return level;
}

function spawnSpawner(level: Level, mobType: string, x: number, y: number): void {
  world.add({
    position: { x, y },
    radius: { x: 8, y: 8 },
    spawner: {
      mobType,
      interval: 300,
      timer: Math.floor(Math.random() * 300),
      spawnCount: 0,
      maxSpawns: 999,
    },
    minimapColor: 0xff4400,
  });
}
