import { world } from '../world';
import { spawnDust } from '../entities/FxFactory';

const WALK_INTERVAL = 8;
const SPRINT_INTERVAL = 4;
/** How far behind the feet the puff appears. */
const TRAIL = 7;

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
    player.dustTimer = player.playerStats!.sprinting ? SPRINT_INTERVAL : WALK_INTERVAL;

    const v = player.velocity!;
    const len = Math.hypot(v.x, v.y);
    if (len < 0.01) continue;

    const pos = player.position!;
    spawnDust(player, pos.x - (v.x / len) * TRAIL, pos.y - (v.y / len) * TRAIL + 2);
  }
}
