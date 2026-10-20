import { Rectangle } from 'pixi.js';
import { world } from '../world';
import type { Entity } from '../world';
import { boxAround } from '../core/geometry';
import { gameState } from '../game/GameState';
import { hurtEntity, hurtPlayer } from './CombatSystem';
import { TILE_WIDTH, TILE_HEIGHT } from '../level/TileType';

/** Spikes reach a couple of pixels past their tile. */
const SPIKE_REACH = 2;
const REST_TICKS = 100;
const STEP_TICKS = 10;
/** The phase in which the spikes stab up out of the floor. */
const STRIKE_PHASE = 1;

const traps = world.with('position', 'spikeTrap');
const victims = world.with('position', 'radius', 'health');
const trapArea = new Rectangle();
const victimBox = new Rectangle();

function canBeSpiked(target: Entity): boolean {
  return !target.removed && target.health!.current > 0 && target.mobType !== 'bat' && target.carriedBy === undefined;
}

/** Everything standing on the trap as it strikes takes the difficulty's damage. */
function strike(trap: Entity): void {
  const pos = trap.position!;
  const area = boxAround(pos.x, pos.y, TILE_WIDTH / 2 + SPIKE_REACH, TILE_HEIGHT / 2 + SPIKE_REACH, trapArea);
  const damage = gameState.difficulty.strengthMod;
  for (const target of victims) {
    if (!canBeSpiked(target)) continue;
    if (!area.intersects(boxAround(target.position!.x, target.position!.y, target.radius!.x, target.radius!.y, victimBox))) continue;
    if (!target.playerInput) hurtEntity(target, trap, damage);
    else if ((target.hurtTime ?? 0) <= 0) hurtPlayer(target, trap, damage);
  }
}

/** Four original frames: a 100-tick rest, then three 10-tick steps, with a strike on emergence. */
export function updateSpikeTraps(): void {
  for (const trap of traps) {
    if (trap.removed) continue;
    const data = trap.spikeTrap!;
    if (--data.ticks > 0) continue;
    if (data.phase === STRIKE_PHASE) strike(trap);
    data.phase = (data.phase + 1) % 4;
    data.ticks = data.phase === 0 ? REST_TICKS : STEP_TICKS;
    trap.frame = data.phase;
  }
}
