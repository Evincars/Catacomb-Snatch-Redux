import { Rectangle } from 'pixi.js';
import { world, Team } from '../world';
import type { Entity } from '../world';
import { boxAround } from '../core/geometry';
import { sound } from '../audio/SoundPlayer';
import { gameState } from '../game/GameState';

/**
 * Java's Player.hurt: damage only lands while hurtTime is 0, then 25 ticks of
 * invulnerability, 15 of them frozen, plus a hard shove away from the attacker.
 */
const PLAYER_HURT_TIME = 25;
const PLAYER_FREEZE_TIME = 15;
const PLAYER_KNOCKBACK = 10;
const ENTITY_HURT_TIME = 40;
const ENTITY_KNOCKBACK = 2;
const DEFAULT_REGEN_INTERVAL = 180;
/** Max distance between collision samples along a bullet's path, so fast pellets cannot skip a mob. */
const SWEEP_STEP = 6;

const living = world.with('health');
const bullets = world.with('position', 'bullet', 'radius');
const targets = world.with('position', 'health', 'radius');
const mobs = world.with('position', 'radius', 'ai', 'health');
const players = world.with('position', 'radius', 'playerInput', 'health');
const blockers = world.with('position', 'radius', 'health', 'blocking');

const shotBox = new Rectangle();
const targetBox = new Rectangle();
const mobBox = new Rectangle();

function countDown(entity: Entity, timer: 'hurtTime' | 'freezeTime' | 'bounceWallTime' | 'flashTime'): void {
  const value = entity[timer];
  if (value !== undefined && value > 0) entity[timer] = value - 1;
}

/** Health regen (from Mob.doRegenTime). Neutral things (mobs, nests) only heal on hard difficulties. */
function regenerate(entity: Entity): void {
  const h = entity.health!;
  if (h.immortal) return;
  const unhurt = (entity.hurtTime ?? 0) <= 0;
  // Turrets and harvesters shrug damage off once nothing is hurting them (Java's Building.tick).
  if ((entity.turret || entity.harvester) && unhurt) {
    h.current = h.max;
    return;
  }
  if (entity.team === Team.Neutral && !gameState.difficulty.mobRegen) return;
  if (!unhurt || h.current >= h.max || entity.regenTimer === undefined) return;
  entity.regenTimer--;
  if (entity.regenTimer > 0) return;
  entity.regenTimer = entity.regenInterval ?? DEFAULT_REGEN_INTERVAL;
  h.current = Math.min(h.max, h.current + (entity.regenAmount ?? 1));
}

/** Decrements combat timers and handles regen. Ported from Mob.tick() / countdownTimers(). */
export function updateCombatTimers(_dt: number): void {
  for (const entity of living) {
    if (entity.respawnTicks !== undefined) continue;
    countDown(entity, 'hurtTime');
    countDown(entity, 'freezeTime');
    countDown(entity, 'bounceWallTime');
    countDown(entity, 'flashTime');
    regenerate(entity);
  }
}

/** Whether a bullet may strike this target at all, before any overlap test. */
function canBeShot(bullet: Entity, target: Entity): boolean {
  if (target === bullet || target.removed || target.health!.current <= 0 || target.respawnTicks !== undefined) return false;
  if (target.shopItem || target.chest || target.treasure) return false;
  // Whatever a player holds overhead is out of the line of fire.
  if (target.carriedBy !== undefined) return false;
  // Don't hit the shooter or anyone on their side.
  if (world.id(target) === bullet.bullet!.ownerId) return false;
  if (bullet.team !== undefined && bullet.team !== Team.Neutral && target.team === bullet.team) return false;
  // Shots from neutral mobs only ever find players, never other mobs or nests.
  return bullet.team !== Team.Neutral || target.playerInput !== undefined;
}

/**
 * Where the target is actually drawn (position minus the visual offset), so shots connect with what the
 * player is aiming at rather than with an invisible box down at the entity's feet.
 */
function drawnBox(target: Entity): Rectangle {
  const yOffset = target.yOffset ?? 0;
  return boxAround(target.position!.x, target.position!.y - yOffset, target.radius!.x, target.radius!.y + yOffset / 2, targetBox);
}

function firstTargetIn(bullet: Entity, box: Rectangle): Entity | null {
  for (const target of targets) {
    if (canBeShot(bullet, target) && box.intersects(drawnBox(target))) return target;
  }
  return null;
}

/** Sweeps from where the bullet was last tick to where it is now, returning the first thing it meets. */
function sweepBullet(bullet: Entity): Entity | null {
  const pos = bullet.position!;
  const radius = bullet.radius!;
  const vel = bullet.velocity;
  const travelled = Math.min(vel ? Math.hypot(vel.x, vel.y) : 0, bullet.bullet!.traveledRange);
  const steps = Math.max(1, Math.ceil(travelled / SWEEP_STEP));
  for (let s = 1; s <= steps; s++) {
    const back = vel ? 1 - s / steps : 0;
    const box = boxAround(pos.x - (vel?.x ?? 0) * back, pos.y - (vel?.y ?? 0) * back, radius.x, radius.y, shotBox);
    const hit = firstTargetIn(bullet, box);
    if (hit) return hit;
  }
  return null;
}

function strike(bullet: Entity, hit: Entity): void {
  const damage = bullet.bullet!.damage;
  // A shot does not damage a bomb, it lights it.
  if (hit.bomb) hit.bomb.lit = true;
  else if (!hit.playerInput) hurtEntity(hit, bullet, damage);
  else if ((hit.hurtTime ?? 0) <= 0) hurtPlayer(hit, bullet, damage);
  world.removeComponent(bullet, 'bullet');
  world.addComponent(bullet, 'removed', true);
}

/** Applies damage from a bullet entity to entities it overlaps. */
export function updateBulletCollision(_dt: number): void {
  for (const bullet of bullets) {
    const hit = sweepBullet(bullet);
    if (hit) strike(bullet, hit);
  }
}

/** Mobs also chew on turrets, harvesters and carriages they bump into. */
function chewMachines(mob: Entity, box: Rectangle): void {
  for (const building of blockers) {
    if (!building.turret && !building.harvester && !building.railDroid) continue;
    if (building.carriedBy !== undefined || building.removed || building.health!.current <= 0) continue;
    if (box.intersects(boxAround(building.position!.x, building.position!.y, building.radius!.x, building.radius!.y, targetBox))) {
      hurtEntity(building, mob, mob.strength ?? 1);
    }
  }
}

function bitePlayers(mob: Entity, box: Rectangle): void {
  for (const player of players) {
    // Gate on hurtTime, not freezeTime: gating on freezeTime while also
    // re-setting it every frame left the player permanently locked.
    if (player.health!.current <= 0 || (player.hurtTime ?? 0) > 0) continue;
    if (!box.intersects(boxAround(player.position!.x, player.position!.y, player.radius!.x, player.radius!.y, targetBox))) continue;
    hurtPlayer(player, mob, mob.strength ?? 1);
  }
}

/** Most mobs hurt players by walking into them; snakes also spit (see MobWeaponSystem). */
export function updateContactDamage(_dt: number): void {
  for (const mob of mobs) {
    if (mob.health!.current <= 0) continue;
    const box = boxAround(mob.position!.x, mob.position!.y, mob.radius!.x, mob.radius!.y, mobBox);
    chewMachines(mob, box);
    bitePlayers(mob, box);
  }
}

/** Sets `target.bump` to a shove of `strength` away from `source`; perfectly overlapped, it still picks a way out. */
function shove(target: Entity, source: Entity, strength: number): void {
  const spos = source.position;
  const tpos = target.position;
  if (!spos || !tpos) return;
  const dx = tpos.x - spos.x;
  const dy = tpos.y - spos.y;
  const dist = Math.hypot(dx, dy) || 1;
  target.bump ??= { x: 0, y: 0 };
  target.bump.x = (dx / dist) * strength;
  target.bump.y = (dy / dist) * strength;
}

/** Damages a player and shoves them clear of whatever hit them. */
export function hurtPlayer(player: Entity, source: Entity, damage: number): void {
  const h = player.health;
  if (!h || h.immortal || player.falling || player.respawnTicks !== undefined || h.current <= 0) return;
  const sourceTeam = source.bomb?.ownerTeam ?? source.team;
  if (player.spawnProtected && sourceTeam !== undefined && sourceTeam !== Team.Neutral && sourceTeam !== player.team) return;

  player.hurtTime = PLAYER_HURT_TIME;
  player.freezeTime = PLAYER_FREEZE_TIME;
  player.regenTimer = player.regenInterval ?? DEFAULT_REGEN_INTERVAL;
  h.current = Math.max(0, h.current - damage);
  shove(player, source, PLAYER_KNOCKBACK);
  if (player.position) sound.playSound('hit', player.position.x, player.position.y);
}

export function hurtEntity(target: Entity, source: Entity, damage: number): void {
  const h = target.health;
  if (!h || h.immortal || (target.freezeTime ?? 0) > 0) return;

  target.hurtTime = ENTITY_HURT_TIME;
  target.freezeTime = source.bullet?.freezeTime ?? 5;
  target.regenTimer = target.regenInterval ?? DEFAULT_REGEN_INTERVAL;
  shove(target, source, ENTITY_KNOCKBACK);
  h.current = Math.max(0, h.current - damage);
  // Java's Bullet.collide: a struck enemy gives the dull "Shot 2" thud, not the player's hurt cry.
  if (target.position) sound.playSound('shot2', target.position.x, target.position.y);
}
