import { world } from '../world';
import { sound } from '../audio/SoundPlayer';

/**
 * Ticks between steps (Java Player.playStepSound): 15 when walking, 25 when
 * carrying something, and 60% of either while sprinting.
 */
const WALK_STEP_TICKS = 15;
const CARRY_STEP_TICKS = 25;
const SPRINT_FACTOR = 0.6;

/** Plays a step sound at a pace set by how the player is moving. */
export function updateFootsteps(): void {
  for (const player of world.with('position', 'playerInput')) {
    const moving = (player.walkTime ?? 0) > 0 && !player.falling;
    if (!moving) {
      player.stepTimer = 0;
      continue;
    }

    if ((player.stepTimer ?? 0) > 0) {
      player.stepTimer!--;
      continue;
    }
    let every = player.carryingId !== undefined ? CARRY_STEP_TICKS : WALK_STEP_TICKS;
    if (player.playerStats?.sprinting) every = Math.trunc(every * SPRINT_FACTOR);
    player.stepTimer = every - 1;
    sound.playOneOf(['step1', 'step2'], player.position!.x, player.position!.y);
  }
}
