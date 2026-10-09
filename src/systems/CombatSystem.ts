import { world } from '../world';
import type { Entity } from '../world';
import { BB } from '../math/BB';
import { sound } from '../audio/SoundPlayer';

const CONTACT_DAMAGE = 1;
/** Frames of invulnerability after a touch, so contact does not drain health instantly. */
const CONTACT_COOLDOWN = 30;

/** Decrements combat timers and handles regen. Ported from Mob.tick() / countdownTimers(). */
export function updateCombatTimers(_dt: number): void {
  for (const entity of world.with('health')) {
    if (entity.hurtTime !== undefined && entity.hurtTime > 0) entity.hurtTime--;
    if (entity.freezeTime !== undefined && entity.freezeTime > 0) entity.freezeTime--;
    if (entity.bounceWallTime !== undefined && entity.bounceWallTime > 0) entity.bounceWallTime--;
    if (entity.flashTime !== undefined && entity.flashTime > 0) entity.flashTime--;

    // Health regen (from Mob.doRegenTime)
    const h = entity.health;
    if (!h || h.immortal) continue;
    if ((entity.hurtTime ?? 0) <= 0 && h.current < h.max) {
      if (entity.regenTimer !== undefined) {
        entity.regenTimer--;
        if (entity.regenTimer <= 0) {
          entity.regenTimer = entity.regenInterval ?? 180;
          h.current = Math.min(h.max, h.current + (entity.regenAmount ?? 1));
        }
      }
    }
  }
}

/** Applies damage from a bullet entity to entities it overlaps. */
export function updateBulletCollision(_dt: number): void {
  const bullets = world.with('position', 'bullet', 'radius');
  const targets = world.with('position', 'health', 'radius');

  for (const bullet of bullets) {
    const bpos = bullet.position!;
    const brad = bullet.radius!;
    const bdata = bullet.bullet!;

    const bbb = BB.fromCenter(bpos.x, bpos.y, brad.x, brad.y);

    for (const target of targets) {
      if (target === bullet) continue;
      const tpos = target.position!;
      const trad = target.radius!;
      const tbb = BB.fromCenter(tpos.x, tpos.y, trad.x, trad.y);

      if (!bbb.intersects(tbb)) continue;

      // Don't hit the shooter
      const shooterId = bdata.ownerId;
      if (world.id(target) === shooterId) continue;

      hurtEntity(target, bullet, bdata.damage);
      world.removeComponent(bullet, 'bullet');
      world.addComponent(bullet, 'removed', true);
      break;
    }
  }
}

/** Mobs have no ranged attack; they damage players by walking into them. */
export function updateContactDamage(_dt: number): void {
  const mobs = world.with('position', 'radius', 'ai', 'health');
  const players = world.with('position', 'radius', 'playerInput', 'health');

  for (const mob of mobs) {
    if (mob.health!.current <= 0) continue;
    const mpos = mob.position!;
    const mrad = mob.radius!;
    const mbb = BB.fromCenter(mpos.x, mpos.y, mrad.x, mrad.y);

    for (const player of players) {
      if (player.health!.current <= 0) continue;
      if ((player.freezeTime ?? 0) > 0) continue;

      const ppos = player.position!;
      const prad = player.radius!;
      if (!mbb.intersects(BB.fromCenter(ppos.x, ppos.y, prad.x, prad.y))) continue;

      hurtEntity(player, mob, CONTACT_DAMAGE);
      player.freezeTime = CONTACT_COOLDOWN;
    }
  }
}

export function hurtEntity(
  target: Entity,
  source: Entity,
  damage: number,
): void {
  const h = target.health;
  if (!h || h.immortal) return;
  if ((target.freezeTime ?? 0) > 0) return;

  target.hurtTime = 40;
  target.freezeTime = source.bullet?.freezeTime ?? 5;
  target.regenTimer = target.regenInterval ?? 180;

  const spos = source.position;
  const tpos = target.position;
  if (spos && tpos) {
    const dx = tpos.x - spos.x;
    const dy = tpos.y - spos.y;
    const dist = Math.sqrt(dx * dx + dy * dy) || 1;
    if (!target.bump) target.bump = { x: 0, y: 0 };
    target.bump.x = (dx / dist) * 2;
    target.bump.y = (dy / dist) * 2;
  }

  h.current = Math.max(0, h.current - damage);
  if (tpos) sound.playSound('hit', tpos.x, tpos.y);
}
