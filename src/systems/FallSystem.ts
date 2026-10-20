import { world } from '../world';
import type { Level } from '../level/Level';
import { respawnPlayer } from './HoleSystem';

const fallers = world.with('position', 'falling');

/** Holds a falling player still while they drop, then lands them at spawn. */
export function updateFalling(level: Level): void {
  for (const player of fallers) {
    const fall = player.falling!;
    fall.age++;
    player.freezeTime = Math.max(player.freezeTime ?? 0, 2);
    if (player.velocity) player.velocity.x = player.velocity.y = 0;
    if (player.bump) player.bump.x = player.bump.y = 0;
    if (fall.age < fall.duration) continue;

    world.removeComponent(player, 'falling');
    respawnPlayer(player, level);
  }
}
