import { Rectangle } from 'pixi.js';
import { world } from '../world';
import type { Entity } from '../world';
import { boxAround } from '../core/geometry';
import type { Level } from '../level/Level';
import { sound } from '../audio/SoundPlayer';
import { gameState } from '../game/GameState';
import { pickupSound, LOOT_BURST_TICKS } from '../entities/LootFactory';
import { spawnTakeFx } from '../entities/FxFactory';

/** Drop-burst velocity retained per tick. */
const LOOT_FRICTION = 0.85;
/** A coin this close to a player is picked up. */
export const PICKUP_RADIUS = 16;
/** Glide speed, in pixels per tick, when a coin locks onto a player. */
const GLIDE_START = 0.6;
/** Speed gained per tick; coins outrun a sprinting player before long. */
const GLIDE_ACCEL = 0.18;
const GLIDE_MAX = 5;
/** Coins are called in the very tick the player lets go of fire. */
const REST_TO_HARVEST = 1;
/** Normal difficulty's coinLifespan; a coin's own life (about 10s) scales with how far the difficulty departs from it. */
const NORMAL_LIFESPAN = 20;
const BLINK_TICKS = 180;
const BLINK_PERIOD = 4;
/** Share of its speed a coin keeps when it bounces off a wall. */
const WALL_BOUNCE = 0.4;
/** Slack around a player's drawn body within which a coin counts as walked over: about half a small coin. */
const TOUCH_SLACK = 4;

const collectors = world.with('position', 'playerStats', 'health', 'radius');
const restless = world.with('playerStats', 'playerInput');
const coins = world.with('position', 'loot');

/** The player nearest a coin and how far away they are; written into scratch objects, read at once. */
type Nearest = { player: Entity; dist: number };
const inReach: Nearest = { player: {}, dist: Infinity };
const anywhere: Nearest = { player: {}, dist: Infinity };
const bodyBox = new Rectangle();

function canCollect(player: Entity): boolean {
  return player.health!.current > 0 && !player.removed && !player.falling;
}

function nearestPlayer(x: number, y: number, range: number, out: Nearest): Nearest | null {
  let found = false;
  out.dist = Infinity;
  for (const player of collectors) {
    if (!canCollect(player)) continue;
    const dist = Math.hypot(player.position!.x - x, player.position!.y - y);
    if (dist >= range || dist >= out.dist) continue;
    out.player = player;
    out.dist = dist;
    found = true;
  }
  return found ? out : null;
}

/**
 * Whether the coin, where it is drawn, lies on the player's drawn body. The body stands `yOffset` above the
 * feet, so a coin crossed by the torso is touched even though it is farther than PICKUP_RADIUS from the feet.
 */
function touches(player: Entity, coin: Entity): boolean {
  const p = player.position!;
  const r = player.radius!;
  const lift = player.yOffset ?? 0;
  boxAround(p.x, p.y - lift / 2, r.x + TOUCH_SLACK, r.y + lift / 2 + TOUCH_SLACK, bodyBox);
  return bodyBox.contains(coin.position!.x, coin.position!.y - (coin.yOffset ?? 0));
}

/** Who picks a landed coin up by walking over it, whether or not they are firing: the nearest within reach, or anyone touching it. */
function contactCollector(coin: Entity, near: Nearest | null): Entity | null {
  if (near && near.dist <= PICKUP_RADIUS) return near.player;
  for (const player of collectors) {
    if (canCollect(player) && touches(player, coin)) return player;
  }
  return null;
}

function removeCoin(coin: Entity): void {
  world.removeComponent(coin, 'loot');
  world.addComponent(coin, 'removed', true);
}

function collect(coin: Entity, player: Entity): void {
  const ld = coin.loot!;
  player.playerStats!.score += ld.value;
  spawnTakeFx(player);
  sound.playSound(pickupSound(ld.kind), coin.position!.x, coin.position!.y);
  removeCoin(coin);
}

/** Whether a coin may move onto this point: inside the map and on a tile people can walk on. */
function open(level: Level, x: number, y: number): boolean {
  return level.getTileAt(x, y)?.passable === true;
}

/**
 * Moves a loose coin along its velocity, one axis at a time, bouncing it softly off walls and other ground
 * nobody can walk on, so a burst of loot never lands beyond a wall or off the map where it cannot be taken.
 */
function slide(level: Level, coin: Entity): void {
  const lp = coin.position!;
  const ld = coin.loot!;
  if (open(level, lp.x + ld.velX, lp.y)) lp.x += ld.velX;
  else ld.velX = -ld.velX * WALL_BOUNCE;
  if (open(level, lp.x, lp.y + ld.velY)) lp.y += ld.velY;
  else ld.velY = -ld.velY * WALL_BOUNCE;
}

/** Drift and friction of a coin that is not gliding to anyone, and the arc of one still in the air. */
function drift(level: Level, coin: Entity, airborne: boolean): void {
  const ld = coin.loot!;
  if (ld.glide === 0) slide(level, coin);
  const friction = airborne ? 0.98 : LOOT_FRICTION;
  ld.velX *= friction;
  ld.velY *= friction;
  if (!airborne) return;
  ld.burstTicks!--;
  coin.yOffset = 2 + 12 * Math.sin(Math.PI * ld.burstTicks! / LOOT_BURST_TICKS);
}

/** A coin nobody has called blinks for its last few seconds and then vanishes; returns whether it is gone. */
function expire(coin: Entity, lifeScale: number): boolean {
  const ld = coin.loot!;
  ld.age++;
  const left = (ld.fixedLife ? ld.life : ld.life * lifeScale) - ld.age;
  if (coin.sprite) coin.sprite.visible = left > BLINK_TICKS || Math.floor(left / BLINK_PERIOD) % 2 === 0;
  if (left > 0) return false;
  removeCoin(coin);
  return true;
}

/**
 * A locked coin keeps flying to the nearest player however far they run. Firing stops attraction, not
 * contact pickups: the coin coasts to a stop, and momentum may still carry it into reach.
 */
function glide(coin: Entity, target: Nearest): void {
  const lp = coin.position!;
  const ld = coin.loot!;
  if (coin.sprite) coin.sprite.visible = true;
  if (target.player.playerStats!.restTicks >= REST_TO_HARVEST) {
    ld.glide = Math.min(GLIDE_MAX, ld.glide + GLIDE_ACCEL);
  } else {
    ld.glide = Math.max(GLIDE_START, ld.glide * 0.8);
    if (ld.glide <= GLIDE_START) return;
  }
  const step = Math.min(ld.glide, target.dist);
  const pp = target.player.position!;
  lp.x += ((pp.x - lp.x) / target.dist) * step;
  lp.y += ((pp.y - lp.y) / target.dist) * step;
  if (target.dist - step <= PICKUP_RADIUS) collect(coin, target.player);
}

function updateCoin(level: Level, coin: Entity, lifeScale: number): void {
  const lp = coin.position!;
  const ld = coin.loot!;
  const airborne = (ld.burstTicks ?? 0) > 0;
  drift(level, coin, airborne);
  const near = nearestPlayer(lp.x, lp.y, ld.suckRadius, inReach);
  const toucher = airborne ? null : contactCollector(coin, near);
  if (toucher) {
    collect(coin, toucher);
    return;
  }
  if (ld.glide <= 0) {
    if (expire(coin, lifeScale)) return;
    if (airborne || !near || near.player.playerStats!.restTicks < REST_TO_HARVEST) return;
    ld.glide = GLIDE_START;
  }
  const target = near ?? nearestPlayer(lp.x, lp.y, Infinity, anywhere);
  if (target) glide(coin, target);
}

/**
 * Coins burst outwards when dropped and wait. Firing stops attraction, but not
 * contact pickups; once released, every coin in reach locks on
 * and flies in, speeding up until it lands. If they start shooting again the
 * coins in flight coast to a stop, and carry on once they stop.
 * Coins nobody collects blink and vanish after the difficulty's lifespan.
 */
export function updateLoot(level: Level, _dt: number): void {
  for (const player of restless) {
    const stats = player.playerStats!;
    stats.restTicks = player.playerInput!.shoot ? 0 : stats.restTicks + 1;
    stats.pickupFlashCooldown = Math.max(0, (stats.pickupFlashCooldown ?? 0) - 1);
  }
  const lifeScale = gameState.difficulty.coinLifespan / NORMAL_LIFESPAN;
  for (const coin of coins) {
    if (!coin.removed) updateCoin(level, coin, lifeScale);
  }
}
