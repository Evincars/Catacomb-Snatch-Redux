import { world } from '../world';
import type { Entity } from '../world';
import type { Level } from '../level/Level';
import { createBullet } from '../entities/BulletFactory';
import { pickupSound } from '../entities/LootFactory';
import { spawnSteam, spawnTakeFx } from '../entities/FxFactory';
import { hurtEntity } from './CombatSystem';
import { spawnExplosion } from './FxSystem';
import { Mth } from '../math/Mth';
import { TILE_WIDTH, TILE_HEIGHT } from '../level/TileType';
import { sound } from '../audio/SoundPlayer';

/** Turret barrels sit this far above its feet, and this far out along the aim. */
const BARREL_HEIGHT = 13;
const BARREL_REACH = 8;
/** Distance between the two barrels of an upgraded turret. */
const TWIN_SPACING = 5;

/** Turrets shoot the nearest mob in range that they have line of sight to. */
export function updateTurrets(level: Level, _dt: number): void {
  for (const turretEntity of world.with('position', 'turret')) {
    const t = turretEntity.turret!;
    if (turretEntity.carriedBy !== undefined) continue;
    if ((turretEntity.health?.current ?? 1) <= 0) continue;

    if (t.cooldown > 0) {
      t.cooldown--;
      continue;
    }

    const pos = turretEntity.position!;
    let closest: Entity | null = null;
    let closestDist = Infinity;

    for (const mob of world.with('position', 'health', 'ai')) {
      if (mob.health!.current <= 0) continue;
      const d = (mob.position!.x - pos.x) ** 2 + (mob.position!.y - pos.y) ** 2;
      if (d >= t.radius ** 2 || d >= closestDist) continue;
      if (!level.checkLineOfSight(pos.x, pos.y, mob.position!.x, mob.position!.y)) continue;
      closestDist = d;
      closest = mob;
    }

    if (!closest) continue;

    const dx = closest.position!.x - pos.x;
    const dy = closest.position!.y - pos.y;
    const len = Math.hypot(dx, dy) || 1;
    const nx = dx / len;
    const ny = dy / len;
    turretEntity.facing8 = Mth.angleTo8(dx, dy);

    // From level two the head carries two barrels, side by side across the aim.
    const barrels = (turretEntity.upgradable?.level ?? 1) >= 2 ? [-1, 1] : [0];
    for (const side of barrels) {
      const bullet = createBullet(turretEntity, 'rifle', dx, dy, t.damage);
      bullet.position!.x = pos.x + nx * BARREL_REACH - ny * side * (TWIN_SPACING / 2);
      bullet.position!.y = pos.y - BARREL_HEIGHT + ny * BARREL_REACH + nx * side * (TWIN_SPACING / 2);
    }
    t.cooldown = t.delay;
    sound.playSound('shot1', pos.x, pos.y);
  }
}

/** Distance from which a harvester takes a coin in. */
const TAKE_DISTANCE = 16;
/** Coins moved to the player per transfer while emptying, and ticks between transfers. */
const EMPTY_AMOUNT = 50;
const EMPTY_INTERVAL = 3;
const WORKING_TICKS = 30;

/**
 * Harvesters pull loose coins toward themselves and store them, animate while
 * working, puff steam, and hand their stash to a player who empties them.
 */
export function updateHarvesters(_dt: number): void {
  for (const entity of world.with('position', 'harvester')) {
    if (entity.carriedBy !== undefined) continue;
    if ((entity.health?.current ?? 1) <= 0) continue;

    const h = entity.harvester!;
    const pos = entity.position!;
    h.time++;
    h.suckTicks--;

    if (h.emptying && h.time % EMPTY_INTERVAL === 0) {
      const player = h.emptyingPlayerId !== undefined ? world.entity(h.emptyingPlayerId) : undefined;
      if (!player?.playerStats || h.collected <= 0) {
        h.emptying = false;
      } else {
        const amount = Math.min(EMPTY_AMOUNT, h.collected);
        h.collected -= amount;
        player.playerStats.score += amount;
        spawnTakeFx(player);
        sound.playSound('smallCoin', pos.x, pos.y);
      }
    }

    if (h.collected < h.capacity) {
      const suckPow = (h.radius - 40) / 60;
      for (const coin of world.with('position', 'loot')) {
        if (coin.removed || coin.loot!.glide > 0) continue;
        const lp = coin.position!;
        const dx = pos.x - lp.x;
        const dy = pos.y - lp.y;
        const dist = Math.hypot(dx, dy);
        if (dist >= h.radius) continue;

        h.suckTicks = WORKING_TICKS;
        if (dist < TAKE_DISTANCE) {
          h.collected += coin.loot!.value;
          sound.playSound(pickupSound(coin.loot!.kind), lp.x, lp.y);
          world.removeComponent(coin, 'loot');
          world.addComponent(coin, 'removed', true);
          continue;
        }
        const pull = (1 - dist / h.radius) * 1.6 * (suckPow * 0.5 + 0.5);
        coin.loot!.velX += (dx / dist) * pull;
        coin.loot!.velY += (dy / dist) * pull;
      }
    }

    const working = h.suckTicks >= 0;
    entity.frame = working ? 4 + ((h.time >> 3) % 5) : (h.time >> 3) % 4;
    if (Math.random() < (working ? 0.05 : 0.002)) spawnSteam(pos.x - 6 + Math.random() * 8 - Math.random() * 8, pos.y - 16);
  }
}

/**
 * Detonates bombs that have been destroyed, damaging every mob in the blast.
 * Runs before DeathSystem so the bomb still exists when it goes off.
 */
export function updateBombs(level: Level, _dt: number): void {
  for (const bombEntity of world.with('position', 'bomb', 'health')) {
    if (bombEntity.removed) continue;

    const data = bombEntity.bomb!;
    // A lit bomb burns down before going off, so there is time to back away.
    if (!data.lit) continue;
    if (data.fuse-- > 0) {
      bombEntity.flashTime = 2;
      continue;
    }

    const { blastRadius, blastDamage } = data;
    const pos = bombEntity.position!;

    for (const mob of world.with('position', 'health', 'ai')) {
      const d = Math.hypot(mob.position!.x - pos.x, mob.position!.y - pos.y);
      if (d < blastRadius) hurtEntity(mob, bombEntity, blastDamage);
    }

    // Bombs exist mainly to open up cracked walls.
    const t0x = Math.floor((pos.x - blastRadius) / TILE_WIDTH);
    const t1x = Math.floor((pos.x + blastRadius) / TILE_WIDTH);
    const t0y = Math.floor((pos.y - blastRadius) / TILE_HEIGHT);
    const t1y = Math.floor((pos.y + blastRadius) / TILE_HEIGHT);
    for (let ty = t0y; ty <= t1y; ty++) {
      for (let tx = t0x; tx <= t1x; tx++) {
        const tile = level.getTile(tx, ty);
        if (!tile?.destroyable) continue;
        const cx = tx * TILE_WIDTH + TILE_WIDTH / 2;
        const cy = ty * TILE_HEIGHT + TILE_HEIGHT / 2;
        if (Math.hypot(cx - pos.x, cy - pos.y) > blastRadius) continue;
        level.removeTile(tx, ty);
      }
    }

    spawnExplosion(pos.x, pos.y);
    sound.playSound('explosion2', pos.x, pos.y);
    world.addComponent(bombEntity, 'removed', true);
  }
}
