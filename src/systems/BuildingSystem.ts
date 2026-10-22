import { MathUtils } from 'yuka';
import { world, Team } from '../world';
import type { Entity } from '../world';
import type { Level } from '../level/Level';
import { createBullet } from '../entities/BulletFactory';
import { pickupSound } from '../entities/LootFactory';
import { spawnSteam, spawnTakeFx } from '../entities/FxFactory';
import { hurtEntity, hurtPlayer } from './CombatSystem';
import { spawnExplosion } from './FxSystem';
import { angleTo8 } from '../render/Facing';
import { forEachTile } from '../level/Grid';
import { TileType, TILE_WIDTH, TILE_HEIGHT } from '../level/TileType';
import { isVersus } from '../game/GameState';
import { sound } from '../audio/SoundPlayer';

/** Turret barrels sit this far above its feet, and this far out along the aim. */
const BARREL_HEIGHT = 13;
const BARREL_REACH = 8;
/** Distance between the two barrels of an upgraded turret. */
const TWIN_SPACING = 5;
/** Sideways offset of each barrel: one in the middle, or from level two a pair across the aim. */
const SINGLE_BARREL = [0] as const;
const TWIN_BARRELS = [-1, 1] as const;

/** Distance from which a harvester takes a coin in. */
const TAKE_DISTANCE = 16;
/** Coins moved to the player per transfer while emptying, and ticks between transfers. */
const EMPTY_AMOUNT = 50;
const EMPTY_INTERVAL = 3;
const WORKING_TICKS = 30;

/** A blast hurts a little farther out than the tiles it clears, in tiles beyond the bomb's own. */
export const BLAST_HIT_MARGIN = 0.5;

/**
 * Multiples of a bomb's blast damage a player takes: at the very edge of the blast, and right on top of
 * the bomb. In between it grows the closer they stand, so being caught near a bomb is far worse than
 * being clipped by it.
 */
export const PLAYER_BLAST_EDGE = 1.5;
export const PLAYER_BLAST_CORE = 3;

const turrets = world.with('position', 'turret');
const shootable = world.with('position', 'health', 'radius');
const chests = world.with('chest', 'health');
const harvesters = world.with('position', 'harvester');
const loose = world.with('position', 'loot');
const bombs = world.with('position', 'bomb', 'health');
const mobs = world.with('position', 'health', 'ai');
const players = world.with('position', 'health', 'playerInput');
const damageable = world.with('position', 'health');

/** A rival's player or machine, in a versus match. */
function rivalOf(turret: Entity, e: Entity): boolean {
  if (!isVersus() || e.team === undefined || e.team === Team.Neutral || e.team === turret.team) return false;
  return !!(e.playerInput || e.turret || e.harvester || e.railDroid);
}

/** Mobs and the nests they crawl out of are fair game, and in versus the rival's people and machines. */
function isTurretPrey(turret: Entity, e: Entity): boolean {
  if (!e.ai && !e.spawner && !rivalOf(turret, e)) return false;
  if ((e.playerInput && e.spawnProtected) || e.respawnTicks !== undefined) return false;
  return e.health!.current > 0 && !e.removed && e.carriedBy === undefined;
}

/** The nearest prey in range that the turret has line of sight to. */
function turretTarget(level: Level, turret: Entity): Entity | null {
  const pos = turret.position!;
  const radiusSqr = turret.turret!.radius ** 2;
  let closest: Entity | null = null;
  let closestDist = Infinity;
  for (const e of shootable) {
    if (!isTurretPrey(turret, e)) continue;
    const d = (e.position!.x - pos.x) ** 2 + (e.position!.y - pos.y) ** 2;
    if (d >= radiusSqr || d >= closestDist) continue;
    if (!level.checkLineOfSight(pos.x, pos.y, e.position!.x, e.position!.y)) continue;
    closestDist = d;
    closest = e;
  }
  return closest;
}

function fireTurret(turret: Entity, target: Entity): void {
  const pos = turret.position!;
  const t = turret.turret!;
  const dx = target.position!.x - pos.x;
  const dy = target.position!.y - pos.y;
  const len = Math.hypot(dx, dy) || 1;
  const nx = dx / len;
  const ny = dy / len;
  turret.facing8 = angleTo8(dx, dy);
  const barrels = (turret.upgradable?.level ?? 1) >= 2 ? TWIN_BARRELS : SINGLE_BARREL;
  for (const side of barrels) {
    const bullet = createBullet(turret, 'rifle', dx, dy, t.damage);
    bullet.position!.x = pos.x + nx * BARREL_REACH - ny * side * (TWIN_SPACING / 2);
    bullet.position!.y = pos.y - BARREL_HEIGHT + ny * BARREL_REACH + nx * side * (TWIN_SPACING / 2);
  }
  t.cooldown = t.delay;
  sound.playSound('shot1', pos.x, pos.y);
}

/** Turrets shoot the nearest mob or nest in range that they have line of sight to. */
export function updateTurrets(level: Level, _dt: number): void {
  for (const turret of turrets) {
    const t = turret.turret!;
    if (turret.carriedBy !== undefined || (turret.health?.current ?? 1) <= 0) continue;
    if (t.cooldown > 0) {
      t.cooldown--;
      continue;
    }
    const target = turretTarget(level, turret);
    if (target) fireTurret(turret, target);
  }
}

export function updateChests(): void {
  for (const entity of chests) {
    const chest = entity.chest!;
    if (chest.opened && --chest.disappearTicks <= 0) entity.health!.current = 0;
  }
}

/** Hands a share of the stash to the player emptying the harvester, every few ticks. */
function empty(entity: Entity): void {
  const h = entity.harvester!;
  if (!h.emptying || h.time % EMPTY_INTERVAL !== 0) return;
  const player = h.emptyingPlayerId !== undefined ? world.entity(h.emptyingPlayerId) : undefined;
  if (!player?.playerStats || player.respawnTicks !== undefined || h.collected <= 0) {
    h.emptying = false;
    return;
  }
  const amount = Math.min(EMPTY_AMOUNT, h.collected);
  h.collected -= amount;
  player.playerStats.score += amount;
  spawnTakeFx(player);
  sound.playSound('smallCoin', entity.position!.x, entity.position!.y);
}

/** Draws one loose coin in, or takes it once it is close enough. */
function pull(entity: Entity, coin: Entity): void {
  const h = entity.harvester!;
  const pos = entity.position!;
  const lp = coin.position!;
  const dx = pos.x - lp.x;
  const dy = pos.y - lp.y;
  const dist = Math.hypot(dx, dy);
  if (dist >= h.radius) return;
  h.suckTicks = WORKING_TICKS;
  if (dist < TAKE_DISTANCE) {
    h.collected += coin.loot!.value;
    sound.playSound(pickupSound(coin.loot!.kind), lp.x, lp.y);
    world.removeComponent(coin, 'loot');
    world.addComponent(coin, 'removed', true);
    return;
  }
  const suckPow = h.radius / 60;
  const strength = (1 - dist / h.radius) * 1.6 * (suckPow * 0.5 + 0.5);
  coin.loot!.velX += (dx / dist) * strength;
  coin.loot!.velY += (dy / dist) * strength;
}

function suckCoins(entity: Entity): void {
  const h = entity.harvester!;
  if (h.collected >= h.capacity) return;
  for (const coin of loose) {
    if (coin.removed || coin.loot!.glide > 0 || (coin.loot!.burstTicks ?? 0) > 0) continue;
    pull(entity, coin);
  }
}

/**
 * Harvesters pull loose coins toward themselves and store them, animate while
 * working, puff steam, and hand their stash to a player who empties them.
 */
export function updateHarvesters(_dt: number): void {
  for (const entity of harvesters) {
    if (entity.carriedBy !== undefined || (entity.health?.current ?? 1) <= 0) continue;
    const h = entity.harvester!;
    const pos = entity.position!;
    h.time++;
    h.suckTicks--;
    empty(entity);
    suckCoins(entity);
    const working = h.suckTicks >= 0;
    entity.frame = working ? 4 + ((h.time >> 3) % 5) : (h.time >> 3) % 4;
    if (Math.random() < (working ? 0.05 : 0.002)) spawnSteam(pos.x - 6 + Math.random() * 8 - Math.random() * 8, pos.y - 16);
  }
}

/** Half-width, in tiles from the centre of the bomb's tile, within which a blast hurts. */
export function blastHitTiles(blastTiles: number): number {
  return blastTiles + 0.5 + BLAST_HIT_MARGIN;
}

/** The square a bomb's blast covers: centred on the tile its body sits in, so it clears the wall it is set against. */
type Blast = { bx: number; by: number; centerX: number; centerY: number; halfW: number; halfH: number };

function blastOf(bomb: Entity): Blast {
  const pos = bomb.position!;
  const bx = Math.floor(pos.x / TILE_WIDTH);
  const by = Math.floor((pos.y - (bomb.yOffset ?? 0)) / TILE_HEIGHT);
  const reach = blastHitTiles(bomb.bomb!.blastTiles);
  return {
    bx, by,
    centerX: bx * TILE_WIDTH + TILE_WIDTH / 2,
    centerY: by * TILE_HEIGHT + TILE_HEIGHT / 2,
    halfW: reach * TILE_WIDTH,
    halfH: reach * TILE_HEIGHT,
  };
}

function inBlast(blast: Blast, e: Entity): boolean {
  return Math.abs(e.position!.x - blast.centerX) < blast.halfW && Math.abs(e.position!.y - blast.centerY) < blast.halfH;
}

/** How close to the middle of the (square) blast the entity stands: 1 on the bomb, 0 at its edge. */
function blastCloseness(blast: Blast, e: Entity): number {
  const dx = Math.abs(e.position!.x - blast.centerX) / blast.halfW;
  const dy = Math.abs(e.position!.y - blast.centerY) / blast.halfH;
  return MathUtils.clamp(1 - Math.max(dx, dy), 0, 1);
}

/** What the blast does to a player standing where they are: more the nearer the bomb. */
export function playerBlastDamage(blastDamage: number, closeness: number): number {
  return Math.round(blastDamage * (PLAYER_BLAST_EDGE + (PLAYER_BLAST_CORE - PLAYER_BLAST_EDGE) * closeness));
}

/** Whether a blast also wrecks this rival machine (versus play only). */
function blastsMachine(bomb: Entity, target: Entity): boolean {
  if (!target.turret && !target.harvester && !target.railDroid) return false;
  return target.team !== bomb.bomb!.ownerTeam && target.carriedBy === undefined && !target.removed;
}

/** Hurts every mob and player caught in the blast, and in versus the rival's machines. */
function hurtByBlast(bomb: Entity, blast: Blast): void {
  const damage = bomb.bomb!.blastDamage;
  for (const mob of mobs) if (inBlast(blast, mob)) hurtEntity(mob, bomb, damage);
  // Nobody is spared, and a player standing close to the bomb is hurt hardest of all.
  for (const player of players) {
    if (!inBlast(blast, player) || (player.hurtTime ?? 0) > 0) continue;
    hurtPlayer(player, bomb, playerBlastDamage(damage, blastCloseness(blast, player)));
  }
  if (!isVersus()) return;
  for (const target of damageable) {
    if (blastsMachine(bomb, target) && inBlast(blast, target)) hurtEntity(target, bomb, damage);
  }
}

/** Bombs exist mainly to open up cracked walls; in versus they also tear up the rival's track. */
function clearTerrain(level: Level, bomb: Entity, blast: Blast): void {
  const reach = bomb.bomb!.blastTiles;
  const ownerTeam = bomb.bomb!.ownerTeam;
  forEachTile(blast.bx - reach, blast.by - reach, blast.bx + reach, blast.by + reach, (tx, ty) => {
    const tile = level.getTile(tx, ty);
    const enemyRail = isVersus() && tile?.type === TileType.Rail && tile.team !== undefined && tile.team !== ownerTeam;
    if (tile?.destroyable || enemyRail) level.removeTile(tx, ty);
  });
}

/**
 * Detonates bombs that have been lit and burnt down, hurting every mob and
 * player caught in the blast. Runs before DeathSystem so the bomb still exists
 * when it goes off.
 */
export function updateBombs(level: Level, _dt: number): void {
  for (const bomb of bombs) {
    const data = bomb.bomb!;
    // A lit bomb burns down before going off, so there is time to back away.
    if (bomb.removed || !data.lit || data.fuse-- > 0) continue;
    const blast = blastOf(bomb);
    hurtByBlast(bomb, blast);
    clearTerrain(level, bomb, blast);
    spawnExplosion(blast.centerX, blast.centerY, Math.max(blast.halfW, blast.halfH));
    sound.playSound('explosion2', bomb.position!.x, bomb.position!.y);
    world.addComponent(bomb, 'removed', true);
  }
}

