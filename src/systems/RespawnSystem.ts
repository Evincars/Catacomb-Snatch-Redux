import { world, Team } from '../world';
import type { Level } from '../level/Level';
import { gameState, isVersus } from '../game/GameState';
import { respawnPlayer } from './HoleSystem';

const respawning = world.with('playerInput', 'respawnTicks');
const players = world.with('playerInput', 'position');

export const RESPAWN_TICKS = 600;

export function updateRespawns(level: Level, dt: number): void {
  for (const player of respawning) {
    player.respawnTicks = Math.max(0, player.respawnTicks! - dt);
    if (player.respawnTicks === 0) {
      world.removeComponent(player, 'respawnTicks');
      respawnPlayer(player, level, 'death');
      // Protection in enemy mode is spatial, not a grace period outside the base.
      player.hurtTime = 0;
    }
  }
  updateSpawnProtection(level);
}

export function updateSpawnProtection(level: Level): void {
  for (const player of players) {
    player.spawnProtected = isVersus()
      && level.inOwnBase(player.position!.x, player.position!.y, player.team ?? Team.One);
  }
}
