import { world } from '../world';
import type { Level } from '../level/Level';
import { dropLoot, spillMoney } from '../entities/LootFactory';
import { spawnDeathFx, spawnFx } from '../entities/FxFactory';
import { sound } from '../audio/SoundPlayer';
import type { SfxName } from '../audio/SoundPlayer';
import { xpForLevel } from '../ui/HudPanel';
import { destroyAttachments } from './BarSystem';

/** Death cries as in each Java mob's getDeathSound(). */
const DEATH_SOUNDS: Record<string, SfxName> = {
  bat: 'explosion',
  scarab: 'enemyDeath1',
  mummy: 'enemyDeath2',
  snake: 'enemyDeath2',
  pharao: 'pharaoDies',
};

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
    } else if (entity.turret || entity.harvester) {
      sound.playSound('explosion', pos.x, pos.y);
      spawnFx(pos.x, pos.y, 'fx_bombsplosion_small_32', 10, 24, { yOffset: 8 });
      // A wrecked harvester spills everything it had stored, as in the original.
      if (entity.harvester && entity.harvester.collected > 0) {
        spillMoney(pos.x, pos.y, entity.harvester.collected);
        entity.harvester.collected = 0;
      }
    } else if (entity.spawner) {
      // Clearing a nest is a milestone, so it reads louder than a mob death.
      sound.playSound('explosion', pos.x, pos.y);
      spawnDeathFx(entity);
      awardExperience(deathPts);
    } else if (entity.ai) {
      sound.playSound(DEATH_SOUNDS[entity.mobType ?? ''] ?? 'enemyDeath1', pos.x, pos.y);
      spawnDeathFx(entity);
      awardExperience(deathPts);
    }

    if (deathPts > 0) {
      dropLoot(pos.x, pos.y, deathPts);
    }

    world.addComponent(entity, 'removed', true);
  }

  // Flush removed entities
  for (const entity of world.with('removed')) {
    destroyAttachments(entity);
    if (entity.sprite) entity.sprite.destroy({ children: true });
    world.remove(entity);
  }
}
