import { world } from '../world';
import { BB } from '../math/BB';
import { gameState } from '../game/GameState';
import { hurtEntity, hurtPlayer } from './CombatSystem';
import { TILE_WIDTH, TILE_HEIGHT } from '../level/TileType';

/** Four original frames: a 100-tick rest, then three 10-tick steps, with a strike on emergence. */
export function updateSpikeTraps(): void {
  for (const trap of world.with('position', 'spikeTrap')) {
    if (trap.removed) continue;
    const data = trap.spikeTrap!;
    if (--data.ticks > 0) continue;
    if (data.phase === 1) {
      const pos = trap.position!;
      const area = BB.fromCenter(pos.x, pos.y, TILE_WIDTH / 2 + 2, TILE_HEIGHT / 2 + 2);
      for (const target of world.with('position', 'radius', 'health')) {
        if (target.removed || target.health!.current <= 0 || target.mobType === 'bat' || target.carriedBy !== undefined) continue;
        const p = target.position!;
        const r = target.radius!;
        if (!area.intersects(BB.fromCenter(p.x, p.y, r.x, r.y))) continue;
        const damage = gameState.difficulty.strengthMod;
        if (target.playerInput) {
          if ((target.hurtTime ?? 0) <= 0) hurtPlayer(target, trap, damage);
        } else {
          hurtEntity(target, trap, damage);
        }
      }
    }
    data.phase = (data.phase + 1) % 4;
    data.ticks = data.phase === 0 ? 100 : 10;
    trap.frame = data.phase;
  }
}
