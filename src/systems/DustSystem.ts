import { world } from '../world';
import { spawnDust } from '../entities/FxFactory';

const WALK_INTERVAL = 8;
const SPRINT_INTERVAL = 4;
/** How far behind the feet the puff appears. */
const TRAIL = 7;
/** How far a puff may stray from the trail, along it and across it. */
const SCATTER = 4;

/** Ticks until the next puff: the base interval, give or take a couple, so they do not land in a rhythm. */
function nextInterval(sprinting: boolean): number {
  const base = sprinting ? SPRINT_INTERVAL : WALK_INTERVAL;
  return Math.max(2, base + Math.floor(Math.random() * 5) - 2);
}

/** Kicks up dust behind players while they run. */
export function updateDust(): void {
  for (const player of world.with('position', 'velocity', 'playerStats')) {
    const moving = (player.walkTime ?? 0) > 0;
    if (!moving) {
      player.dustTimer = 0;
      continue;
    }

    const timer = (player.dustTimer ?? 0) - 1;
    if (timer > 0) {
      player.dustTimer = timer;
      continue;
    }
    player.dustTimer = nextInterval(player.playerStats!.sprinting);

    const v = player.velocity!;
    const len = Math.hypot(v.x, v.y);
    if (len < 0.01) continue;

    const dirX = v.x / len;
    const dirY = v.y / len;
    // Scatter the puff behind the feet: some way along the trail, some way to the side.
    const along = TRAIL + (Math.random() * 2 - 1) * SCATTER;
    const across = (Math.random() * 2 - 1) * SCATTER;
    const pos = player.position!;
    spawnDust(player, pos.x - dirX * along - dirY * across, pos.y - dirY * along + dirX * across + 2);
  }
}
