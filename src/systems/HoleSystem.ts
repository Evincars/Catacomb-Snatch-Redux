import { world, Team } from '../world';
import type { Entity } from '../world';
import type { Level } from '../level/Level';
import { TileType } from '../level/TileType';
import { createLoot } from '../entities/LootFactory';
import { sound } from '../audio/SoundPlayer';
import { spawnFx } from '../entities/FxFactory';

/** Ticks from stepping off the edge to landing at the spawn; matches the falling cry's length. */
export const FALL_TICKS = 45;
const FEMALE_CHARACTERS = ['countess_cruller', 'duchess_donut'];

/**
 * Anything that walks onto a hole falls in. Mobs and buildings are simply lost;
 * a player drops what they carry, scatters half their coins and respawns.
 */
export function updateHoles(level: Level): void {
  for (const entity of world.with('position', 'health')) {
    if (entity.removed) continue;

    const tile = level.getTileAt(entity.position!.x, entity.position!.y);
    if (tile?.type !== TileType.Hole) continue;

    if (entity.playerInput) {
      if (!entity.falling) startFall(entity);
    }
    else world.addComponent(entity, 'removed', true);
  }
}

/** The player slips over the edge: input stops, a "!" pops up over their head and a cry plays. */
function startFall(player: Entity): void {
  const pos = player.position!;
  world.addComponent(player, 'falling', { age: 0, duration: FALL_TICKS });
  const female = FEMALE_CHARACTERS.some((c) => player.visual?.sheet.startsWith(c));
  sound.playSound(female ? 'fallingFemale' : 'fallingMale', pos.x, pos.y);
  spawnFx(pos.x, pos.y, 'exclamation_mark', 1, FALL_TICKS, {
    yOffset: 36,
    orderId: world.id(player),
    orderBias: 0.5,
  });
}

export function respawnPlayer(player: Entity, level: Level): void {
  const pos = player.position!;
  const health = player.health!;

  sound.playSound('fall', pos.x, pos.y);

  // Whatever the player was carrying falls in with them.
  const carriedId = player.carryingId;
  if (carriedId !== undefined) {
    const carried = world.entity(carriedId);
    if (carried) world.addComponent(carried, 'removed', true);
    world.removeComponent(player, 'carryingId');
  }

  // Half the purse scatters where they fell, as in Java's dropAllMoney().
  const stats = player.playerStats;
  if (stats && stats.score > 0) {
    let remaining = Math.floor(stats.score / 2);
    stats.score -= remaining;
    for (let i = 0; remaining > 0 && i < 8; i++) {
      const value = Math.max(1, Math.floor(remaining / 2));
      const dir = Math.random() * Math.PI * 2;
      createLoot(pos.x, pos.y, Math.cos(dir), Math.sin(dir), value, true);
      remaining -= value;
    }
  }

  const spawn = level.getRandomSpawnPoint(player.team ?? Team.One);
  if (spawn) {
    pos.x = spawn.x;
    pos.y = spawn.y;
  }

  // Falling costs a point of health rather than being a free teleport.
  health.max = Math.max(1, health.max - 1);
  health.current = health.max;

  player.velocity && (player.velocity.x = player.velocity.y = 0);
  if (player.bump) player.bump.x = player.bump.y = 0;
  player.hurtTime = 0;
  player.freezeTime = 0;
}
