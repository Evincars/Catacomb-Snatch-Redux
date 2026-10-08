import { world } from '../world';

/** Ticks buffs and applies their effects. Ported from Buffs.tick() / Buff effects. */
export function updateBuffs(_dt: number): void {
  for (const entity of world.with('buffs')) {
    const buffs = entity.buffs!;

    for (let i = buffs.length - 1; i >= 0; i--) {
      const buff = buffs[i];
      buff.duration--;

      if (buff.type === 'poison' && entity.health) {
        entity.health.current = Math.max(0, entity.health.current - buff.strength);
        entity.hurtTime = Math.max(entity.hurtTime ?? 0, 5);
      }

      if (buff.duration <= 0) {
        buffs.splice(i, 1);
      }
    }

    if (buffs.length === 0) {
      world.removeComponent(entity, 'buffs');
    }
  }
}
