import { drive } from './driving';
import { world } from '../../world';
import type { Entity } from '../../world';
import type { Level } from '../../level/Level';
import { TileType } from '../../level/TileType';
import type { AIDifficulty } from '../../game/GameState';
import { WEAPON_STATS } from '../../entities/WeaponStats';
import { BULLET_CONFIGS } from '../../entities/BulletFactory';
import { hitByAimLine, INTERACT_REACH } from '../../systems/TargetingSystem';
import { BLACKLIST_TICKS, JAM_AVOID_TICKS, JAM_DISTANCE, JAM_TICKS, STUCK_TICKS, SWAP_DELAY } from '../constants';
import { aimAtNothing, setAim, settleKeys, steerTo } from './steering';
import { bestSlot, bombInLine, bouncingSlot, kickedIntoPit } from '../perception/arsenal';
import { crowdEscape, hostile } from '../perception/awareness';
import { clearOfBlast } from '../perception/demolition';
import { alive, centreX, centreY, dist, tileOf } from '../perception/geometry';
import type { Aim, Brain, Controls, Goal } from '../types';

/** Pixels off a tile's centre that still count as standing in its middle. */
const CENTRED = 6;
/** A heading counts towards an axis key only when it leans that way at least this much. */
const KEY_LEAN = 0.38;
/** How far a walker looks for the edge of a pit before stepping, and how close to one it leans back. */
const PIT_REACH = 14;
const PIT_EDGE = 6;
/** Ticks it keeps trying to fetch a building put down for a fight. */
const RETRIEVE_TICKS = 60 * 40;

/** What this tick's controls have settled so far: whether the aim is spoken for, and whether to fire. */
type Act = { aimed: boolean; shooting: boolean };

/** One AI runs at a time, so its controls are written into these instead of fresh objects every tick. */
const out: Controls = { up: false, down: false, left: false, right: false, sprint: false };
const act: Act = { aimed: false, shooting: false };

/** Faces a building and reports whether what the aim line meets is one of its own that it may lift. */
export function liftsOwnBuilding(entity: Entity, target: Entity): boolean {
  const pos = entity.position!;
  const at = target.position!;
  if (dist(pos, at) > INTERACT_REACH + (target.radius?.x ?? 10)) return false;
  setAim(entity, at.x - pos.x, at.y - pos.y);
  const hit = hitByAimLine(entity);
  return hit !== null && hit.building !== undefined && hit.team === entity.team && !hit.bomb;
}

/** Faces an entity and reports whether it is the one the aim line would act on. */
export function reachFor(entity: Entity, target: Entity): boolean {
  const pos = entity.position!;
  const at = target.position!;
  if (dist(pos, at) > INTERACT_REACH + (target.radius?.x ?? 10)) return false;
  setAim(entity, at.x - pos.x, at.y - pos.y);
  return hitByAimLine(entity) === target;
}

export function clearIntents(entity: Entity): void {
  const it = entity.playerInput!.intents;
  it.weaponSlot = -1;
  it.weaponStep = 0;
  it.use = false;
  it.build = false;
  it.upgrade = false;
  it.dropWeapon = false;
}

function heldBy(entity: Entity): Entity | undefined {
  return entity.carryingId !== undefined ? world.entity(entity.carryingId) : undefined;
}

/** The goal is done with; it plans again within `ticks`. */
function finishGoal(brain: Brain, ticks: number): void {
  brain.goal = null;
  brain.think = Math.min(brain.think, ticks);
}

/** Lifts the building the aim line meets, to get out from between its own buildings. */
function liftBuilding(entity: Entity, brain: Brain): void {
  act.aimed = true;
  brain.path = [];
  entity.playerInput!.intents.build = true;
  finishGoal(brain, 4);
}

/** Presses the key the goal is about on the entity in reach: upgrade, lift or use. */
function pressOnTarget(entity: Entity, brain: Brain, goal: Goal): void {
  const intents = entity.playerInput!.intents;
  act.aimed = true;
  brain.path = [];
  if (goal.upgradeId !== undefined) intents.upgrade = true;
  else if (goal.pickupId !== undefined) intents.build = true;
  else intents.use = true;
  finishGoal(brain, 4);
}

/** Remembers what was just put down: a bomb to set off or keep, a turret placed, a building to fetch after a fight. */
function rememberDropped(brain: Brain, goal: Goal, held: Entity): void {
  // Only a bomb set against a wall is meant to go off; any other is kept for later.
  if (held.bomb && goal.faceTile !== undefined) brain.blastId = world.id(held);
  else if (held.bomb) brain.looseBombId = world.id(held);
  if (held.turret) brain.front = undefined;
  if (held.bomb || goal.name !== 'stash fight') return;
  brain.retrieveId = world.id(held);
  brain.retrieveUntil = brain.age + RETRIEVE_TICKS;
}

/** Puts the load down here, facing the wall a bomb is meant for, or facing open floor. */
function dropLoad(level: Level, entity: Entity, brain: Brain, goal: Goal): void {
  const pos = entity.position!;
  const held = heldBy(entity);
  if (goal.faceTile !== undefined) {
    setAim(entity, centreX(goal.faceTile % level.width) - pos.x, centreY(Math.floor(goal.faceTile / level.width)) - pos.y);
  } else {
    aimAtNothing(entity);
  }
  act.aimed = true;
  entity.playerInput!.intents.use = true;
  if (held) rememberDropped(brain, goal, held);
  finishGoal(brain, 8);
}

/** From cover with a clear shot, fires at its own bomb until it is lit. */
function detonate(level: Level, entity: Entity, brain: Brain): void {
  const pos = entity.position!;
  const bomb = brain.blastId !== undefined ? world.entity(brain.blastId) : undefined;
  if (!bomb || bomb.removed || !bomb.bomb || !clearOfBlast(entity, bomb)) return;
  const at = bomb.position!;
  if (!level.checkLineOfSight(pos.x, pos.y, at.x, at.y)) return;
  setAim(entity, at.x - pos.x, at.y - (bomb.yOffset ?? 0) - pos.y);
  act.aimed = true;
  act.shooting = !bomb.bomb.lit;
  brain.path = [];
}

/** Lays track on the goal tile, or a carriage on its base track, when the floor is ready for it. */
function build(level: Level, entity: Entity, brain: Brain, goal: Goal): void {
  const tile = level.getTile(goal.tile % level.width, Math.floor(goal.tile / level.width));
  const ready = goal.build === 'rail'
    ? tile?.buildable === true
    : tile?.type === TileType.PlayerRail && tile.team === entity.team;
  if (ready && aimAtNothing(entity)) {
    act.aimed = true;
    entity.playerInput!.intents.build = true;
    if (goal.build === 'carriage') brain.lastCarriageAt = brain.age;
    else brain.railsSinceUpgrade++;
  }
  finishGoal(brain, 6);
}

/** Closes in on the prey; in range and in sight it holds still and lets the fighting code shoot. */
function hunt(entity: Entity, brain: Brain, profile: AIDifficulty, huntId: number): void {
  const prey = world.entity(huntId);
  if (!alive(prey)) {
    brain.path = [];
    brain.goal = null;
    return;
  }
  // The goal stays so the aim stays on it.
  if (brain.enemyId === huntId && dist(entity.position!, prey.position!) < profile.engageRange * 0.6) brain.path = [];
}

/** The goal's own action, once it is there; the first that applies wins, in this order. */
function pursueGoal(level: Level, entity: Entity, brain: Brain, profile: AIDifficulty, goal: Goal): void {
  const pos = entity.position!;
  const targetId = goal.useId ?? goal.upgradeId ?? goal.pickupId;
  const target = targetId !== undefined ? world.entity(targetId) : undefined;
  const tx = goal.tile % level.width;
  const ty = Math.floor(goal.tile / level.width);
  const onTile = tileOf(level, pos.x, pos.y) === goal.tile;
  const centred = Math.abs(pos.x - centreX(tx)) <= CENTRED && Math.abs(pos.y - centreY(ty)) <= CENTRED;
  const routeDone = brain.path.length === 0;

  // Any building of its own in the way will do to get out from between them.
  if (goal.pickupId !== undefined && target && liftsOwnBuilding(entity, target)) return liftBuilding(entity, brain);
  if (target && goal.pickupId === undefined && reachFor(entity, target)) return pressOnTarget(entity, brain, goal);
  // Close but at an awkward angle: shuffle straight towards it.
  if (target && dist(pos, target.position!) <= INTERACT_REACH + 4 && routeDone) {
    return steerTo(entity, target.position!.x, target.position!.y, 2, out);
  }
  if (goal.drop && (goal.stash || (onTile && centred))) return dropLoad(level, entity, brain, goal);
  if (goal.detonate && (onTile || routeDone)) return detonate(level, entity, brain);
  if (goal.build && onTile && centred && (entity.railCooldown ?? 0) === 0) return build(level, entity, brain, goal);
  if (goal.walk && (onTile || routeDone)) {
    brain.goal = null;
    return;
  }
  if (goal.huntId !== undefined) hunt(entity, brain, profile, goal.huntId);
}

/**
 * Drops route tiles already passed (cutting across open floor passes tiles off-centre, so stepping into one
 * counts) and returns the tile it is now heading for, before that one too is dropped once reached.
 */
function trimPassedTiles(level: Level, entity: Entity, brain: Brain): number {
  const pos = entity.position!;
  const k = brain.path.indexOf(tileOf(level, pos.x, pos.y));
  if (k >= 0 && k < brain.path.length - 1) brain.path.splice(0, k + 1);
  const next = brain.path[0];
  const nx = centreX(next % level.width);
  const ny = centreY(Math.floor(next / level.width));
  if (Math.abs(pos.x - nx) <= 3 && Math.abs(pos.y - ny) <= 3) brain.path.shift();
  return next;
}

/** Walks the route; at its end (or with no route) steps onto the very tile a drop or build needs. */
function walkRoute(level: Level, entity: Entity, brain: Brain, profile: AIDifficulty, goal: Goal | null): void {
  if (brain.path.length === 0) {
    if (goal && (goal.drop || goal.build)) steerTo(entity, centreX(goal.tile % level.width), centreY(Math.floor(goal.tile / level.width)), 2.5, out);
    return;
  }
  const next = trimPassedTiles(level, entity, brain);
  if (brain.path.length > 0) {
    drive(level, entity, brain, out);
    out.sprint = profile.sprint && brain.path.length > 6 && entity.carryingId === undefined;
  } else if (goal && !goal.walk) {
    steerTo(entity, centreX(next % level.width), centreY(Math.floor(next / level.width)), 2.5, out);
  }
}

/** Gives up on a route that goes nowhere (a carriage jammed in a tunnel, a crowd in a corridor). */
function watchForJam(level: Level, entity: Entity, brain: Brain, goal: Goal | null): void {
  if (brain.path.length === 0 || goal?.detonate) {
    brain.walkWatch = null;
    return;
  }
  const pos = entity.position!;
  const watch = brain.walkWatch ?? (brain.walkWatch = { x: pos.x, y: pos.y, ticks: 0 });
  if (++watch.ticks < JAM_TICKS) return;
  brain.walkWatch = null;
  if (Math.hypot(pos.x - watch.x, pos.y - watch.y) >= JAM_DISTANCE) return;
  // Route around the next few tiles for a while; it re-plans at once and picks another way or another goal.
  const here = tileOf(level, pos.x, pos.y);
  for (let i = 0; i < Math.min(3, brain.path.length); i++) {
    if (brain.path[i] !== here) brain.avoid.set(brain.path[i], brain.age + JAM_AVOID_TICKS);
  }
  const id = goal?.useId ?? goal?.upgradeId ?? goal?.huntId;
  if (id !== undefined) brain.blacklist.set(id, brain.age + BLACKLIST_TICKS);
  brain.goal = null;
  brain.path = [];
  brain.think = 0;
}

function anyKey(): boolean {
  return out.up || out.down || out.left || out.right;
}

/** Holds the arrow keys that lean towards (x, y). */
function leanKeys(x: number, y: number): void {
  out.right = x > KEY_LEAN;
  out.left = x < -KEY_LEAN;
  out.down = y > KEY_LEAN;
  out.up = y < -KEY_LEAN;
}

/** Walking without getting anywhere means something is in the way: step aside in a random direction for a moment. */
function unstick(entity: Entity, brain: Brain, moving: boolean): void {
  const pos = entity.position!;
  if (moving && Math.hypot(pos.x - brain.lastX, pos.y - brain.lastY) < 0.3) brain.stuck++;
  else brain.stuck = 0;
  brain.lastX = pos.x;
  brain.lastY = pos.y;
  if (brain.stuck > STUCK_TICKS) {
    const angle = Math.random() * Math.PI * 2;
    brain.sidestep = { x: Math.cos(angle), y: Math.sin(angle), ticks: 10 + Math.floor(Math.random() * 10) };
    brain.stuck = 0;
    brain.think = 0;
  }
  if (!brain.sidestep) return;
  leanKeys(brain.sidestep.x, brain.sidestep.y);
  if (--brain.sidestep.ticks <= 0) brain.sidestep = null;
}

/** Re-rolls, every so often, whether it pulls the trigger and how far off its aim wobbles. */
function rollTrigger(brain: Brain, profile: AIDifficulty): void {
  if (brain.reaction > 0) brain.reaction--;
  if (--brain.triggerTicks > 0) return;
  brain.trigger = Math.random() < profile.fireRate;
  brain.triggerTicks = 8 + Math.floor(Math.random() * 10);
  brain.jitter = (Math.random() * 2 - 1) * profile.aimError;
}

/** Switches to whichever gun suits the distance and what the target is doing. */
function chooseGun(level: Level, entity: Entity, brain: Brain, d: number, aim: Aim): void {
  const inv = entity.weaponInventory!;
  if (brain.swapTicks > 0) brain.swapTicks--;
  const slot = aim.bank ? bouncingSlot(entity) : bestSlot(entity, d, (w) => !kickedIntoPit(level, entity, w), aim);
  if (slot < 0 || slot === inv.current || (brain.swapTicks > 0 && !aim.bank)) return;
  entity.playerInput!.intents.weaponSlot = slot;
  brain.swapTicks = SWAP_DELAY;
}

function currentGun(entity: Entity) {
  const inv = entity.weaponInventory!;
  return BULLET_CONFIGS[WEAPON_STATS[inv.weapons[inv.current]]?.bullet];
}

/** Stands still and fires the ricochet that was worked out for this very spot. */
function bankShot(entity: Entity, brain: Brain, shot: NonNullable<Brain['bank']>): void {
  const angle = shot.shot.angle + brain.jitter * 0.3;
  setAim(entity, Math.cos(angle), Math.sin(angle));
  act.shooting = brain.reaction <= 0 && brain.trigger && (currentGun(entity)?.bounces ?? 0) > 0 && brain.age - shot.at < 8;
  out.up = out.down = out.left = out.right = out.sprint = false;
  brain.sidestep = null;
}

/** Aims straight at the enemy, leading a moving one on the better difficulties, and keeps biters at arm's length. */
function directShot(entity: Entity, brain: Brain, profile: AIDifficulty, enemy: Entity, moving: boolean): void {
  const pos = entity.position!;
  const at = enemy.position!;
  const d = dist(at, pos);
  // Lead moving targets by the time this gun's shot takes to arrive.
  const lead = profile.aimError < 0.2 && enemy.velocity ? Math.min(30, d / (currentGun(entity)?.speed ?? 8)) : 0;
  const ax = at.x + (enemy.velocity?.x ?? 0) * lead - pos.x;
  const ay = at.y - (enemy.yOffset ?? 0) / 2 + (enemy.velocity?.y ?? 0) * lead - pos.y;
  const angle = Math.atan2(ay, ax) + brain.jitter;
  setAim(entity, Math.cos(angle), Math.sin(angle));
  act.shooting = brain.reaction <= 0 && brain.trigger && !bombInLine(entity, Math.atan2(ay, ax), d);
  // Keep some distance from things that bite, when not walking anywhere in particular.
  if (!moving && enemy.ai && d < 40) steerTo(entity, pos.x * 2 - at.x, pos.y * 2 - at.y, 0, out);
}

/** A bomb of ours lying unlit where a rival player stands within its blast, while we stand clear of it. */
function bombTrap(entity: Entity, brain: Brain, enemy: Entity): Entity | null {
  if (!enemy.playerInput) return null;
  for (const id of [brain.looseBombId, brain.blastId]) {
    const bomb = id !== undefined ? world.entity(id) : undefined;
    if (!bomb?.bomb || bomb.removed || bomb.bomb.lit || bomb.carriedBy !== undefined) continue;
    if (!clearOfBlast(enemy, bomb) && clearOfBlast(entity, bomb)) return bomb;
  }
  return null;
}

/** Shoots its own bomb to light it under the rival standing beside it. */
function springTrap(entity: Entity, brain: Brain, profile: AIDifficulty, bomb: Entity): void {
  const pos = entity.position!;
  const at = bomb.position!;
  rollTrigger(brain, profile);
  setAim(entity, at.x - pos.x, at.y - (bomb.yOffset ?? 0) - pos.y);
  act.shooting = brain.reaction <= 0 && brain.trigger;
  act.aimed = true;
}

/** Turns on the current enemy: picks the gun, aims, and decides whether to fire. */
function fight(level: Level, entity: Entity, brain: Brain, profile: AIDifficulty, goal: Goal | null, moving: boolean): void {
  const enemy = brain.enemyId !== undefined ? world.entity(brain.enemyId) : undefined;
  const busy = act.aimed || entity.carryingId !== undefined || goal?.name === 'escape blast';
  // A rival who has stepped into their own base cannot be hurt, so no shots are wasted on them.
  if (busy || !alive(enemy) || !hostile(entity, enemy)) return;
  const pos = entity.position!;
  const at = enemy.position!;
  // A rival who walks up to one of our bombs gets it set off under them.
  const trap = bombTrap(entity, brain, enemy);
  if (trap && level.checkLineOfSight(pos.x, pos.y, trap.position!.x, trap.position!.y)) return springTrap(entity, brain, profile, trap);
  // Out of sight, the only way to reach it is a shot that banks off the walls.
  const seen = level.checkLineOfSight(pos.x, pos.y, at.x, at.y);
  const bank = !seen && brain.bank?.targetId === brain.enemyId ? brain.bank : null;
  if (!seen && !bank) return;
  rollTrigger(brain, profile);
  const speed = Math.hypot(enemy.velocity?.x ?? 0, enemy.velocity?.y ?? 0);
  chooseGun(level, entity, brain, dist(at, pos), { speed, bank: bank !== null });
  if (bank) bankShot(entity, brain, bank);
  else directShot(entity, brain, profile, enemy, moving);
  act.aimed = true;
}

/** Backpedals out of a pack of mobs rather than walking through it; the gun keeps working. */
function escapeCrowd(level: Level, entity: Entity, brain: Brain, profile: AIDifficulty, goal: Goal | null): void {
  // With a bomb in hand there is no gun to cover the retreat: it runs for the wall instead.
  if (heldBy(entity)?.bomb !== undefined) {
    out.sprint = profile.sprint;
    return;
  }
  const intents = entity.playerInput!.intents;
  const interacting = act.aimed && (intents.use || intents.build || intents.upgrade);
  if (goal?.name === 'escape blast' || brain.sidestep || interacting) return;
  const close = crowdEscape(level, entity, 44);
  const pack = close ?? crowdEscape(level, entity, 88);
  const hurt = entity.health!.current < entity.health!.max * 0.6;
  if (!pack || (!close && !(hurt && pack.count >= 3))) return;
  const pos = entity.position!;
  steerTo(entity, pos.x + pack.x * 100, pos.y + pack.y * 100, 0.2, out);
  out.sprint = profile.sprint;
}

/** With nothing to aim at, it looks where it walks. */
function aimAlongWalk(entity: Entity): void {
  if (act.aimed) return;
  const vx = (out.right ? 1 : 0) - (out.left ? 1 : 0);
  const vy = (out.down ? 1 : 0) - (out.up ? 1 : 0);
  if (vx !== 0 || vy !== 0) setAim(entity, vx, vy);
}

function isPit(level: Level, x: number, y: number): boolean {
  const type = level.getTileAt(x, y)?.type;
  return type === TileType.Hole || type === TileType.DropTrap;
}

/** Never steps over the edge of a pit, whatever the steering above wanted, and leans back from one it is pushed towards. */
function keepOffPits(level: Level, entity: Entity): void {
  const pos = entity.position!;
  // Knockback fades by a fifth a tick, so it carries about five times its strength.
  const kx = pos.x + (entity.bump?.x ?? 0) * 5;
  const ky = pos.y + (entity.bump?.y ?? 0) * 5;
  if (out.left && isPit(level, kx - PIT_REACH, pos.y)) out.left = false;
  if (out.right && isPit(level, kx + PIT_REACH, pos.y)) out.right = false;
  if (out.up && isPit(level, pos.x, ky - PIT_REACH)) out.up = false;
  if (out.down && isPit(level, pos.x, ky + PIT_REACH)) out.down = false;
  // Too close to an edge, or being knocked towards one: lean back against it.
  if (isPit(level, pos.x - PIT_EDGE, pos.y) !== isPit(level, pos.x + PIT_EDGE, pos.y)) {
    out.right = isPit(level, pos.x - PIT_EDGE, pos.y);
    out.left = !out.right;
  }
  if (isPit(level, pos.x, pos.y - PIT_EDGE) !== isPit(level, pos.x, pos.y + PIT_EDGE)) {
    out.down = isPit(level, pos.x, pos.y - PIT_EDGE);
    out.up = !out.down;
  }
  if (isPit(level, kx + Math.sign(kx - pos.x) * PIT_EDGE, pos.y)) {
    out.left = kx > pos.x;
    out.right = kx < pos.x;
  }
  if (isPit(level, pos.x, ky + Math.sign(ky - pos.y) * PIT_EDGE)) {
    out.up = ky > pos.y;
    out.down = ky < pos.y;
  }
}

/** Presses the keys a person would: what was settled above becomes this tick's input. */
function pressKeys(level: Level, entity: Entity): void {
  const pi = entity.playerInput!;
  const inv = entity.weaponInventory!;
  // A gun's kick shoves the shooter back; hold fire rather than be knocked into a pit.
  const shooting = act.shooting && !kickedIntoPit(level, entity, inv.weapons[inv.current]);
  pi.up = out.up;
  pi.down = out.down;
  pi.left = out.left;
  pi.right = out.right;
  pi.sprint = out.sprint;
  pi.shoot = shooting;
  pi.mouseAiming = false;
}

function resetControls(): void {
  out.up = out.down = out.left = out.right = out.sprint = false;
  act.aimed = act.shooting = false;
}

/** One tick of a computer player's hands: the goal's action, walking, fighting and staying out of pits. */
export function control(level: Level, entity: Entity, brain: Brain, profile: AIDifficulty): void {
  resetControls();
  const goal = brain.goal;
  if (goal) pursueGoal(level, entity, brain, profile, goal);
  walkRoute(level, entity, brain, profile, goal);
  watchForJam(level, entity, brain, goal);
  const moving = anyKey();
  unstick(entity, brain, moving);
  // Both go by the goal it started the tick with, even if that goal was just completed.
  fight(level, entity, brain, profile, goal, moving);
  escapeCrowd(level, entity, brain, profile, goal);
  settleKeys(brain, out);
  aimAlongWalk(entity);
  keepOffPits(level, entity);
  pressKeys(level, entity);
}
