import { Team } from '../../world';
import type { Entity } from '../../world';
import type { Level } from '../../level/Level';
import { TileType, TILE_WIDTH } from '../../level/TileType';
import { upgradeCostOf, turretRadiusAt } from '../../entities/BuildingFactory';
import { BASE_DEFENSE_RANGE, COINS_PER_POINT } from '../constants';
import { treasureOf } from './economy';
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
  const home = level.getRandomSpawnPoint(entity.team ?? Team.Two);
  const treasure = treasureOf();
  const rival = entity.team === Team.One ? Team.Two : Team.One;
  let gain = 0;
  for (let ty = tileY(p.y - to); ty <= tileY(p.y + to); ty++) {
    for (let tx = tileX(p.x - to); tx <= tileX(p.x + to); tx++) {
      const tile = level.getTile(tx, ty);
      if (!tile?.passable) continue;
      const cx = centreX(tx);
      const cy = centreY(ty);
      const d = Math.hypot(cx - p.x, cy - p.y);
      if (d <= from || d > to || !level.checkLineOfSight(p.x, p.y, cx, cy)) continue;
      let value = 1;
      if (cornerExit(level, tx, ty)) value = 3;
      if (tile.type === TileType.Rail && tile.team === rival) value = 4;
      else if ((home && dist({ x: cx, y: cy }, home) < BASE_DEFENSE_RANGE + 2 * TILE_WIDTH)
        || (treasure && dist({ x: cx, y: cy }, treasure.position!) < 6 * TILE_WIDTH)) value = Math.max(value, 2);
      gain += value;
    }
  }
  worthCache.set(turret, { at: brain.age, level: levelNow, gain });
  return gain;
}

/** Harvesters are always worth their upgrade; a turret only when its longer reach covers enough new ground. */
export function worthUpgrading(level: Level, entity: Entity, brain: Brain, building: Entity): boolean {
  if (!building.turret) return true;
  const cost = upgradeCostOf(building);
  return cost !== null && upgradeGain(level, entity, brain, building) * COINS_PER_POINT >= cost;
}
