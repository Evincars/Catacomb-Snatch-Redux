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

type Held = { dir: number; ticks: number };

/** Holds one axis' key a little longer instead of reversing it at once. */
function settleAxis(held: Held, out: Controls, minus: 'left' | 'up', plus: 'right' | 'down'): void {
  const want = (out[plus] ? 1 : 0) - (out[minus] ? 1 : 0);
  held.ticks++;
  if (want === held.dir) return;
  if (want !== 0 && held.dir !== 0 && held.ticks < FLIP_TICKS) {
    out[minus] = held.dir < 0;
    out[plus] = held.dir > 0;
    return;
  }
  held.dir = want;
  held.ticks = 0;
}

/** Keeps a key from flipping straight to its opposite: a person cannot reverse in a single tick either. */
export function settleKeys(brain: Brain, out: Controls): void {
  settleAxis(brain.held.x, out, 'left', 'right');
  settleAxis(brain.held.y, out, 'up', 'down');
}

/** Points both the aim and the directional fire keys along (x, y), reusing the objects already there. */
export function setAim(entity: Entity, x: number, y: number): void {
  const len = Math.hypot(x, y);
  if (len === 0) return;
  const pi = entity.playerInput!;
  entity.aimVector = assign(entity.aimVector, x / len, y / len);
  pi.keyAim = assign(pi.keyAim ?? undefined, x / len, y / len);
}

function assign(target: { x: number; y: number } | undefined, x: number, y: number): { x: number; y: number } {
  if (!target) return { x, y };
  target.x = x;
  target.y = y;
  return target;
}

/** Directions tried, in order, for an aim that meets nothing. */
const OPEN_AIMS = [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]] as const;

/** Aims in some direction where nothing is in reach, so the build key works the floor. */
export function aimAtNothing(entity: Entity): boolean {
  const saved = entity.aimVector ? { ...entity.aimVector } : undefined;
  for (const [x, y] of OPEN_AIMS) {
    setAim(entity, x, y);
    if (!hitByAimLine(entity)) return true;
  }
  if (saved) setAim(entity, saved.x, saved.y);
  return false;
}
