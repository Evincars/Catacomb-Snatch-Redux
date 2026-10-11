import { world } from '../world';
import type { Entity } from '../world';
import { sound } from '../audio/SoundPlayer';

/** Drop-burst velocity retained per tick. */
const LOOT_FRICTION = 0.85;
/** A coin this close to a player is picked up. */
const PICKUP_RADIUS = 10;
/** Glide speed, in pixels per tick, when a coin first locks onto a player. */
const GLIDE_START = 0.4;
/** Speed gained per tick while a coin keeps closing in. */
const GLIDE_ACCEL = 0.05;
const GLIDE_MAX = 1.6;

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
 * Coins burst outwards when dropped, then idle until a player comes close.
 * Inside the pull radius they drift toward the player slowly, speeding up a
 * little as they near, and are banked on contact.
 */
export function updateLoot(_dt: number): void {
  for (const coin of world.with('position', 'loot')) {
    const lp = coin.position!;
    const ld = coin.loot!;

    lp.x += ld.velX;
    lp.y += ld.velY;
    ld.velX *= LOOT_FRICTION;
    ld.velY *= LOOT_FRICTION;

    const near = nearestPlayer(lp.x, lp.y, ld.suckRadius);
    if (!near) {
      ld.glide = 0;
      continue;
    }

    if (near.dist < PICKUP_RADIUS) {
      near.player.playerStats!.score += ld.value;
      sound.playSound(ld.value >= 10 ? 'bigCoin' : 'smallCoin', lp.x, lp.y);
      world.removeComponent(coin, 'loot');
      world.addComponent(coin, 'removed', true);
      continue;
    }

    ld.glide = ld.glide === 0 ? GLIDE_START : Math.min(GLIDE_MAX, ld.glide + GLIDE_ACCEL);
    const step = Math.min(ld.glide, near.dist);
    const pp = near.player.position!;
    lp.x += ((pp.x - lp.x) / near.dist) * step;
    lp.y += ((pp.y - lp.y) / near.dist) * step;
  }
}
