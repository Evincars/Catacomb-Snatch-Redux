import { world } from '../world';
import { BB } from '../math/BB';

const LOOT_FRICTION = 0.85;

export function updateLoot(_dt: number): void {
  const lootEntities = world.with('position', 'loot');
  const players = world.with('position', 'playerStats', 'health', 'radius');

  for (const lootEntity of lootEntities) {
    const lp = lootEntity.position!;
    const ld = lootEntity.loot!;

    // Move
    lp.x += ld.velX;
    lp.y += ld.velY;
    ld.velX *= LOOT_FRICTION;
    ld.velY *= LOOT_FRICTION;

    // Suck toward nearby players
    for (const player of players) {
      if (!player.position || !player.playerStats) continue;
      const pp = player.position;
      const dx = lp.x - pp.x;
      const dy = lp.y - pp.y;
      const distSqr = dx * dx + dy * dy;
      const suckR = player.playerStats.sprint > 0 ? 40 : 20;

      if (distSqr < suckR * suckR) {
        // Collect
        player.playerStats.score += ld.value;
        world.removeComponent(lootEntity, 'loot');
        world.addComponent(lootEntity, 'removed', true);
        break;
      } else if (distSqr < (suckR * 3) ** 2) {
        // Pull
        const dist = Math.sqrt(distSqr) || 1;
        ld.velX -= (dx / dist) * 1.5;
        ld.velY -= (dy / dist) * 1.5;
      }
    }
  }
}
