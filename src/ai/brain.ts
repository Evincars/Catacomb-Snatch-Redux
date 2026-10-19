import type { Entity, AIRole } from '../world';
import type { Level } from '../level/Level';
import { AI_DIFFICULTIES } from '../game/GameState';
import type { AIDifficulty } from '../game/GameState';
import { CARRIAGE_DELAY, FLIP_TICKS } from './constants';
import { routeFor } from './perception/navigation';
import type { Brain, Goal } from './types';

export const brains = new WeakMap<Entity, Brain>();
if (import.meta.env?.DEV && typeof window !== 'undefined') {
  (window as unknown as { __aiBrain: (e: Entity) => Brain | undefined }).__aiBrain = (e) => brains.get(e);
}

export function brainOf(entity: Entity): Brain {
  let brain = brains.get(entity);
  if (!brain) {
    brain = {
      age: 0, think: 0, field: null, goal: null, path: [], reaction: 0, jitter: 0,
      trigger: false, triggerTicks: 0, swapTicks: 0,
      lastX: entity.position!.x, lastY: entity.position!.y, stuck: 0, sidestep: null, walkWatch: null, avoid: new Map(), railsSinceUpgrade: 0, upgradeSince: null,
      railPlan: [], railDone: false, lastCarriageAt: -CARRIAGE_DELAY, blacklist: new Map(),
      retrieveUntil: 0, bank: null, bankCool: 0,
      held: { x: { dir: 0, ticks: 0 }, y: { dir: 0, ticks: 0 } }, lane: false,
    };
    brains.set(entity, brain);
  }
  return brain;
}

export function roleOf(entity: Entity): AIRole {
  return entity.aiPlayer?.role ?? 'all';
}

export function profileOf(entity: Entity): AIDifficulty {
  return AI_DIFFICULTIES.find((d) => d.name === entity.aiPlayer!.difficulty) ?? AI_DIFFICULTIES[1];
}

export function setGoal(brain: Brain, level: Level, goal: Omit<Goal, 'since'>): void {
  // A change of plan may turn it right round at once; only the twitching of one plan is smoothed away.
  if (brain.goal?.name !== goal.name) brain.held.x.ticks = brain.held.y.ticks = FLIP_TICKS;
  brain.goal = { ...goal, since: brain.age };
  brain.path = brain.field ? routeFor(level, brain.field, goal.tile) : [];
}
