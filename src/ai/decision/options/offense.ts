import { q, world } from '../../../world';
import type { Entity } from '../../../world';
import { TILE_WIDTH } from '../../../level/TileType';
import { BASE_DEFENSE_RANGE, NEST_CLEAR_RANGE, SABOTEUR_WRECK_SCORE } from '../../constants';
import { hostile } from '../../perception/awareness';
import { nearby } from '../../perception/spatial';
import { nearestOf, nearestReachableTo } from '../../perception/navigation';
import { centreX, centreY, dist } from '../../perception/geometry';
import { huntPlan } from '../goals';
import type { Situation } from '../situation';
import type { Option } from '../utility';

const damageable = world.with('position', 'health');
const rivals = world.with('position', 'health', 'playerInput');

/** Rivals' machines: what a computer player wrecks to win. */
const isMachine = (e: { turret?: unknown; harvester?: unknown; railDroid?: unknown }) =>
  e.turret !== undefined || e.harvester !== undefined || e.railDroid !== undefined;

/** Rival players or carriages close to what it owns: home, its turrets and its harvesters. */
function intruders(s: Situation): Entity[] {
  const found = new Set<Entity>();
  const watch = (at: { x: number; y: number }) => {
    for (const e of nearby(at.x, at.y, BASE_DEFENSE_RANGE, INTRUDER_KINDS)) if (isIntruder(s.entity, e)) found.add(e);
  };
  if (s.home) watch(s.home);
  for (const t of s.turrets) watch(t.position!);
  for (const h of s.harvesters) watch(h.position!);
  return [...found];
}

const INTRUDER_KINDS = ['player', 'machine'] as const;

function isIntruder(self: Entity, e: Entity): boolean {
  return hostile(self, e) && (e.playerInput !== undefined || e.railDroid !== undefined);
}

export const OFFENSE: Option[] = [
  {
    // A rival at the gates, or their carriages riding our track: drive them off.
    id: 'defend what is ours',
    ceiling: 66,
    evaluate(s) {
      // The saboteur leaves home to its partner and keeps up the attack.
      if (s.held || s.saboteur || s.profile.aggression < 0.3) return null;
      const target = nearestOf(s.level, s.brain, intruders(s));
      return target ? { score: 66, goal: huntPlan(s.level, s.brain, 'defend', target) } : null;
    },
  },
  {
    // Nests breeding next to home or the track, with no turret of ours farming them, are shot out.
    id: 'clear a nest',
    ceiling: 64,
    evaluate(s) {
      const { home, railHead, guards } = s;
      const pest = nearestOf(s.level, s.brain, [...q.spawners].filter((n) => hostile(s.entity, n)
        && ((home && dist(n.position!, home) < NEST_CLEAR_RANGE) || (railHead && dist(n.position!, railHead) < NEST_CLEAR_RANGE))
        && !guards.some((g) => dist(g.position!, n.position!) < g.turret!.radius)), NEST_CLEAR_RANGE * 1.5);
      return pest ? { score: 64, goal: huntPlan(s.level, s.brain, 'clear nest', pest) } : null;
    },
  },
  {
    // Shoot the rival's turrets, harvesters and carriages down. A saboteur does little else; a builder only
    // defends its track against their carriages.
    id: 'wreck their machines',
    ceiling: SABOTEUR_WRECK_SCORE,
    evaluate(s) {
      const machines = [...damageable].filter((e) => hostile(s.entity, e) && isMachine(e)
        && (s.role !== 'builder' || e.railDroid !== undefined));
      const wreck = nearestOf(s.level, s.brain, machines);
      if (!wreck) return null;
      const score = s.saboteur ? SABOTEUR_WRECK_SCORE : 26 + 22 * s.profile.aggression;
      return { score, goal: huntPlan(s.level, s.brain, 'wreck', wreck) };
    },
  },
  {
    // Otherwise hunt: rival players in versus, then nests and mobs. The more aggressive the opponent, the
    // sooner it leaves its work to go after one within reach.
    id: 'hunt',
    ceiling: 48,
    evaluate(s) {
      const prey = nearestOf(s.level, s.brain, [...damageable].filter((e) =>
        hostile(s.entity, e) && (e.playerInput !== undefined || e.spawner !== undefined || e.ai !== undefined)));
      if (!prey) return null;
      const close = Math.hypot(prey.position!.x - s.pos.x, prey.position!.y - s.pos.y) < 14 * TILE_WIDTH;
      const score = 28 + 20 * s.profile.aggression * (prey.playerInput && close ? 1 : 0.4);
      return { score, goal: huntPlan(s.level, s.brain, 'hunt', prey) };
    },
  },
  {
    // A rival walled off from here cannot be walked to; close in on the nearest spot instead of waiting for them.
    id: 'stalk',
    ceiling: 28,
    evaluate(s) {
      const walled = [...rivals].filter((e) => hostile(s.entity, e));
      if (walled.length === 0) return null;
      const target = walled.reduce((best, e) => (dist(e.position!, s.pos) < dist(best.position!, s.pos) ? e : best));
      const spot = nearestReachableTo(s.level, s.field, target.position!);
      if (spot < 0 || spot === s.field.origin
        || dist({ x: centreX(spot % s.level.width), y: centreY(Math.floor(spot / s.level.width)) }, s.pos) <= TILE_WIDTH) return null;
      return { score: 28, goal: { name: 'stalk', tile: spot, walk: true } };
    },
  },
];
