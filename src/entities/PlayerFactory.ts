import { world, Team, Facing } from '../world';
import type { Entity } from '../world';

export type CharacterType = 'lord_lard' | 'countess_cruller' | 'herr_von_speck' | 'duchess_donut';

const CHARACTER_SPEED: Record<CharacterType, number> = {
  lord_lard: 1.0,
  countess_cruller: 1.2,
  herr_von_speck: 0.9,
  duchess_donut: 1.1,
};

const CHARACTER_HEALTH: Record<CharacterType, number> = {
  lord_lard: 20,
  countess_cruller: 14,
  herr_von_speck: 18,
  duchess_donut: 16,
};

export function createPlayer(
  x: number,
  y: number,
  team: Team,
  character: CharacterType = 'lord_lard',
): Entity {
  return world.add({
    position: { x, y },
    velocity: { x: 0, y: 0 },
    radius: { x: 8, y: 8 },
    blocking: true,
    physicsSlide: true,
    team,
    health: { current: CHARACTER_HEALTH[character], max: CHARACTER_HEALTH[character] },
    hurtTime: 0,
    freezeTime: 0,
    bounceWallTime: 0,
    regenInterval: 60 * 3,
    regenAmount: 1,
    regenTimer: 60 * 3,
    speed: CHARACTER_SPEED[character],
    facing: Facing.South,
    aimVector: { x: 0, y: 1 },
    walkTime: 0,
    yOffset: 8,
    flashTime: 0,
    highlight: false,
    playerInput: {
      up: false, down: false, left: false, right: false,
      shoot: false, use: false,
      mouseX: 0, mouseY: 0,
      mouseAiming: true,
    },
    playerStats: {
      score: 0,
      level: 1,
      exp: 0,
      sprint: 100,
      maxSprint: 100,
      muzzleTicks: 0,
      muzzleX: 0,
      muzzleY: 0,
    },
    weapon: { type: 'rifle', cooldown: 15, currentCooldown: 0 },
    weaponInventory: { weapons: ['rifle'], current: 0 },
    money: { amount: 0, max: 100 },
    minimapColor: team === Team.One ? 0x0000ff : 0xff0000,
  });
}
