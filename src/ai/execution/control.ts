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
import type { Aim, Brain, Controls } from '../types';

/** Faces an entity and reports whether it is the one the aim line would act on. */
/** Faces a building and reports whether what the aim line meets is one of its own that it may lift. */
export function liftsOwnBuilding(entity: Entity, target: Entity): boolean {
  const pos = entity.position!;
  const at = target.position!;
  if (dist(pos, at) > INTERACT_REACH + (target.radius?.x ?? 10)) return false;
  setAim(entity, at.x - pos.x, at.y - pos.y);
  const hit = hitByAimLine(entity);
  return hit !== null && hit.building !== undefined && hit.team === entity.team && !hit.bomb;
}

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
}

export function control(level: Level, entity: Entity, brain: Brain, profile: AIDifficulty): void {
  const pi = entity.playerInput!;
  const pos = entity.position!;
  const out: Controls = { up: false, down: false, left: false, right: false, sprint: false };
  let aimed = false;
  let shooting = false;
  const goal = brain.goal;

  // --- the goal's action, once there
  if (goal) {
    const targetId = goal.useId ?? goal.upgradeId ?? goal.pickupId;
    const target = targetId !== undefined ? world.entity(targetId) : undefined;
    const tx = goal.tile % level.width;
    const ty = Math.floor(goal.tile / level.width);
    const onTile = tileOf(level, pos.x, pos.y) === goal.tile;
    const centred = Math.abs(pos.x - centreX(tx)) <= 6 && Math.abs(pos.y - centreY(ty)) <= 6;

    if (goal.pickupId !== undefined && target && liftsOwnBuilding(entity, target)) {
      // Any building of its own in the way will do to get out from between them.
      aimed = true;
      brain.path = [];
      pi.intents.build = true;
      brain.goal = null;
      brain.think = Math.min(brain.think, 4);
    } else if (target && goal.pickupId === undefined && reachFor(entity, target)) {
      aimed = true;
      brain.path = [];
      if (goal.upgradeId !== undefined) pi.intents.upgrade = true;
      else if (goal.pickupId !== undefined) pi.intents.build = true;
      else pi.intents.use = true;
      brain.goal = null;
      brain.think = Math.min(brain.think, 4);
    } else if (target && dist(pos, target.position!) <= INTERACT_REACH + 4 && brain.path.length === 0) {
      // Close but at an awkward angle: shuffle straight towards it.
      steerTo(entity, target.position!.x, target.position!.y, 2, out);
    } else if (goal.drop && (goal.stash || (onTile && centred))) {
      const held = entity.carryingId !== undefined ? world.entity(entity.carryingId) : undefined;
      if (goal.faceTile !== undefined) {
        const fx = centreX(goal.faceTile % level.width);
        const fy = centreY(Math.floor(goal.faceTile / level.width));
        setAim(entity, fx - pos.x, fy - pos.y);
      } else aimAtNothing(entity);
      aimed = true;
      pi.intents.use = true;
      if (held?.bomb) {
        // Only a bomb set against a wall is meant to go off; any other is kept for later.
        if (goal.faceTile !== undefined) brain.blastId = world.id(held);
        else brain.looseBombId = world.id(held);
      }
      if (held?.turret) brain.front = undefined;
      if (held && !held.bomb && goal.name === 'stash fight') {
        brain.retrieveId = world.id(held);
        brain.retrieveUntil = brain.age + 60 * 40;
      }
      brain.goal = null;
      brain.think = Math.min(brain.think, 8);
    } else if (goal.detonate && (onTile || brain.path.length === 0)) {
      const bomb = brain.blastId !== undefined ? world.entity(brain.blastId) : undefined;
      if (bomb && !bomb.removed && bomb.bomb && clearOfBlast(entity, bomb)
        && level.checkLineOfSight(pos.x, pos.y, bomb.position!.x, bomb.position!.y)) {
        const at = bomb.position!;
        setAim(entity, at.x - pos.x, at.y - (bomb.yOffset ?? 0) - pos.y);
        aimed = true;
        shooting = !bomb.bomb.lit;
        brain.path = [];
      }
    } else if (goal.build && onTile && centred && (entity.railCooldown ?? 0) === 0) {
      const tile = level.getTile(tx, ty);
      const ready = goal.build === 'rail'
        ? tile?.buildable === true
        : tile?.type === TileType.PlayerRail && tile.team === entity.team;
      if (ready && aimAtNothing(entity)) {
        aimed = true;
        pi.intents.build = true;
        if (goal.build === 'carriage') brain.lastCarriageAt = brain.age;
        else brain.railsSinceUpgrade++;
      }
      brain.goal = null;
      brain.think = Math.min(brain.think, 6);
    } else if (goal.walk && (onTile || brain.path.length === 0)) {
      brain.goal = null;
    } else if (goal.huntId !== undefined) {
      const prey = world.entity(goal.huntId);
      if (!alive(prey)) {
        brain.path = [];
        brain.goal = null;
      } else if (brain.enemyId === goal.huntId && dist(pos, prey.position!) < profile.engageRange * 0.6) {
        // In range and in sight: hold here and shoot; the goal stays so the aim stays on it.
        brain.path = [];
      }
    }
  }

  // --- walking the path
  if (brain.path.length > 0) {
    // Cutting across open floor passes tiles off-centre: stepping into one counts as passing it.
    const k = brain.path.indexOf(tileOf(level, pos.x, pos.y));
    if (k >= 0 && k < brain.path.length - 1) brain.path.splice(0, k + 1);
    const next = brain.path[0];
    const nx = centreX(next % level.width);
    const ny = centreY(Math.floor(next / level.width));
    if (Math.abs(pos.x - nx) <= 3 && Math.abs(pos.y - ny) <= 3) brain.path.shift();
    if (brain.path.length > 0) {
      drive(level, entity, brain, out);
      out.sprint = profile.sprint && brain.path.length > 6 && entity.carryingId === undefined;
    } else if (goal && !goal.walk) {
      steerTo(entity, nx, ny, 2.5, out);
    }
  } else if (goal && (goal.drop || goal.build)) {
    const tx = goal.tile % level.width;
    steerTo(entity, centreX(tx), centreY(Math.floor(goal.tile / level.width)), 2.5, out);
  }

  // --- giving up on a route that goes nowhere (a carriage jammed in a tunnel, a crowd in a corridor)
  if (brain.path.length > 0 && !goal?.detonate) {
    const watch = brain.walkWatch ?? (brain.walkWatch = { x: pos.x, y: pos.y, ticks: 0 });
    if (++watch.ticks >= JAM_TICKS) {
      if (Math.hypot(pos.x - watch.x, pos.y - watch.y) < JAM_DISTANCE) {
        const here = tileOf(level, pos.x, pos.y);
        // Route around the next few tiles for a while; it re-plans at once and picks another way or another goal.
        for (const t of brain.path.slice(0, 3)) if (t !== here) brain.avoid.set(t, brain.age + JAM_AVOID_TICKS);
        const id = goal?.useId ?? goal?.upgradeId ?? goal?.huntId;
        if (id !== undefined) brain.blacklist.set(id, brain.age + BLACKLIST_TICKS);
        brain.goal = null;
        brain.path = [];
        brain.think = 0;
      }
      brain.walkWatch = null;
    }
  } else brain.walkWatch = null;

  // --- unsticking
  const moving = out.up || out.down || out.left || out.right;
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
  if (brain.sidestep) {
    out.right = brain.sidestep.x > 0.38;
    out.left = brain.sidestep.x < -0.38;
    out.down = brain.sidestep.y > 0.38;
    out.up = brain.sidestep.y < -0.38;
    if (--brain.sidestep.ticks <= 0) brain.sidestep = null;
  }

  // --- fighting
  const enemy = brain.enemyId !== undefined ? world.entity(brain.enemyId) : undefined;
  // A rival who has stepped into their own base cannot be hurt, so no shots are wasted on them.
  if (alive(enemy) && hostile(entity, enemy) && !aimed && entity.carryingId === undefined && goal?.name !== 'escape blast') {
    const at = enemy.position!;
    const d = dist(at, pos);
    const inv = entity.weaponInventory!;
    // Out of sight, the only way to reach it is a shot that banks off the walls.
    const seen = level.checkLineOfSight(pos.x, pos.y, at.x, at.y);
    const bank = !seen && brain.bank?.targetId === brain.enemyId ? brain.bank : null;
    if (seen || bank) {
      if (brain.reaction > 0) brain.reaction--;
      if (--brain.triggerTicks <= 0) {
        brain.trigger = Math.random() < profile.fireRate;
        brain.triggerTicks = 8 + Math.floor(Math.random() * 10);
        brain.jitter = (Math.random() * 2 - 1) * profile.aimError;
      }
      const speed = Math.hypot(enemy.velocity?.x ?? 0, enemy.velocity?.y ?? 0);
      const aim: Aim = { speed, bank: bank !== null };

      // Switch to whichever gun suits the distance and what the target is doing.
      if (brain.swapTicks > 0) brain.swapTicks--;
      const slot = bank ? bouncingSlot(entity) : bestSlot(entity, d, (w) => !kickedIntoPit(level, entity, w), aim);
      if (slot >= 0 && slot !== inv.current && (brain.swapTicks <= 0 || bank)) {
        pi.intents.weaponSlot = slot;
        brain.swapTicks = SWAP_DELAY;
      }
      const gun = BULLET_CONFIGS[WEAPON_STATS[inv.weapons[inv.current]]?.bullet];

      if (bank) {
        // Stand still while the shot is lined up: it was worked out for this very spot.
        const angle = bank.shot.angle + brain.jitter * 0.3;
        setAim(entity, Math.cos(angle), Math.sin(angle));
        shooting = brain.reaction <= 0 && brain.trigger && (gun?.bounces ?? 0) > 0 && brain.age - bank.at < 8;
        out.up = out.down = out.left = out.right = out.sprint = false;
        brain.sidestep = null;
      } else {
        // Lead moving targets, by the time this gun's shot takes to arrive, on the better difficulties.
        const lead = profile.aimError < 0.2 && enemy.velocity ? Math.min(30, d / (gun?.speed ?? 8)) : 0;
        const ax = at.x + (enemy.velocity?.x ?? 0) * lead - pos.x;
        const ay = at.y - (enemy.yOffset ?? 0) / 2 + (enemy.velocity?.y ?? 0) * lead - pos.y;
        const angle = Math.atan2(ay, ax) + brain.jitter;
        setAim(entity, Math.cos(angle), Math.sin(angle));
        shooting = brain.reaction <= 0 && brain.trigger && !bombInLine(entity, Math.atan2(ay, ax), d);
        // Keep some distance from things that bite, when not walking anywhere in particular.
        if (!moving && enemy.ai && d < 40) steerTo(entity, pos.x * 2 - at.x, pos.y * 2 - at.y, 0, out);
      }
      aimed = true;
    }
  }

  // Backpedal out of a pack of mobs rather than walking through it; the gun keeps working.
  // With a bomb in hand there is no gun to cover the retreat: it runs for the wall instead.
  const bombInHand = entity.carryingId !== undefined && world.entity(entity.carryingId)?.bomb !== undefined;
  if (bombInHand) out.sprint = profile.sprint;
  else if (goal?.name !== 'escape blast' && !brain.sidestep && !(aimed && (pi.intents.use || pi.intents.build || pi.intents.upgrade))) {
    const close = crowdEscape(level, entity, 44);
    const pack = close ?? crowdEscape(level, entity, 88);
    const hurt = entity.health!.current < entity.health!.max * 0.6;
    if (pack && (close || (hurt && pack.count >= 3))) {
      steerTo(entity, pos.x + pack.x * 100, pos.y + pack.y * 100, 0.2, out);
      out.sprint = profile.sprint;
    }
  }

  settleKeys(brain, out);

  if (!aimed) {
    const vx = (out.right ? 1 : 0) - (out.left ? 1 : 0);
    const vy = (out.down ? 1 : 0) - (out.up ? 1 : 0);
    if (vx !== 0 || vy !== 0) setAim(entity, vx, vy);
  }

  // Never step over the edge of a pit, whatever the steering above wanted.
  const pit = (x: number, y: number) => {
    const type = level.getTileAt(x, y)?.type;
    return type === TileType.Hole || type === TileType.DropTrap;
  };
  // Knockback fades by a fifth a tick, so it carries about five times its strength.
  const kx = pos.x + (entity.bump?.x ?? 0) * 5;
  const ky = pos.y + (entity.bump?.y ?? 0) * 5;
  if (out.left && pit(kx - 14, pos.y)) out.left = false;
  if (out.right && pit(kx + 14, pos.y)) out.right = false;
  if (out.up && pit(pos.x, ky - 14)) out.up = false;
  if (out.down && pit(pos.x, ky + 14)) out.down = false;
  // Too close to an edge, or being knocked towards one: lean back against it.
  const EDGE = 6;
  if (pit(pos.x - EDGE, pos.y) !== pit(pos.x + EDGE, pos.y)) {
    out.right = pit(pos.x - EDGE, pos.y);
    out.left = !out.right;
  }
  if (pit(pos.x, pos.y - EDGE) !== pit(pos.x, pos.y + EDGE)) {
    out.down = pit(pos.x, pos.y - EDGE);
    out.up = !out.down;
  }
  if (pit(kx + Math.sign(kx - pos.x) * 6, pos.y)) {
    out.left = kx > pos.x;
    out.right = kx < pos.x;
  }
  if (pit(pos.x, ky + Math.sign(ky - pos.y) * 6)) {
    out.up = ky > pos.y;
    out.down = ky < pos.y;
  }

  // A gun's kick shoves the shooter back; hold fire rather than be knocked into a pit.
  const inv = entity.weaponInventory!;
  if (shooting && kickedIntoPit(level, entity, inv.weapons[inv.current])) shooting = false;

  pi.up = out.up;
  pi.down = out.down;
  pi.left = out.left;
  pi.right = out.right;
  pi.sprint = out.sprint;
  pi.shoot = shooting;
  pi.mouseAiming = false;
}
