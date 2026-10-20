import { world } from '../world';
import type { Entity } from '../world';
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

const collectors = world.with('position', 'playerStats', 'health');
const restless = world.with('playerStats', 'playerInput');
const coins = world.with('position', 'loot');

/** The player nearest a coin and how far away they are; written into scratch objects, read at once. */
type Nearest = { player: Entity; dist: number };
const inReach: Nearest = { player: {}, dist: Infinity };
const anywhere: Nearest = { player: {}, dist: Infinity };

function nearestPlayer(x: number, y: number, range: number, out: Nearest): Nearest | null {
  let found = false;
  out.dist = Infinity;
  for (const player of collectors) {
    if (player.health!.current <= 0 || player.removed || player.falling) continue;
    const dist = Math.hypot(player.position!.x - x, player.position!.y - y);
    if (dist >= range || dist >= out.dist) continue;
    out.player = player;
    out.dist = dist;
    found = true;
  }
  return found ? out : null;
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

/** Drift and friction of a coin that is not gliding to anyone, and the arc of one still in the air. */
function drift(coin: Entity, airborne: boolean): void {
  const lp = coin.position!;
  const ld = coin.loot!;
  if (ld.glide === 0) {
    lp.x += ld.velX;
    lp.y += ld.velY;
  }
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
  const left = ld.life * lifeScale - ld.age;
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

function updateCoin(coin: Entity, lifeScale: number): void {
  const lp = coin.position!;
  const ld = coin.loot!;
  const airborne = (ld.burstTicks ?? 0) > 0;
  drift(coin, airborne);
  const near = nearestPlayer(lp.x, lp.y, ld.suckRadius, inReach);
  if (!airborne && near && near.dist <= PICKUP_RADIUS) {
    collect(coin, near.player);
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
export function updateLoot(_dt: number): void {
  for (const player of restless) {
    const stats = player.playerStats!;
    stats.restTicks = player.playerInput!.shoot ? 0 : stats.restTicks + 1;
    stats.pickupFlashCooldown = Math.max(0, (stats.pickupFlashCooldown ?? 0) - 1);
  }
  const lifeScale = gameState.difficulty.coinLifespan / NORMAL_LIFESPAN;
  for (const coin of coins) {
    if (!coin.removed) updateCoin(coin, lifeScale);
  }
}
