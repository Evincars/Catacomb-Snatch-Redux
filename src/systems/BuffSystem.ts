import { world } from '../world';
import type { Entity } from '../world';

type Buff = NonNullable<Entity['buffs']>[number];

/** Poison eats a little health every tick and keeps the victim flinching. */
const POISON_FLINCH = 5;

const buffed = world.with('buffs');

function applyBuff(entity: Entity, buff: Buff): void {
  if (buff.type !== 'poison' || !entity.health) return;
  entity.health.current = Math.max(0, entity.health.current - buff.strength);
  entity.hurtTime = Math.max(entity.hurtTime ?? 0, POISON_FLINCH);
}

/** Ticks buffs and applies their effects. Ported from Buffs.tick() / Buff effects. */
export function updateBuffs(_dt: number): void {
  for (const entity of buffed) {
    if (entity.respawnTicks !== undefined) continue;
    tickBuffs(entity);
    if (entity.buffs!.length === 0) world.removeComponent(entity, 'buffs');
  }
}

/** Runs every buff for a tick and drops the ones that have worn off. */
function tickBuffs(entity: Entity): void {
  const buffs = entity.buffs!;
  for (let i = buffs.length - 1; i >= 0; i--) {
    buffs[i].duration--;
    applyBuff(entity, buffs[i]);
    if (buffs[i].duration <= 0) buffs.splice(i, 1);
  }
}
