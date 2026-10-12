import { world } from '../world';
import { sound } from '../audio/SoundPlayer';

/** Ticks between steps while walking; carrying something halves the pace (Java Player.tick). */
const STEP_TICKS = 10;
const CARRY_STEP_TICKS = 20;

/** Plays a step sound at the walk cycle's rhythm. */
export function updateFootsteps(): void {
  for (const player of world.with('position', 'playerInput')) {
    const walk = player.walkTime ?? 0;
    if (walk <= 0 || player.falling) continue;

    const every = player.carryingId !== undefined ? CARRY_STEP_TICKS : STEP_TICKS;
    if ((walk - 1) % every === 0) {
      sound.playOneOf(['step1', 'step2'], player.position!.x, player.position!.y);
    }
  }
}
