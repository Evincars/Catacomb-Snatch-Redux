import { world } from '../world';
import type { Level } from '../level/Level';
import { createLoot } from '../entities/LootFactory';
import { sound } from '../audio/SoundPlayer';
import { xpForLevel } from '../ui/HudPanel';

/** Splits a kill's experience across living players and handles level-ups. */
function awardExperience(points: number): void {
  if (points <= 0) return;
  for (const player of world.with('playerStats', 'health')) {
    if (player.health!.current <= 0) continue;
    const stats = player.playerStats!;
    stats.exp += points;

    while (stats.exp >= xpForLevel(stats.level)) {
      stats.exp -= xpForLevel(stats.level);
      stats.level++;
      player.health!.max += 2;
      player.health!.current = player.health!.max;
      sound.playSound('levelUp');
    }
  }
}

export function updateDeath(_level: Level, _dt: number): void {
  for (const entity of world.with('health', 'position')) {
    const h = entity.health!;
    if (h.current > 0) continue;
    if (entity.removed) continue;

    const pos = entity.position!;
    const deathPts = entity.deathPoints ?? 0;

    if (entity.playerInput) {
      sound.playSound('death');
    } else if (entity.ai) {
      sound.playOneOf(['enemyDeath1', 'enemyDeath2'], pos.x, pos.y);
      awardExperience(deathPts);
    }

    if (deathPts > 0) {
      const loots = 4;
      for (let i = 0; i < loots; i++) {
        const angle = (i / loots) * Math.PI * 2;
        createLoot(pos.x, pos.y, Math.cos(angle), Math.sin(angle), deathPts);
      }
    }

    world.addComponent(entity, 'removed', true);
  }

  // Flush removed entities
  for (const entity of world.with('removed')) {
    if (entity.sprite) entity.sprite.destroy();
    world.remove(entity);
  }
}
