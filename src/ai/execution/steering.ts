import type { Entity } from '../../world';
import { hitByAimLine } from '../../systems/TargetingSystem';
import { FLIP_TICKS } from '../constants';
import type { Brain, Controls } from '../types';

export function steerTo(entity: Entity, x: number, y: number, deadzone: number, out: Controls): void {
  const pos = entity.position!;
  const dx = x - pos.x;
  const dy = y - pos.y;
  out.right = dx > deadzone;
  out.left = dx < -deadzone;
  out.down = dy > deadzone;
  out.up = dy < -deadzone;
}

/** Keeps a key from flipping straight to its opposite: a person cannot reverse in a single tick either. */
export function settleKeys(brain: Brain, out: Controls): void {
  const axes: Array<[{ dir: number; ticks: number }, 'left' | 'up', 'right' | 'down']> = [
    [brain.held.x, 'left', 'right'], [brain.held.y, 'up', 'down'],
  ];
  for (const [held, minus, plus] of axes) {
    const want = (out[plus] ? 1 : 0) - (out[minus] ? 1 : 0);
    held.ticks++;
    if (want !== held.dir) {
      if (want !== 0 && held.dir !== 0 && held.ticks < FLIP_TICKS) {
        out[minus] = held.dir < 0;
        out[plus] = held.dir > 0;
        continue;
      }
      held.dir = want;
      held.ticks = 0;
    }
  }
}

export function setAim(entity: Entity, x: number, y: number): void {
  const len = Math.hypot(x, y);
  if (len === 0) return;
  const aim = { x: x / len, y: y / len };
  entity.aimVector = { ...aim };
  entity.playerInput!.keyAim = aim;
}

/** Aims in some direction where nothing is in reach, so the build key works the floor. */
export function aimAtNothing(entity: Entity): boolean {
  const saved = entity.aimVector ? { ...entity.aimVector } : undefined;
  const dirs = [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  for (const [x, y] of dirs) {
    setAim(entity, x, y);
    if (!hitByAimLine(entity)) return true;
  }
  if (saved) setAim(entity, saved.x, saved.y);
  return false;
}
