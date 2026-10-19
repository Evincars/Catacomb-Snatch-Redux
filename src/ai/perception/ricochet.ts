import type { Level } from '../../level/Level';

/** The bounce rules of BulletSystem, repeated here so a shot can be rehearsed before it is fired. */
const BOUNCE_SPEEDUP = 1.2;
const BOUNCE_EXTRA_TICKS = 5;
/** Bullets spawn this far ahead of the shooter (BulletFactory's MUZZLE_REACH). */
const MUZZLE_REACH = 4;
const MAX_TICKS = 400;
const ANGLES = 360;
/** A target walking along is expected to keep going for at most this many ticks of the shot. */
const LEAD_TICKS = 24;

export type ShotSpec = {
  speed: number;
  range: number;
  bounces: number;
  /** Half size of the bullet. */
  radius: { x: number; y: number };
};

export type TargetSpec = {
  /** Centre of the hit box, where the body is drawn. */
  x: number;
  y: number;
  /** Half size of the hit box. */
  hw: number;
  hh: number;
  /** Velocity in pixels per tick; the target is assumed to keep it for a short while. */
  vx?: number;
  vy?: number;
};

export type BankShot = {
  angle: number;
  /** Rebounds before the shot arrives. */
  bounces: number;
  /** Ticks the shot is in the air. */
  ticks: number;
};

type Flight = { hit: boolean; bounces: number; ticks: number };

function solidAt(level: Level, x: number, y: number): boolean {
  const tile = level.getTileAt(x, y);
  return !tile || !tile.passable;
}

/** Where the target is expected to be after `tick` ticks of the shot. */
function targetAt(level: Level, target: TargetSpec, tick: number): { x: number; y: number } {
  const t = Math.min(tick, LEAD_TICKS);
  const x = target.x + (target.vx ?? 0) * t;
  const y = target.y + (target.vy ?? 0) * t;
  // A body cannot be led into a wall.
  return solidAt(level, x, y) ? { x: target.x, y: target.y } : { x, y };
}

/** Flies one shot exactly as BulletSystem would and reports whether it reaches the target. */
export function flyShot(level: Level, from: { x: number; y: number }, angle: number, shot: ShotSpec, target: TargetSpec): Flight {
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let px = from.x + dx * MUZZLE_REACH;
  let py = from.y + dy * MUZZLE_REACH;
  let vx = dx * shot.speed;
  let vy = dy * shot.speed;
  let range = shot.range;
  let left = shot.bounces;
  let bounces = 0;
  let traveled = 0;

  const touches = (x: number, y: number, tick: number): boolean => {
    const at = targetAt(level, target, tick);
    return Math.abs(x - at.x) < target.hw + shot.radius.x && Math.abs(y - at.y) < target.hh + shot.radius.y;
  };

  for (let tick = 1; tick <= MAX_TICKS; tick++) {
    const fromX = px;
    const fromY = py;
    let bounced = false;
    if (left > 0 && solidAt(level, px + vx, py + vy)) {
      const blockX = solidAt(level, px + vx, py);
      const blockY = solidAt(level, px, py + vy);
      if (blockX) vx = -vx;
      if (blockY) vy = -vy;
      if (!blockX && !blockY) {
        vx = -vx;
        vy = -vy;
      }
      left--;
      bounces++;
      vx *= BOUNCE_SPEEDUP;
      vy *= BOUNCE_SPEEDUP;
      range += Math.hypot(vx, vy) * BOUNCE_EXTRA_TICKS;
      bounced = true;
    } else {
      px += vx;
      py += vy;
    }
    traveled += Math.hypot(vx, vy);

    // A shot that has died in a wall or at the end of its range can hit nothing this tick.
    if (solidAt(level, px, py) || traveled >= range) return { hit: false, bounces, ticks: tick };
    if (touches(px, py, tick) || (!bounced && touches((fromX + px) / 2, (fromY + py) / 2, tick))) {
      return { hit: true, bounces, ticks: tick };
    }
  }
  return { hit: false, bounces, ticks: MAX_TICKS };
}

/**
 * Looks for a direction in which a bouncing shot, fired from `from`, comes round off the
 * walls and hits a target that cannot be shot at directly. Only directions whose
 * neighbours also hit are used, so a small slip of the aim or a step by the target
 * still lands. The quickest such shot wins, since the target has the least time to leave.
 */
export function solveRicochet(level: Level, from: { x: number; y: number }, shot: ShotSpec, target: TargetSpec): BankShot | null {
  if (shot.bounces < 1) return null;
  const flights: Flight[] = [];
  for (let k = 0; k < ANGLES; k++) flights.push(flyShot(level, from, (k / ANGLES) * Math.PI * 2, shot, target));

  let best: { angle: number; bounces: number; ticks: number; cost: number } | null = null;
  for (let k = 0; k < ANGLES; k++) {
    const here = flights[k];
    if (!here.hit || here.bounces < 1) continue;
    const before = flights[(k + ANGLES - 1) % ANGLES];
    const after = flights[(k + 1) % ANGLES];
    // The middle of a run of hits is the safest line, so ends and lone hits are passed over.
    if (!before.hit || !after.hit || before.bounces < 1 || after.bounces < 1) continue;
    const cost = here.ticks + here.bounces * 6;
    if (!best || cost < best.cost) best = { angle: (k / ANGLES) * Math.PI * 2, bounces: here.bounces, ticks: here.ticks, cost };
  }
  return best ? { angle: best.angle, bounces: best.bounces, ticks: best.ticks } : null;
}
