import { world } from '../world';
import type { Entity } from '../world';
import { sound } from '../audio/SoundPlayer';
import { gameState } from '../game/GameState';
import { pickupSound } from '../entities/LootFactory';

/** Drop-burst velocity retained per tick. */
const LOOT_FRICTION = 0.85;
/** A coin this close to a player is picked up. */
const PICKUP_RADIUS = 10;
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

function nearestPlayer(x: number, y: number, range: number): { player: Entity; dist: number } | null {
  let best: { player: Entity; dist: number } | null = null;
  for (const player of world.with('position', 'playerStats', 'health')) {
    if (player.health!.current <= 0) continue;
    const dist = Math.hypot(player.position!.x - x, player.position!.y - y);
    if (dist < range && (!best || dist < best.dist)) best = { player, dist };
  }
  return best;
}

/**
 * Coins burst outwards when dropped and wait. Firing keeps a player from
 * gathering; once they have stopped for a moment every coin in reach locks on
 * and flies in, speeding up until it lands, even if they start shooting again.
 * Coins nobody collects blink and vanish after the difficulty's lifespan.
 */
export function updateLoot(_dt: number): void {
  for (const player of world.with('playerStats', 'playerInput')) {
    const stats = player.playerStats!;
    stats.restTicks = player.playerInput!.shoot ? 0 : stats.restTicks + 1;
  }

  const lifeScale = gameState.difficulty.coinLifespan / NORMAL_LIFESPAN;

  for (const coin of world.with('position', 'loot')) {
    if (coin.removed) continue;
    const lp = coin.position!;
    const ld = coin.loot!;

    lp.x += ld.velX;
    lp.y += ld.velY;
    ld.velX *= LOOT_FRICTION;
    ld.velY *= LOOT_FRICTION;

    const near = nearestPlayer(lp.x, lp.y, ld.suckRadius);
    const locked = ld.glide > 0;

    if (!locked) {
      ld.age++;
      const left = ld.life * lifeScale - ld.age;
      if (coin.sprite) coin.sprite.visible = left > BLINK_TICKS || Math.floor(left / BLINK_PERIOD) % 2 === 0;
      if (left <= 0) {
        world.removeComponent(coin, 'loot');
        world.addComponent(coin, 'removed', true);
        continue;
      }
      if (near && near.player.playerStats!.restTicks >= REST_TO_HARVEST) ld.glide = GLIDE_START;
      else continue;
    }

    // A locked coin keeps flying to the nearest player however far they run.
    const target = near ?? nearestPlayer(lp.x, lp.y, Infinity);
    if (!target) continue;
    if (coin.sprite) coin.sprite.visible = true;

    if (target.dist < PICKUP_RADIUS) {
      target.player.playerStats!.score += ld.value;
      sound.playSound(pickupSound(ld.kind), lp.x, lp.y);
      world.removeComponent(coin, 'loot');
      world.addComponent(coin, 'removed', true);
      continue;
    }

    ld.glide = Math.min(GLIDE_MAX, ld.glide + GLIDE_ACCEL);
    const step = Math.min(ld.glide, target.dist);
    const pp = target.player.position!;
    lp.x += ((pp.x - lp.x) / target.dist) * step;
    lp.y += ((pp.y - lp.y) / target.dist) * step;
  }
}
