import { Team } from '../../world';
import type { Entity } from '../../world';
import type { Level } from '../../level/Level';
import { TileType, TILE_WIDTH } from '../../level/TileType';
import { upgradeCostOf, turretRadiusAt } from '../../entities/BuildingFactory';
import { BASE_DEFENSE_RANGE, COINS_PER_POINT } from '../constants';
import { treasureOf } from './economy';
import { forEachTile } from '../../level/Grid';
import { centreX, centreY, dist, tileX, tileY } from './geometry';
import type { Brain } from '../types';

export const worthCache = new WeakMap<Entity, { at: number; level: number; gain: number }>();

/** A walkable tile at a wall's corner, where someone rounding it steps into sight without warning. */
export function cornerExit(level: Level, tx: number, ty: number): boolean {
  for (const [dx, dy] of [[1, 1], [1, -1], [-1, 1], [-1, -1]]) {
    if (level.getTile(tx + dx, ty + dy)?.passable === false
      && level.getTile(tx + dx, ty)?.passable && level.getTile(tx, ty + dy)?.passable) return true;
  }
  return false;
}

/** What surrounds a turret that makes some of the ground it watches worth more. */
type Ground = { home: { x: number; y: number } | null; treasure: Entity | null; rival: Team };

/**
 * Worth of watching one tile: ordinary floor one, a corner someone steps out from three, the rival's laid
 * track four, and the ground around home or the treasure at least two.
 */
function tileWorth(level: Level, tx: number, ty: number, { home, treasure, rival }: Ground): number {
  const tile = level.getTile(tx, ty)!;
  if (tile.type === TileType.Rail && tile.team === rival) return 4;
  const value = cornerExit(level, tx, ty) ? 3 : 1;
  const at = { x: centreX(tx), y: centreY(ty) };
  const nearHome = home !== null && dist(at, home) < BASE_DEFENSE_RANGE + 2 * TILE_WIDTH;
  const nearTreasure = treasure !== null && dist(at, treasure.position!) < 6 * TILE_WIDTH;
  return nearHome || nearTreasure ? Math.max(value, 2) : value;
}

/**
 * What the extra reach of the next turret level would newly cover, counted in tiles that have a
 * clear line from the turret: ordinary floor counts one, a corner someone steps out from three, the
 * rival's laid track four and the ground around home or the treasure two. A turret in a dead-end
 * corridor gains nothing from a bigger circle; one watching a junction or a corner gains a lot.
 */
export function upgradeGain(level: Level, entity: Entity, brain: Brain, turret: Entity): number {
  const cached = worthCache.get(turret);
  const levelNow = turret.upgradable?.level ?? 1;
  if (cached && cached.level === levelNow && brain.age - cached.at < 300) return cached.gain;
  const p = turret.position!;
  const from = turretRadiusAt(levelNow);
  const to = turretRadiusAt(levelNow + 1);
  const ground: Ground = {
    home: level.getRandomSpawnPoint(entity.team ?? Team.Two),
    treasure: treasureOf(),
    rival: entity.team === Team.One ? Team.Two : Team.One,
  };
  let gain = 0;
  forEachTile(tileX(p.x - to), tileY(p.y - to), tileX(p.x + to), tileY(p.y + to), (tx, ty) => {
    const d = Math.hypot(centreX(tx) - p.x, centreY(ty) - p.y);
    if (d <= from || d > to || !level.getTile(tx, ty)?.passable) return;
    if (level.checkLineOfSight(p.x, p.y, centreX(tx), centreY(ty))) gain += tileWorth(level, tx, ty, ground);
  });
  worthCache.set(turret, { at: brain.age, level: levelNow, gain });
  return gain;
}

/** Harvesters are always worth their upgrade; a turret only when its longer reach covers enough new ground. */
export function worthUpgrading(level: Level, entity: Entity, brain: Brain, building: Entity): boolean {
  if (!building.turret) return true;
  const cost = upgradeCostOf(building);
  return cost !== null && upgradeGain(level, entity, brain, building) * COINS_PER_POINT >= cost;
}
