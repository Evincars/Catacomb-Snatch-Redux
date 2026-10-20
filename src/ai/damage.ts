import type { Entity } from '../world';
import type { WeaponKind } from '../entities/WeaponStats';
import { isAIDifficultyName } from '../game/GameState';
import { AI_GUN_DAMAGE } from './constants';

/** Damage multiplier for a shot from `shooter`'s gun: 1 for a person, AI_GUN_DAMAGE for a computer player. */
export function gunDamageScale(shooter: Entity, gun: WeaponKind): number {
  const difficulty = shooter.aiPlayer?.difficulty;
  return isAIDifficultyName(difficulty) ? AI_GUN_DAMAGE[difficulty][gun] : 1;
}
