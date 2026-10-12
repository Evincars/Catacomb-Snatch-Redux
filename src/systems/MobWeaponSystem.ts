import { world } from '../world';
import type { Entity } from '../world';
import type { Level } from '../level/Level';
import { createBullet } from '../entities/BulletFactory';
import { TILE_WIDTH } from '../level/TileType';
import { sound } from '../audio/SoundPlayer';

/** Mob kinds that spit poison, and how far and how often. */
const SPITTERS: Record<string, { range: number; delay: number }> = {
  snake: { range: 6 * TILE_WIDTH, delay: 110 },
};

function nearestPlayer(from: { x: number; y: number }): Entity | null {
  let best: Entity | null = null;
  let bestDist = Infinity;
  for (const p of world.with('position', 'playerInput', 'health')) {
    if (p.health!.current <= 0) continue;
    const d = Math.hypot(p.position!.x - from.x, p.position!.y - from.y);
    if (d < bestDist) {
      bestDist = d;
      best = p;
    }
  }
  return best;
}

/** Snakes that can see a player spit green poison at them, with a jittered rhythm. */
export function updateMobWeapons(level: Level): void {
  for (const mob of world.with('position', 'mobType', 'ai', 'health')) {
    const spec = SPITTERS[mob.mobType!];
    if (!spec || mob.removed || mob.health!.current <= 0) continue;
    if ((mob.freezeTime ?? 0) > 0) continue;

    const ai = mob.ai!;
    ai.shootIn = (ai.shootIn ?? spec.delay) - 1;
    if (ai.shootIn > 0) continue;

    const target = nearestPlayer(mob.position!);
    if (!target) continue;
    const pos = mob.position!;
    const tp = target.position!;
    const dist = Math.hypot(tp.x - pos.x, tp.y - pos.y);
    if (dist > spec.range || !level.checkLineOfSight(pos.x, pos.y, tp.x, tp.y)) {
      ai.shootIn = 15;
      continue;
    }

    createBullet(mob, 'poison', tp.x - pos.x, tp.y - pos.y);
    sound.playSound('shot1', pos.x, pos.y);
    ai.shootIn = spec.delay + Math.floor(Math.random() * 40);
  }
}
