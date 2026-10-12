import { world, Team } from '../world';
import type { Entity } from '../world';
import { BB } from '../math/BB';
import { sound } from '../audio/SoundPlayer';
import { gameState } from '../game/GameState';

/**
 * Java's Player.hurt: damage only lands while hurtTime is 0, then 25 ticks of
 * invulnerability, 15 of them frozen, plus a hard shove away from the attacker.
 */
const PLAYER_HURT_TIME = 25;
const PLAYER_FREEZE_TIME = 15;
const PLAYER_KNOCKBACK = 10;

/** Decrements combat timers and handles regen. Ported from Mob.tick() / countdownTimers(). */
export function updateCombatTimers(_dt: number): void {
  for (const entity of world.with('health')) {
    if (entity.hurtTime !== undefined && entity.hurtTime > 0) entity.hurtTime--;
    if (entity.freezeTime !== undefined && entity.freezeTime > 0) entity.freezeTime--;
    if (entity.bounceWallTime !== undefined && entity.bounceWallTime > 0) entity.bounceWallTime--;
    if (entity.flashTime !== undefined && entity.flashTime > 0) entity.flashTime--;

    // Health regen (from Mob.doRegenTime). Neutral things (mobs, nests) only heal on hard difficulties.
    const h = entity.health;
    if (!h || h.immortal) continue;
    // Turrets and harvesters shrug damage off once nothing is hurting them (Java's Building.tick).
    if ((entity.turret || entity.harvester) && (entity.hurtTime ?? 0) <= 0) {
      h.current = h.max;
      continue;
    }
    if (entity.team === Team.Neutral && !gameState.difficulty.mobRegen) continue;
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

/** Max distance between collision samples along a bullet's path, so fast pellets cannot skip a mob. */
const SWEEP_STEP = 6;

/** Applies damage from a bullet entity to entities it overlaps. */
export function updateBulletCollision(_dt: number): void {
  const bullets = world.with('position', 'bullet', 'radius');
  const targets = world.with('position', 'health', 'radius');

  for (const bullet of bullets) {
    const bpos = bullet.position!;
    const brad = bullet.radius!;
    const bdata = bullet.bullet!;
    const vel = bullet.velocity;

    // Walk from where the bullet was last tick to where it is now.
    const travelled = Math.min(vel ? Math.hypot(vel.x, vel.y) : 0, bdata.traveledRange);
    const steps = Math.max(1, Math.ceil(travelled / SWEEP_STEP));

    let hit: Entity | null = null;
    for (let s = 1; s <= steps && !hit; s++) {
      const back = vel ? 1 - s / steps : 0;
      const bbb = BB.fromCenter(
        bpos.x - (vel?.x ?? 0) * back,
        bpos.y - (vel?.y ?? 0) * back,
        brad.x,
        brad.y,
      );

      for (const target of targets) {
        if (target === bullet) continue;
        // Don't hit the shooter or anyone on their side
        if (world.id(target) === bdata.ownerId) continue;
        if (bullet.team !== undefined && bullet.team !== Team.Neutral && target.team === bullet.team) continue;
        // Shots from neutral mobs only ever find players, never other mobs or nests.
        if (bullet.team === Team.Neutral && !target.playerInput) continue;

        const tpos = target.position!;
        const trad = target.radius!;
        // Test against where the sprite is actually drawn (position minus the
        // visual offset) so shots connect with what the player is aiming at,
        // rather than with an invisible box down at the entity's feet.
        const tbb = BB.fromCenter(
          tpos.x,
          tpos.y - (target.yOffset ?? 0),
          trad.x,
          trad.y + (target.yOffset ?? 0) / 2,
        );

        if (bbb.intersects(tbb)) {
          hit = target;
          break;
        }
      }
    }

    if (!hit) continue;

    // A shot does not damage a bomb, it lights it.
    if (hit.bomb) {
      hit.bomb.lit = true;
    } else if (hit.playerInput) {
      if ((hit.hurtTime ?? 0) <= 0) hurtPlayer(hit, bullet, bdata.damage);
    } else {
      hurtEntity(hit, bullet, bdata.damage);
    }
    world.removeComponent(bullet, 'bullet');
    world.addComponent(bullet, 'removed', true);
  }
}

/** Most mobs hurt players by walking into them; snakes also spit (see MobWeaponSystem). */
export function updateContactDamage(_dt: number): void {
  const mobs = world.with('position', 'radius', 'ai', 'health');
  const players = world.with('position', 'radius', 'playerInput', 'health');

  for (const mob of mobs) {
    if (mob.health!.current <= 0) continue;
    const mpos = mob.position!;
    const mrad = mob.radius!;
    const mbb = BB.fromCenter(mpos.x, mpos.y, mrad.x, mrad.y);

    // Mobs also chew on turrets and harvesters they bump into.
    for (const building of world.with('position', 'radius', 'health', 'building')) {
      if (!building.turret && !building.harvester) continue;
      if (building.carriedBy !== undefined || building.removed || building.health!.current <= 0) continue;
      const bpos = building.position!;
      const brad = building.radius!;
      if (mbb.intersects(BB.fromCenter(bpos.x, bpos.y, brad.x, brad.y))) {
        hurtEntity(building, mob, mob.strength ?? 1);
      }
    }

    for (const player of players) {
      if (player.health!.current <= 0) continue;
      // Gate on hurtTime, not freezeTime: gating on freezeTime while also
      // re-setting it every frame left the player permanently locked.
      if ((player.hurtTime ?? 0) > 0) continue;

      const ppos = player.position!;
      const prad = player.radius!;
      if (!mbb.intersects(BB.fromCenter(ppos.x, ppos.y, prad.x, prad.y))) continue;

      hurtPlayer(player, mob, mob.strength ?? 1);
    }
  }
}

/** Damages a player and shoves them clear of whatever hit them. */
export function hurtPlayer(player: Entity, source: Entity, damage: number): void {
  const h = player.health;
  if (!h || h.immortal || player.falling) return;

  player.hurtTime = PLAYER_HURT_TIME;
  player.freezeTime = PLAYER_FREEZE_TIME;
  player.regenTimer = player.regenInterval ?? 180;
  h.current = Math.max(0, h.current - damage);

  const spos = source.position;
  const ppos = player.position;
  if (spos && ppos) {
    const dx = ppos.x - spos.x;
    const dy = ppos.y - spos.y;
    // If perfectly overlapped, pick an arbitrary direction so they still separate.
    const dist = Math.hypot(dx, dy) || 1;
    player.bump ??= { x: 0, y: 0 };
    player.bump.x = (dx / dist) * PLAYER_KNOCKBACK;
    player.bump.y = (dy / dist) * PLAYER_KNOCKBACK;
  }

  if (ppos) sound.playSound('hit', ppos.x, ppos.y);
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
  // Mobs and nests get a duller thud than the sharp cry a hurt player gives.
  if (tpos) sound.playOneOf(['enemyHit1', 'enemyHit3'], tpos.x, tpos.y);
}
