import { q } from '../../../world';
import type { ShopKind } from '../../../world';
import { isWeaponKind } from '../../../entities/WeaponStats';
import type { WeaponKind } from '../../../entities/WeaponStats';
import { upgradeCostOf } from '../../../entities/BuildingFactory';
import { railCost, carriageCost } from '../../../systems/InteractionSystem';
import { CARRIAGE_DELAY, GUARD_SPAN, INF } from '../../constants';
import { bounces, weaponGain } from '../../perception/arsenal';
import { hostile } from '../../perception/awareness';
import { stallFor } from '../../perception/economy';
import { reachable, nearestOf, walkDistance } from '../../perception/navigation';
import { carriageDemand, carriageSpot, ownCarriages } from '../../perception/rails';
import { worthUpgrading } from '../../perception/upgrades';
import { usePlan } from '../goals';
import type { Situation } from '../situation';
import type { Option, Proposal } from '../utility';

/** A walk to a stall, if the stall is there, reachable and affordable at `budget`. */
function buyAt(s: Situation, score: number, name: string, role: Parameters<typeof stallFor>[1], budget: number,
  commit?: () => void, wanted?: (kind: ShopKind) => boolean): Proposal | null {
  const stall = stallFor(s.entity, role, budget, wanted);
  if (!stall || reachable(s.level, s.brain, stall) >= INF) return null;
  return { score, goal: usePlan(s.level, s.brain, name, stall), commit };
}

const owns = (s: Situation, kind: WeaponKind) => s.entity.weaponInventory!.weapons.includes(kind);
/** A stall filter that takes only guns, and of those only the ones `test` accepts. */
const gun = (test: (kind: WeaponKind) => boolean) => (kind: ShopKind) => isWeaponKind(kind) && test(kind);
const idle = (s: Situation) => s.brain.blastId === undefined && s.brain.looseBombId === undefined;

/** Everything bought, upgraded or laid with coins. */
export const SHOPPING: Option[] = [
  {
    // The plasma gun is the first purchase: it fights round corners and hits hardest of all.
    id: 'plasma gun first',
    ceiling: 72,
    evaluate(s) {
      if (s.held || s.entity.weaponInventory!.weapons.some(bounces)) return null;
      return buyAt(s, 72, 'buy weapon', 'weapon', s.money - s.profile.reserve, undefined, gun((kind) => !owns(s, kind) && bounces(kind)));
    },
  },
  {
    // Home turrets come before savings for a bomb when nests can reach the base: on maps whose route is
    // walled with cracked stone the bomb fund would otherwise starve it for good.
    id: 'secure the base',
    ceiling: 70,
    evaluate(s) {
      if (!s.needsBaseDefense) return null;
      const exposed = [...q.spawners].some((n) => hostile(s.entity, n)
        && walkDistance(s.level, s.field, n.position!.x, n.position!.y) < INF);
      return buyAt(s, 70, 'secure base', 'defense', exposed ? s.money : s.money - s.saving);
    },
  },
  {
    // A better gun comes before anything else is saved for.
    id: 'buy the best gun',
    ceiling: 68,
    evaluate(s) {
      if (s.needsBaseDefense) return null;
      return buyAt(s, 68, 'buy weapon', 'weapon', s.money - s.profile.reserve, undefined,
        gun((kind) => !owns(s, kind) && weaponGain(s.entity, kind) > 2));
    },
  },
  {
    // A bomb for the rival's track and machines: the more there is to wreck, the sooner it is bought.
    id: 'buy a bomb to sabotage',
    ceiling: 69,
    evaluate(s) {
      if (!s.sabotage || !idle(s)) return null;
      const score = 62 + Math.min(7, s.sabotage.value / 6);
      return buyAt(s, score, 'buy explosive', 'explosive', s.money);
    },
  },
  {
    id: 'buy a bomb for the wall',
    ceiling: 65,
    evaluate(s) {
      if (s.wall < 0 || !idle(s)) return null;
      return buyAt(s, 65, 'buy explosive', 'explosive', s.money);
    },
  },
  {
    // The first turret, which starts the coin flow.
    id: 'first turret',
    ceiling: 60,
    evaluate(s) {
      return s.turrets.length === 0 ? buyAt(s, 60, 'buy defense', 'defense', s.money - s.saving) : null;
    },
  },
  {
    id: 'better gun with spare coins',
    ceiling: 58,
    evaluate(s) {
      return buyAt(s, 58, 'buy weapon', 'weapon', s.spare, undefined, gun((kind) => !owns(s, kind) && weaponGain(s.entity, kind) > 2));
    },
  },
  {
    // A harvester once the home turrets stand, so their kills pay.
    id: 'first harvester',
    ceiling: 56,
    evaluate(s) {
      return !s.needsBaseDefense && s.turrets.length > 0 && s.harvesters.length === 0
        ? buyAt(s, 56, 'buy economy', 'economy', s.spare) : null;
    },
  },
  {
    // Mobs holding the head of the track: a turret goes up there to clear the way.
    id: 'turret at the track head',
    ceiling: 54,
    evaluate(s) {
      if (!s.frontBusy || s.turrets.length >= s.profile.maxTurrets) return null;
      return buyAt(s, 54, 'buy defense', 'defense', s.spare, () => { s.brain.front = s.railHead!; });
    },
  },
  {
    // The laid track gets turrets of its own, set where one covers the most bare track in clear sight.
    id: 'guard the track',
    ceiling: 53,
    evaluate(s) {
      const { unguarded } = s;
      if (!unguarded || unguarded.count < GUARD_SPAN || s.turrets.length >= s.profile.maxTurrets + s.profile.trackTurrets) return null;
      // The more bare track, the more urgent; a long undefended line is what the rival raids.
      return buyAt(s, 52 + Math.min(1, unguarded.count / 20), 'buy defense', 'defense', s.spare, () => { s.brain.front = unguarded; });
    },
  },
  {
    // Money beyond what the rest of the track needs is spent rather than left piling up.
    id: 'spend the surplus',
    ceiling: 50,
    evaluate(s) {
      if (s.turrets.length <= s.harvesters.length && s.turrets.length >= s.profile.maxTurrets) return null;
      const role = s.turrets.length > s.harvesters.length ? 'economy' : 'defense';
      return buyAt(s, 50, `buy ${role}`, role, s.surplus);
    },
  },
  {
    // An upgrade whose longer reach covers enough new ground. With coins to spare it is done at once,
    // wherever the turret stands; otherwise only on a trip home or while the track is held up.
    id: 'upgrade',
    ceiling: 55,
    evaluate(s) {
      const flush = s.money - s.profile.reserve;
      const pick = nearestOf(s.level, s.brain, [...q.upgradables].filter((b) => !b.removed && b.team === s.entity.team
        && b.carriedBy === undefined && b.upgradable!.level < s.profile.maxUpgrade
        && worthUpgrading(s.level, s.entity, s.brain, b)
        && ((upgradeCostOf(b) ?? INF) <= s.surplus
          || (upgradeCostOf(b) ?? INF) * 2 <= flush - s.trackBudget * 0.25)));
      if (!pick) return null;
      const rich = (upgradeCostOf(pick) ?? INF) * 2 <= flush - s.trackBudget * 0.25;
      return { score: rich ? 49 + 6 * s.profile.aggression : 50, goal: usePlan(s.level, s.brain, 'upgrade', pick, 'upgradeId') };
    },
  },
  {
    // Every few tiles of track it stops to save for an upgrade, so turrets and harvesters keep up.
    id: 'upgrade it saved for',
    ceiling: 47,
    evaluate(s) {
      if (!s.upgradeDue) return null;
      return {
        score: 47,
        goal: usePlan(s.level, s.brain, 'upgrade', s.upgradeDue, 'upgradeId'),
        commit: () => { s.brain.railsSinceUpgrade = 0; s.brain.upgradeSince = null; },
      };
    },
  },
  {
    // Stage a small fleet as the connected line grows, not only after it reaches treasure.
    id: 'buy a carriage',
    ceiling: 48,
    evaluate(s) {
      const wanted = s.saboteur ? 0 : carriageDemand(s.level, s.entity, s.profile);
      if (s.needsBaseDefense || wanted <= ownCarriages(s.entity) || s.money < carriageCost()
        || s.brain.age - s.brain.lastCarriageAt < CARRIAGE_DELAY) return null;
      const spot = carriageSpot(s.level, s.entity, s.field);
      return spot >= 0 ? { score: 48, goal: { name: 'carriage', tile: spot, build: 'carriage' } } : null;
    },
  },
  {
    // Track to the treasure, once the base has its opening defenses.
    id: 'lay track',
    ceiling: 46,
    evaluate(s) {
      const { plan, brain, profile } = s;
      if (s.needsBaseDefense || s.savingForGuard || s.savingForUpgrade || brain.age < profile.railDelay
        || !plan || plan.length === 0 || s.money < railCost()) return null;
      const next = plan[0];
      return Number.isFinite(s.field.dist[next]) ? { score: 46, goal: { name: 'rail', tile: next, build: 'rail' } } : null;
    },
  },
  {
    // A harvester for every turret.
    id: 'harvester for each turret',
    ceiling: 44,
    evaluate(s) {
      if (s.turrets.length <= s.harvesters.length) return null;
      return buyAt(s, 44, 'buy economy', 'economy', s.harvesters.length === 0 ? s.spare + s.profile.reserve : s.spare);
    },
  },
  {
    // Upgrades, when nothing else is wanted: anything affordable whose longer reach is worth it.
    id: 'upgrade when idle',
    ceiling: 40,
    evaluate(s) {
      const pick = nearestOf(s.level, s.brain, [...q.upgradables].filter((b) => !b.removed && b.team === s.entity.team
        && b.carriedBy === undefined && b.upgradable!.level < s.profile.maxUpgrade
        && (upgradeCostOf(b) ?? INF) <= s.spare && worthUpgrading(s.level, s.entity, s.brain, b)));
      return pick ? { score: 40, goal: usePlan(s.level, s.brain, 'upgrade', pick, 'upgradeId') } : null;
    },
  },
  {
    id: 'more defence',
    ceiling: 42,
    evaluate(s) {
      if (s.turrets.length >= s.profile.maxTurrets) return null;
      const free = s.brain.railDone || s.brain.age < s.profile.railDelay || !s.plan;
      return buyAt(s, 42, 'buy defense', 'defense', free ? s.spare : s.spare - s.trackBudget);
    },
  },
];
