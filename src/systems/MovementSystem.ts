import { Rectangle } from 'pixi.js';
import { world } from '../world';
import type { Entity } from '../world';
import type { Level } from '../level/Level';
import { BoxPool, boxAround } from '../core/geometry';
import { aimToFacing8 } from '../render/Facing';
import { screenToWorld } from '../render/Camera';
import { TileType } from '../level/TileType';

type Point = { x: number; y: number };

const EPSILON = 0.01;
/** Speed lost per tick by a sliding building, and the speed below which it settles. */
export const SLIDE_DRAG = 0.8;
const SLIDE_REST = 0.05;
/** How far around a player solid structures are gathered for collision. */
const STRUCTURE_MARGIN = 32;
/** Sprinting speeds a player up by half, unless both hands are full. */
const SPRINT_FACTOR = 1.5;
const KNOCKBACK_FADE = 0.8;
const REST_SPEED = 0.01;

// Bullets are excluded — BulletSystem moves them at constant speed.
const physical = world.with('position', 'velocity', 'radius').without('bullet');
const walkers = world.with('position', 'playerInput', 'playerStats', 'health', 'velocity');
const solids = world.with('position', 'radius', 'blocking');
const sliding = world.with('position', 'radius', 'slide');

const fromBox = new Rectangle();
const nearArea = new Rectangle();
const structureBoxes = new BoxPool();

/** How far `from` may move along x before touching `to`. */
function clampX(from: Rectangle, to: Rectangle, xa: number): number {
  if (to.top >= from.bottom || to.bottom <= from.top) return xa;
  if (xa > 0) {
    const d = to.left - from.right;
    if (d >= 0 && xa > d) return Math.max(0, d - EPSILON);
  } else if (xa < 0) {
    const d = to.right - from.left;
    if (d <= 0 && xa < d) return Math.min(0, d + EPSILON);
  }
  return xa;
}

/** How far `from` may move along y before touching `to`. */
function clampY(from: Rectangle, to: Rectangle, ya: number): number {
  if (to.left >= from.right || to.right <= from.left) return ya;
  if (ya > 0) {
    const d = to.top - from.bottom;
    if (d >= 0 && ya > d) return Math.max(0, d - EPSILON);
  } else if (ya < 0) {
    const d = to.bottom - from.top;
    if (d <= 0 && ya < d) return Math.min(0, d + EPSILON);
  }
  return ya;
}

/** Moves along one axis (the other must be zero) as far as the boxes allow; returns whether it moved. */
function partMove(pos: Point, radius: Point, bbs: readonly Rectangle[], xa: number, ya: number): boolean {
  const from = boxAround(pos.x, pos.y, radius.x, radius.y, fromBox);
  for (const to of bbs) {
    if (from.intersects(to)) continue;
    if (ya === 0) xa = clampX(from, to, xa);
    else if (xa === 0) ya = clampY(from, to, ya);
  }
  if (xa === 0 && ya === 0) return false;
  pos.x += xa;
  pos.y += ya;
  return true;
}

/** Java's Entity.move: x first, then y, each stopped short of the first box in the way. */
export function move(pos: Point, radius: Point, xa: number, ya: number, bbs: readonly Rectangle[], physicsSlide = true): boolean {
  const movedX = partMove(pos, radius, bbs, xa, 0);
  const movedY = partMove(pos, radius, bbs, 0, ya);
  // Without sliding, a diagonal move never reports success (as in the original).
  return (physicsSlide || xa === 0 || ya === 0) && (movedX || movedY);
}

function isStructure(e: Entity, except?: Entity): boolean {
  if (!e.building && !e.spawner && !e.railDroid) return false;
  return e.carriedBy === undefined && !e.removed && e !== except;
}

/** Adds the solid things a player walks around (buildings, nests, carriages) near the box to `out`. */
function addStructureBoxes(out: Rectangle[], x: number, y: number, rx: number, ry: number, except?: Entity): void {
  structureBoxes.reset();
  const area = boxAround(x, y, rx, ry, nearArea).pad(STRUCTURE_MARGIN);
  for (const e of solids) {
    if (!isStructure(e, except)) continue;
    const box = structureBoxes.around(e.position!.x, e.position!.y, e.radius!.x, e.radius!.y);
    if (box.intersects(area)) out.push(box);
  }
}

/** Whether a sliding building may come to rest where it is. */
function restsHere(level: Level, entity: Entity): boolean {
  const { position: pos, radius: r } = entity;
  return entity.bomb ? !!level.getTileAt(pos!.x, pos!.y)?.buildable : level.footprintBuildable(pos!.x, pos!.y, r!.x, r!.y);
}

/**
 * A building just put down glides to a stop. It stops short of walls, other
 * structures and anything it may not stand on, such as track or holes.
 */
export function updateSlides(level: Level): void {
  for (const entity of sliding) {
    const slide = entity.slide!;
    const pos = entity.position!;
    const r = entity.radius!;
    const fromX = pos.x;
    const fromY = pos.y;
    const bbs = level.getClipBBs(pos.x, pos.y, r.x, r.y);
    addStructureBoxes(bbs, pos.x, pos.y, r.x, r.y, entity);
    move(pos, r, slide.x, slide.y, bbs, true);
    if (!restsHere(level, entity)) {
      pos.x = fromX;
      pos.y = fromY;
      slide.x = slide.y = 0;
    }
    slide.x *= SLIDE_DRAG;
    slide.y *= SLIDE_DRAG;
    if (Math.abs(slide.x) < SLIDE_REST && Math.abs(slide.y) < SLIDE_REST) world.removeComponent(entity, 'slide');
  }
}

function settle(value: number, factor: number): number {
  const next = value * factor;
  return Math.abs(next) < REST_SPEED ? 0 : next;
}

/** Walking mobs never step into a pit, whatever pushed them (knockback, a crowd, a bad route). */
function keepMobOutOfPit(level: Level, entity: Entity, fromX: number, fromY: number): void {
  const pos = entity.position!;
  if (!entity.ai || entity.mobType === 'bat' || level.getTileAt(pos.x, pos.y)?.type !== TileType.Hole) return;
  if (level.getTileAt(pos.x, fromY)?.type !== TileType.Hole) pos.y = fromY;
  else if (level.getTileAt(fromX, pos.y)?.type !== TileType.Hole) pos.x = fromX;
  else {
    pos.x = fromX;
    pos.y = fromY;
  }
  entity.velocity!.x = entity.velocity!.y = 0;
  if (entity.bump) entity.bump.x = entity.bump.y = 0;
}

/** Applies one tick of velocity and knockback, then friction. */
function moveBody(level: Level, entity: Entity): void {
  const position = entity.position!;
  const velocity = entity.velocity!;
  const radius = entity.radius!;
  const bump = entity.bump;
  // While frozen the entity is only carried by knockback, never by its own
  // input — this is what pushes a player out of a mob instead of locking them.
  const frozen = (entity.freezeTime ?? 0) > 0;
  const xa = (frozen ? 0 : velocity.x) + (bump?.x ?? 0);
  const ya = (frozen ? 0 : velocity.y) + (bump?.y ?? 0);

  const bbs = level.getClipBBs(position.x, position.y, radius.x, radius.y);
  if (entity.playerInput) addStructureBoxes(bbs, position.x, position.y, radius.x, radius.y);
  const fromX = position.x;
  const fromY = position.y;
  move(position, radius, xa, ya, bbs, entity.physicsSlide !== undefined);
  keepMobOutOfPit(level, entity, fromX, fromY);

  const friction = entity.friction ?? 0.4;
  velocity.x = settle(velocity.x, friction);
  velocity.y = settle(velocity.y, friction);
  if (!bump) return;
  bump.x = settle(bump.x, KNOCKBACK_FADE);
  bump.y = settle(bump.y, KNOCKBACK_FADE);
}

/**
 * Java's sprint: holding the key burns up to maxSprint ticks at 1.5x speed (1.0x while carrying), then
 * locks out until the key is released. The meter refills one tick at a time whenever not sprinting.
 * Returns the speed to walk at this tick.
 */
function updateSprint(entity: Entity, moving: boolean): number {
  const pi = entity.playerInput!;
  const stats = entity.playerStats!;
  const speed = entity.speed ?? 1.0;
  if (!pi.sprint) stats.sprintLocked = false;
  stats.sprinting = moving && pi.sprint && !stats.sprintLocked && stats.sprint < stats.maxSprint;
  if (stats.sprinting) {
    stats.sprint++;
    return speed * (entity.carryingId !== undefined ? 1.0 : SPRINT_FACTOR);
  }
  if (moving && pi.sprint) stats.sprintLocked = true;
  if (stats.sprint > 0) stats.sprint--;
  return speed;
}

/** The directional fire keys aim without the cursor; otherwise the aim follows the cursor in world space. */
function updateAim(entity: Entity): void {
  const pi = entity.playerInput!;
  const aim = entity.aimVector;
  if (!aim) return;
  if (pi.keyAim) {
    aim.x = pi.keyAim.x;
    aim.y = pi.keyAim.y;
    return;
  }
  if (!pi.mouseAiming) return;
  const pos = entity.position!;
  const target = entity.aimWorld ?? screenToWorld(pi.mouseX, pi.mouseY);
  const len = Math.hypot(target.x - pos.x, target.y - pos.y);
  if (len === 0) return;
  aim.x = (target.x - pos.x) / len;
  aim.y = (target.y - pos.y) / len;
}

/** Turns a player's held keys into velocity, sprint, aim and the sprite row to face. */
function steerPlayer(entity: Entity): void {
  const pi = entity.playerInput!;
  const vel = entity.velocity!;
  const moving = pi.up || pi.down || pi.left || pi.right;
  const speed = updateSprint(entity, moving);
  if (pi.up) vel.y -= speed;
  if (pi.down) vel.y += speed;
  if (pi.left) vel.x -= speed;
  if (pi.right) vel.x += speed;
  entity.walkTime = moving ? (entity.walkTime ?? 0) + 1 : 0;
  updateAim(entity);
  // The player sheet has 8 directional rows, so aim maps to one of eight.
  const aim = entity.aimVector;
  if (aim && (aim.x !== 0 || aim.y !== 0)) entity.facing = aimToFacing8(aim.x, aim.y);
  else if (moving) entity.facing = aimToFacing8(vel.x, vel.y);
}

export function updateMovement(level: Level, _dt: number): void {
  for (const entity of physical) {
    if (entity.respawnTicks === undefined) {
      moveBody(level, entity);
      continue;
    }
    entity.velocity!.x = entity.velocity!.y = 0;
    if (entity.bump) entity.bump.x = entity.bump.y = 0;
  }
  for (const entity of walkers) {
    if (entity.respawnTicks !== undefined || entity.health!.current <= 0 || (entity.freezeTime ?? 0) > 0) continue;
    steerPlayer(entity);
  }
}
