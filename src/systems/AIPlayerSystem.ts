/**
 * The computer opponent. It is an ordinary player entity whose controls
 * (movement keys, aim, trigger and the use / build / upgrade presses) are
 * written here, so every rule of buying, carrying, laying track and fighting
 * is the same one people play by.
 *
 * Nothing below knows about particular weapons or buildings: guns are rated
 * from their WEAPON_STATS and BULLET_CONFIGS, shop stalls by their SHOP_DEFS
 * role, and buildings by the components they carry (`turret`, `harvester`,
 * `upgradable`). New items of an existing role are picked up automatically.
 */
import { world, q, Team } from '../world';
import type { Entity } from '../world';
import type { Level } from '../level/Level';
import { TileType, TILE_WIDTH, TILE_HEIGHT } from '../level/TileType';
import { railJoins } from '../level/RailLayout';
import { AI_DIFFICULTIES, isVersus } from '../game/GameState';
import type { AIDifficulty } from '../game/GameState';
import { WEAPON_STATS } from '../entities/WeaponStats';
import { BULLET_CONFIGS } from '../entities/BulletFactory';
import { SHOP_DEFS } from '../entities/ShopItemFactory';
import type { ShopRole } from '../entities/ShopItemFactory';
import { upgradeCostOf } from '../entities/BuildingFactory';
import { hitByAimLine, INTERACT_REACH } from './TargetingSystem';
import { railCost, carriageCost } from './InteractionSystem';
import { canSpawnRailDroid } from './RailDroidSystem';

/** Distances, in pixels, at which guns are compared. */
const RANGE_BANDS = [32, 80, 140, 200, 260];
/** Ticks a goal may take before it is dropped as unreachable. */
const GOAL_TIMEOUT = 60 * 25;
/** Ticks an entity that could not be reached is ignored for. */
const BLACKLIST_TICKS = 60 * 20;
/** Ticks of no progress before trying to sidestep. */
const STUCK_TICKS = 24;
/** Ticks between weapon swaps, so it does not flick through the inventory. */
const SWAP_DELAY = 40;
/** How far loot may lie, in walking pixels, for a detour to pick it up. */
const LOOT_DETOUR = 7 * TILE_WIDTH;
/** Nests this close to the spawn or the head of the track get cleared out. */
const NEST_CLEAR_RANGE = 10 * TILE_WIDTH;
/** Coins worth a long walk (carriage emeralds, chest hoards). */
const RICH_LOOT = 100;
const RICH_LOOT_DETOUR = 22 * TILE_WIDTH;
/** Carriage's treasure reach (Java's getBB().grow(32)) and body size. */
const TREASURE_REACH = 32;
const CARRIAGE_RADIUS = { x: 10, y: 8 };
const DIRS = [[0, -1], [1, 0], [0, 1], [-1, 0]] as const;
/** Planner cost of a cracked wall in the way, in tiles of track. */
const BLAST_STEP = 3;
/** Tiles (on either axis) to keep between itself and a bomb it is about to set off. */
const BLAST_CLEARANCE = 3;
const BASE_DEFENSE_RANGE = 7 * TILE_WIDTH;
/** Uncovered tiles of laid track that call for a turret of their own. */
const GUARD_SPAN = 4;
const CARRIAGE_DELAY = 60 * 10;
const INF = Number.POSITIVE_INFINITY;

type Goal = {
  name: string;
  /** Tile to walk to. */
  tile: number;
  /** Entity to reach and press `use` on (stall, harvester, chest). */
  useId?: number;
  upgradeId?: number;
  /** Press build on this very tile (rail) or on a free base-track tile (carriage). */
  build?: 'rail' | 'carriage';
  /** Put down the building being carried here. */
  drop?: boolean;
  /** Tile to face while putting it down (a bomb is tossed against this wall). */
  faceTile?: number;
  /** Put down at once to free the hands for fighting (a bomb is kept, not lit). */
  stash?: true;
  /** Stand clear of our bomb and shoot it. */
  detonate?: true;
  /** Just walk there (loot, retreat, roaming, hunting). */
  walk?: true;
  /** Close in on this entity until it is in sight and range. */
  huntId?: number;
  /** Tick the goal was set at. */
  since: number;
};

type Field = { dist: Float64Array; parent: Int32Array; origin: number };

type Brain = {
  age: number;
  think: number;
  field: Field | null;
  goal: Goal | null;
  path: number[];
  enemyId?: number;
  /** Ticks left before it reacts to the current enemy. */
  reaction: number;
  jitter: number;
  trigger: boolean;
  triggerTicks: number;
  swapTicks: number;
  lastX: number;
  lastY: number;
  stuck: number;
  sidestep: { x: number; y: number; ticks: number } | null;
  /** Tiles of track to lay, from the base outward, and tiles reserved for it. */
  railPlan: number[];
  railDone: boolean;
  lastCarriageAt: number;
  /** Our own explosive, put down to clear a wall, waiting to be shot. */
  blastId?: number;
  /** Bomb put down in a hurry to fight, to be picked up again. */
  looseBombId?: number;
  /** Head of the track while mobs hold it: the next turret goes there. */
  front?: { x: number; y: number };
  blacklist: Map<number, number>;
};

const brains = new WeakMap<Entity, Brain>();
if (import.meta.env?.DEV && typeof window !== 'undefined') {
  (window as unknown as { __aiBrain: (e: Entity) => Brain | undefined }).__aiBrain = (e) => brains.get(e);
}

function brainOf(entity: Entity): Brain {
  let brain = brains.get(entity);
  if (!brain) {
    brain = {
      age: 0, think: 0, field: null, goal: null, path: [], reaction: 0, jitter: 0,
      trigger: false, triggerTicks: 0, swapTicks: 0,
      lastX: entity.position!.x, lastY: entity.position!.y, stuck: 0, sidestep: null,
      railPlan: [], railDone: false, lastCarriageAt: -CARRIAGE_DELAY, blacklist: new Map(),
    };
    brains.set(entity, brain);
  }
  return brain;
}

function profileOf(entity: Entity): AIDifficulty {
  return AI_DIFFICULTIES.find((d) => d.name === entity.aiPlayer!.difficulty) ?? AI_DIFFICULTIES[1];
}

// ---------------------------------------------------------------------------
// Geometry helpers

const tileX = (x: number) => Math.floor(x / TILE_WIDTH);
const tileY = (y: number) => Math.floor(y / TILE_HEIGHT);
const centreX = (tx: number) => tx * TILE_WIDTH + TILE_WIDTH / 2;
const centreY = (ty: number) => ty * TILE_HEIGHT + TILE_HEIGHT / 2;

function tileOf(level: Level, x: number, y: number): number {
  return tileX(x) + tileY(y) * level.width;
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function alive(e: Entity | undefined): e is Entity {
  return e !== undefined && !e.removed && (e.health?.current ?? 1) > 0;
}

// ---------------------------------------------------------------------------
// Walking: a cost field over the tile grid from where the AI stands.

/** Tiles occupied by things that block a walker, and tiles that are dangerous to step on. */
function obstacles(level: Level): { blocked: Set<number>; risky: Set<number> } {
  const blocked = new Set<number>();
  const risky = new Set<number>();
  for (const e of world.with('position', 'blocking')) {
    if (e.carriedBy !== undefined || e.removed || e.playerInput || e.railDroid || e.ai) continue;
    if (e.building || e.spawner) blocked.add(tileOf(level, e.position!.x, e.position!.y));
  }
  for (const e of world.with('position', 'spikeTrap')) risky.add(tileOf(level, e.position!.x, e.position!.y));
  return { blocked, risky };
}

/** Min-heap of [cost, tile] pairs, used by both the walking and the track planner. */
class Heap {
  private items: Array<[number, number]> = [];
  get size(): number { return this.items.length; }
  push(cost: number, tile: number): void {
    const a = this.items;
    a.push([cost, tile]);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p][0] <= a[i][0]) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): [number, number] {
    const a = this.items;
    const top = a[0];
    const last = a.pop()!;
    if (a.length > 0) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l][0] < a[m][0]) m = l;
        if (r < a.length && a[r][0] < a[m][0]) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

function walkField(level: Level, from: number): Field {
  const n = level.width * level.height;
  const distArr = new Float64Array(n).fill(INF);
  const parent = new Int32Array(n).fill(-1);
  const { blocked, risky } = obstacles(level);
  const heap = new Heap();
  distArr[from] = 0;
  heap.push(0, from);
  while (heap.size > 0) {
    const [d, cur] = heap.pop();
    if (d > distArr[cur]) continue;
    const cx = cur % level.width;
    const cy = (cur - cx) / level.width;
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      const tile = level.getTile(nx, ny);
      // Cracked floor gives way underfoot, so it is as bad as a pit.
      if (!tile || !tile.passable || tile.type === TileType.Hole || tile.type === TileType.DropTrap) continue;
      const next = nx + ny * level.width;
      if (blocked.has(next)) continue;
      let step = risky.has(next) ? 8 : 1;
      // Keep off the edges of pits where a shove would tip it in.
      for (const [ex, ey] of DIRS) {
        const edge = level.getTile(nx + ex, ny + ey)?.type;
        if (edge === TileType.Hole || edge === TileType.DropTrap) {
          step += 3;
          break;
        }
      }
      if (d + step < distArr[next]) {
        distArr[next] = d + step;
        parent[next] = cur;
        heap.push(d + step, next);
      }
    }
  }
  return { dist: distArr, parent, origin: from };
}

function pathTo(field: Field, goal: number): number[] {
  if (!Number.isFinite(field.dist[goal])) return [];
  const path: number[] = [];
  for (let t = goal; t !== field.origin && t >= 0; t = field.parent[t]) path.push(t);
  return path.reverse();
}

/** The reachable tile nearest by walking among a tile and its neighbours (for blocked targets). */
function approachTile(level: Level, field: Field, tile: number): number {
  const x = tile % level.width;
  const y = (tile - x) / level.width;
  let best = -1;
  let bestDist = INF;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= level.width || ny >= level.height) continue;
      const t = nx + ny * level.width;
      // Diagonal neighbours are a last resort: reach is measured along the aim line.
      const d = field.dist[t] + (dx !== 0 && dy !== 0 ? 2 : 0);
      if (d < bestDist) {
        bestDist = d;
        best = t;
      }
    }
  }
  return best;
}

function walkDistance(level: Level, field: Field, x: number, y: number): number {
  const t = approachTile(level, field, tileOf(level, x, y));
  return t < 0 ? INF : field.dist[t] * TILE_WIDTH;
}

// ---------------------------------------------------------------------------
// Rating guns from their data.

/** Expected damage per second against a target `d` pixels away; 0 when out of reach. */
function weaponValue(kind: string, d: number): number {
  const stats = WEAPON_STATS[kind];
  const bullet = stats ? BULLET_CONFIGS[stats.bullet] : undefined;
  if (!stats || !bullet || d > bullet.range) return 0;
  const flight = d / bullet.speed;
  const damage = Math.max(0.5, bullet.damage - (bullet.damageFalloff ?? 0) * flight);
  // Pellets spread over `accuracy` radians; the share that hits a body ~16px wide.
  const spread = Math.max(1, d * stats.accuracy * 2);
  const hitShare = Math.min(1, 16 / spread);
  const bounce = 1 + (bullet.bounces ?? 0) * 0.08;
  return damage * stats.pellets * hitShare * bounce * 60 / Math.max(1, stats.cooldown);
}

/** Best owned weapon slot for a fight at distance `d`. */
/** Best gun for the distance; `safe` rules out guns whose kick would be dangerous. */
function bestSlot(entity: Entity, d: number, safe: (weapon: string) => boolean = () => true): number {
  const inv = entity.weaponInventory!;
  let best = inv.current;
  let bestValue = safe(inv.weapons[inv.current]) ? weaponValue(inv.weapons[inv.current], d) : 0;
  inv.weapons.forEach((w, i) => {
    const v = safe(w) ? weaponValue(w, d) : 0;
    if (v > bestValue * 1.1) {
      best = i;
      bestValue = v;
    }
  });
  return best;
}

/** How much a weapon would add to the arsenal, as the summed gain over the range bands. */
function weaponGain(entity: Entity, kind: string): number {
  const owned = entity.weaponInventory!.weapons;
  let gain = 0;
  for (const d of RANGE_BANDS) {
    const have = Math.max(0, ...owned.map((w) => weaponValue(w, d)));
    gain += Math.max(0, weaponValue(kind, d) - have);
  }
  return gain;
}

// ---------------------------------------------------------------------------
// What is on the map.

function roleOfBuilding(e: Entity): ShopRole | null {
  const type = e.building?.type;
  if (!type) return null;
  const def = (SHOP_DEFS as Record<string, { role: ShopRole } | undefined>)[type];
  return def?.role ?? null;
}

function ownBuildings(entity: Entity, role: ShopRole): Entity[] {
  return [...q.buildings].filter((b) => !b.removed && b.team === entity.team
    && b.carriedBy === undefined && roleOfBuilding(b) === role);
}

function treasureOf(): Entity | null {
  for (const b of q.buildings) if (b.building!.type === 'treasure' && !b.removed) return b;
  return null;
}

function hostile(entity: Entity, other: Entity): boolean {
  if (other === entity || !alive(other) || other.removed || other.carriedBy !== undefined) return false;
  if (other.ai || other.spawner) return other.team !== entity.team;
  if (!isVersus() || other.team === undefined || other.team === Team.Neutral || other.team === entity.team) return false;
  if (other.playerInput) return other.respawnTicks === undefined && !other.spawnProtected && !other.falling;
  return (other.building !== undefined && other.building.type !== 'treasure' && other.building.type !== 'shop'
    && !other.bomb) || other.railDroid !== undefined;
}

// ---------------------------------------------------------------------------
// Track planning: cheapest line of tiles joining the base track to the treasure.

function treasureReachTiles(level: Level, treasure: Entity): Set<number> {
  const result = new Set<number>();
  const p = treasure.position!;
  const r = treasure.radius ?? { x: 10, y: 10 };
  const reachX = CARRIAGE_RADIUS.x + TREASURE_REACH + r.x - 2;
  const reachY = CARRIAGE_RADIUS.y + TREASURE_REACH + r.y - 2;
  for (let ty = tileY(p.y - reachY); ty <= tileY(p.y + reachY); ty++) {
    for (let tx = tileX(p.x - reachX); tx <= tileX(p.x + reachX); tx++) {
      if (Math.abs(centreX(tx) - p.x) < reachX && Math.abs(centreY(ty) - p.y) < reachY
        && level.getTile(tx, ty)) result.add(tx + ty * level.width);
    }
  }
  return result;
}

const RAIL_TYPES = new Set([TileType.Rail, TileType.UnbreakableRail, TileType.PlayerRail]);

/** Tiles of track still to be laid, in order from the base, or null when there is no way through. */
function planRails(level: Level, team: Team): number[] | null {
  const treasure = treasureOf();
  if (!treasure) return null;
  const targets = treasureReachTiles(level, treasure);
  const { blocked } = obstacles(level);
  const n = level.width * level.height;
  const cost = new Float64Array(n).fill(INF);
  const parent = new Int32Array(n).fill(-1);
  const heap = new Heap();

  for (let ty = 0; ty < level.height; ty++) {
    for (let tx = 0; tx < level.width; tx++) {
      const tile = level.getTile(tx, ty);
      if (tile?.type === TileType.PlayerRail && tile.team === team) {
        const t = tx + ty * level.width;
        cost[t] = 0;
        heap.push(0, t);
      }
    }
  }

  const stepCost = (tx: number, ty: number): number => {
    const tile = level.getTile(tx, ty);
    if (!tile) return INF;
    if (RAIL_TYPES.has(tile.type)) {
      // Other teams' track would carry its carriages off towards their base.
      if (tile.team !== undefined && tile.team !== team) return isVersus() ? 40 : 0;
      return 0;
    }
    const t = tx + ty * level.width;
    if (level.inBaseArea(tx, ty)) return INF;
    // A cracked wall can be blasted open, at the price of a bomb.
    if (tile.destroyable) return BLAST_STEP;
    if (!tile.buildable || blocked.has(t)) return INF;
    return 1;
  };

  let end = -1;
  while (heap.size > 0) {
    const [c, cur] = heap.pop();
    if (c > cost[cur]) continue;
    if (targets.has(cur)) {
      end = cur;
      break;
    }
    const cx = cur % level.width;
    const cy = (cur - cx) / level.width;
    const here = level.getTile(cx, cy);
    for (const [dx, dy] of DIRS) {
      const nx = cx + dx;
      const ny = cy + dy;
      const there = level.getTile(nx, ny);
      if (!there) continue;
      // The original's fixed track only joins up and down.
      if (dx !== 0 && (here?.type === TileType.UnbreakableRail || there.type === TileType.UnbreakableRail)) continue;
      const step = stepCost(nx, ny);
      if (!Number.isFinite(step)) continue;
      const next = nx + ny * level.width;
      // Tiny tie-break keeps lines straight, which reads better and confuses carriages less.
      if (c + step + 0.001 < cost[next]) {
        cost[next] = c + step + 0.001;
        parent[next] = cur;
        heap.push(cost[next], next);
      }
    }
  }
  if (end < 0) return null;

  const route: number[] = [];
  for (let t = end; t >= 0 && cost[t] > 0; t = parent[t]) route.push(t);
  route.reverse();
  return route.filter((t) => !RAIL_TYPES.has(level.getTile(t % level.width, Math.floor(t / level.width))!.type));
}

// ---------------------------------------------------------------------------
// Placing buildings.

function canPlaceOn(level: Level, t: number, reserved: Set<number>, blocked: Set<number>): boolean {
  const tx = t % level.width;
  const ty = (t - tx) / level.width;
  const tile = level.getTile(tx, ty);
  if (!tile?.buildable || tile.type === TileType.DropTrap || reserved.has(t) || blocked.has(t)) return false;
  if (level.inBaseArea(tx, ty) || besideTrack(level, t)) return false;
  // Leave corridors open: at least three passable neighbours.
  let open = 0;
  for (const [dx, dy] of DIRS) if (level.getTile(tx + dx, ty + dy)?.passable) open++;
  return open >= 3;
}

function baseTurrets(level: Level, entity: Entity): Entity[] {
  const home = level.getRandomSpawnPoint(entity.team ?? Team.Two);
  return home ? ownBuildings(entity, 'defense').filter((b) => alive(b) && dist(b.position!, home) <= BASE_DEFENSE_RANGE) : [];
}

function baseDefenseSpot(level: Level, entity: Entity, brain: Brain): number {
  const home = level.getRandomSpawnPoint(entity.team ?? Team.Two);
  if (!home) return -1;
  const field = brain.field!;
  const reserved = new Set(brain.railPlan);
  const { blocked } = obstacles(level);
  const turrets = baseTurrets(level, entity);
  let best = -1;
  let bestScore = INF;
  for (let t = 0; t < field.dist.length; t++) {
    if (!Number.isFinite(field.dist[t]) || !canPlaceOn(level, t, reserved, blocked)) continue;
    const p = { x: centreX(t % level.width), y: centreY(Math.floor(t / level.width)) };
    const d = dist(p, home);
    if (d > BASE_DEFENSE_RANGE - 26 || turrets.some((b) => dist(b.position!, p) < TILE_WIDTH * 2.5)) continue;
    const score = d / TILE_WIDTH + field.dist[t] * 0.25;
    if (score < bestScore) {
      best = t;
      bestScore = score;
    }
  }
  return best;
}

/** Where a carried building should go, judged by what it does. */
function placementFor(level: Level, entity: Entity, brain: Brain, held: Entity): number {
  const field = brain.field!;
  const reserved = new Set(brain.railPlan);
  const { blocked } = obstacles(level);
  const ok = (t: number) => Number.isFinite(field.dist[t]) && canPlaceOn(level, t, reserved, blocked);

  /** Reachable placeable tile whose centre sits `lo`..`hi` px from `at`, nearest to walk to. */
  const near = (at: { x: number; y: number }, lo: number, hi: number): number => {
    let best = -1;
    let bestDist = INF;
    const span = Math.ceil(hi / TILE_WIDTH) + 1;
    const ax = tileX(at.x);
    const ay = tileY(at.y);
    for (let ty = ay - span; ty <= ay + span; ty++) {
      for (let tx = ax - span; tx <= ax + span; tx++) {
        if (tx < 0 || ty < 0 || tx >= level.width || ty >= level.height) continue;
        const t = tx + ty * level.width;
        const d = Math.hypot(centreX(tx) - at.x, centreY(ty) - at.y);
        if (d < lo || d > hi || !ok(t)) continue;
        if (field.dist[t] < bestDist) {
          bestDist = field.dist[t];
          best = t;
        }
      }
    }
    return best;
  };

  if (held.harvester) {
    // Beside a turret that has no harvester of its own yet, so its kills are collected.
    const harvesters = ownBuildings(entity, 'economy');
    const home = level.getRandomSpawnPoint(entity.team ?? Team.Two);
    // Turrets out on the track come first: their kills lie farthest from the base's own harvesters.
    const byDistance = (b: Entity) => (home ? dist(b.position!, home) : 0);
    for (const turret of [...ownBuildings(entity, 'defense')].sort((a, b) => byDistance(b) - byDistance(a))) {
      const reach = held.harvester.radius;
      if (harvesters.some((h) => dist(h.position!, turret.position!) < reach)) continue;
      const t = near(turret.position!, TILE_WIDTH * 0.9, Math.max(TILE_WIDTH * 1.5, reach * 0.8));
      if (t >= 0) return t;
    }
  }
  if (held.turret && baseTurrets(level, entity).length < Math.min(3, profileOf(entity).maxTurrets)) {
    const t = baseDefenseSpot(level, entity, brain);
    if (t >= 0) return t;
  }
  if (held.turret && brain.front) {
    const t = near(brain.front, TILE_WIDTH * 1.4, Math.max(held.turret.radius * 0.6, TILE_WIDTH * 2.5));
    if (t >= 0) return t;
  }
  if (held.turret) {
    // Within reach of a nest, so it farms the mobs that crawl out, else guarding the track.
    const nests = [...q.spawners].filter((s) => !s.removed && Number.isFinite(walkDistance(level, field, s.position!.x, s.position!.y)))
      .filter((s) => !ownBuildings(entity, 'defense').some((tur) => dist(tur.position!, s.position!) < tur.turret!.radius));
    nests.sort((a, b) => walkDistance(level, field, a.position!.x, a.position!.y) - walkDistance(level, field, b.position!.x, b.position!.y));
    for (const nest of nests) {
      const t = near(nest.position!, TILE_WIDTH * 1.5, held.turret.radius * 0.75);
      if (t >= 0) return t;
    }
    const treasure = treasureOf();
    if (treasure) {
      const t = near(treasure.position!, TILE_WIDTH * 2, TILE_WIDTH * 5);
      if (t >= 0) return t;
    }
  }
  // Anything else: the nearest decent spot outside the base.
  let best = -1;
  for (let t = 0; t < field.dist.length; t++) {
    if (field.dist[t] < 3 || !ok(t)) continue;
    if (best < 0 || field.dist[t] < field.dist[best]) best = t;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Choosing what to do.

function setGoal(brain: Brain, level: Level, goal: Omit<Goal, 'since'>): void {
  brain.goal = { ...goal, since: brain.age };
  brain.path = brain.field ? pathTo(brain.field, goal.tile) : [];
  void level;
}

function ignored(brain: Brain, e: Entity): boolean {
  const until = brain.blacklist.get(world.id(e) ?? -1);
  return until !== undefined && until > brain.age;
}

function reachable(level: Level, brain: Brain, e: Entity, limit = INF): number {
  if (ignored(brain, e)) return INF;
  const d = walkDistance(level, brain.field!, e.position!.x, e.position!.y);
  return d <= limit ? d : INF;
}

function nearestOf(level: Level, brain: Brain, list: Iterable<Entity>, limit = INF): Entity | null {
  let best: Entity | null = null;
  let bestDist = limit;
  for (const e of list) {
    const d = reachable(level, brain, e, limit);
    if (d < bestDist) {
      best = e;
      bestDist = d;
    }
  }
  return best;
}

function useGoal(level: Level, brain: Brain, name: string, target: Entity, key: 'useId' | 'upgradeId' = 'useId'): void {
  const t = approachTile(level, brain.field!, tileOf(level, target.position!.x, target.position!.y));
  setGoal(brain, level, { name, tile: t, [key]: world.id(target)! });
}

/** Cheapest stall of a role it can afford, preferring the dearest (best) one. */
function stallFor(entity: Entity, role: ShopRole, budget: number, wanted?: (kind: string) => boolean): Entity | null {
  let best: Entity | null = null;
  for (const stall of q.shopItems) {
    if (stall.team !== entity.team || stall.removed) continue;
    const { kind, cost } = stall.shopItem!;
    if (SHOP_DEFS[kind].role !== role || cost > budget || (wanted && !wanted(kind))) continue;
    if (!best || cost > best.shopItem!.cost) best = stall;
  }
  return best;
}

function think(level: Level, entity: Entity, brain: Brain, profile: AIDifficulty): void {
  const pos = entity.position!;
  brain.field = walkField(level, tileOf(level, pos.x, pos.y));
  const field = brain.field;
  const money = entity.playerStats!.score;
  const held = entity.carryingId !== undefined ? world.entity(entity.carryingId) : undefined;

  const plan = planRails(level, entity.team ?? Team.Two);
  brain.railPlan = plan ?? [];
  brain.railDone = plan !== null && plan.length === 0;
  // Opening a reachable barrier is exploration, not rail construction. Do it
  // even before laying the intervening track or waiting out the rail delay.
  const wall = plan?.find((t) => tileAt(level, t)?.destroyable && besideWall(level, field, t) >= 0) ?? -1;
  const bomb = brain.blastId !== undefined ? world.entity(brain.blastId) : undefined;
  if (!bomb || bomb.removed || bomb.carriedBy !== undefined) brain.blastId = undefined;
  const loose = brain.looseBombId !== undefined ? world.entity(brain.looseBombId) : undefined;
  if (!loose || loose.removed || loose.carriedBy !== undefined || loose.bomb?.lit) brain.looseBombId = undefined;
  // Hands full and something biting within reach: put it down here and fight.
  // A bomb is never let go of in a fight: on the floor any stray shot sets it off, and it
  // stays in hand across a respawn anyway.
  const threatened = held !== undefined && !held.bomb && mobsNear(level, entity, 72) > 0;
  const explosive = cheapestStall(entity, 'explosive');
  // Money is put by for the bomb, rather than spent on extras.
  const saving = wall >= 0 && brain.blastId === undefined && brain.looseBombId === undefined && !held?.bomb && explosive ? explosive.shopItem!.cost : 0;
  const spare = money - profile.reserve - saving;
  const defenseStall = cheapestStall(entity, 'defense');
  const defenseSpot = defenseStall && reachable(level, brain, defenseStall) < INF
    && baseTurrets(level, entity).length < Math.min(3, profile.maxTurrets)
    ? baseDefenseSpot(level, entity, brain) : -1;
  const needsBaseDefense = defenseSpot >= 0;

  const danger = [...world.with('position', 'bomb')].find((b) => !b.removed && b.carriedBy === undefined
    && b.bomb!.lit && !clearOfBlast(entity, b));
  if (danger) {
    const t = blastCover(level, field, danger, false);
    if (t >= 0) {
      brain.sidestep = null;
      setGoal(brain, level, { name: 'escape blast', tile: t, walk: true });
      return;
    }
  }

  const health = entity.health!;
  if (!held && health.current < health.max * profile.retreatHealth && enemiesNear(entity, 160)) {
    const turret = nearestOf(level, brain, ownBuildings(entity, 'defense'));
    const spawn = turret?.position ?? level.getRandomSpawnPoint(entity.team ?? Team.Two);
    if (spawn) {
      setGoal(brain, level, { name: 'retreat', tile: approachTile(level, field, tileOf(level, spawn.x, spawn.y)), walk: true });
      return;
    }
  }

  // Keep going with an interaction that is under way.
  const g = brain.goal;
  if (g && brain.age - g.since < GOAL_TIMEOUT && !g.walk && !g.huntId && !(threatened && !g.stash)
    && !(needsBaseDefense && g.build)
    && goalStillValid(level, entity, brain, g)) {
    brain.path = pathTo(field, g.tile);
    if (brain.path.length > 0 || field.dist[g.tile] === 0) return;
  }
  if (g && brain.age - g.since >= GOAL_TIMEOUT) {
    const id = g.useId ?? g.upgradeId ?? g.huntId;
    if (id !== undefined) brain.blacklist.set(id, brain.age + BLACKLIST_TICKS);
  }
  brain.goal = null;

  // 0. Hands full and something biting: put it down here and fight.
  if (threatened) {
    stashGoal(level, brain);
    return;
  }

  // 1. Whatever is in hand goes where it is useful; a bomb goes against the wall in the way.
  if (held?.bomb && wall >= 0) {
    const t = besideWall(level, field, wall);
    if (t >= 0) {
      setGoal(brain, level, { name: 'place bomb', tile: t, drop: true, faceTile: wall });
      return;
    }
  }
  if (held?.bomb) {
    // No wall to open from here: set it down out of harm's way and keep it.
    stashGoal(level, brain);
    return;
  }
  if (held) {
    const t = placementFor(level, entity, brain, held);
    if (t >= 0) setGoal(brain, level, { name: 'place', tile: t, drop: true });
    else stashGoal(level, brain);
    return;
  }

  // 1b. A bomb of ours is set: get clear of it and shoot it.
  if (brain.blastId !== undefined) {
    const t = blastCover(level, field, world.entity(brain.blastId)!);
    if (t >= 0) {
      setGoal(brain, level, { name: 'detonate', tile: t, detonate: true });
      return;
    }
  }

  // 1c. A bomb put down to fight is fetched again once things are quiet.
  if (brain.looseBombId !== undefined && wall >= 0 && mobsNear(level, entity, 120) === 0) {
    useGoal(level, brain, 'fetch bomb', world.entity(brain.looseBombId)!);
    return;
  }

  if (needsBaseDefense) {
    // Home turrets come before savings for a bomb when nests can reach the base: on maps whose
    // route is walled with cracked stone the bomb fund would otherwise starve it for good.
    // Walled in with nothing to fight, the bomb that opens the way comes first.
    const exposed = [...q.spawners].some((s) => hostile(entity, s)
      && walkDistance(level, field, s.position!.x, s.position!.y) < INF);
    const stall = stallFor(entity, 'defense', exposed ? money : money - saving);
    if (stall && reachable(level, brain, stall) < INF) {
      useGoal(level, brain, 'secure base', stall);
      return;
    }
  }

  if (wall >= 0 && brain.blastId === undefined && brain.looseBombId === undefined) {
    const stall = stallFor(entity, 'explosive', money);
    if (stall && reachable(level, brain, stall) < INF) {
      useGoal(level, brain, 'buy explosive', stall);
      return;
    }
  }

  // 2b. Nests breeding next to home or the track, with no turret of ours farming them, are shot out.
  const home = level.getRandomSpawnPoint(entity.team ?? Team.Two);
  const railHead = plan && plan.length > 0 ? { x: centreX(plan[0] % level.width), y: centreY(Math.floor(plan[0] / level.width)) } : null;
  const guards = ownBuildings(entity, 'defense').filter((b) => b.turret);
  const pest = nearestOf(level, brain, [...q.spawners].filter((s) => hostile(entity, s)
    && ((home && dist(s.position!, home) < NEST_CLEAR_RANGE) || (railHead && dist(s.position!, railHead) < NEST_CLEAR_RANGE))
    && !guards.some((g) => dist(g.position!, s.position!) < g.turret!.radius)), NEST_CLEAR_RANGE * 1.5);
  if (pest) {
    const t = approachTile(level, field, tileOf(level, pest.position!.x, pest.position!.y));
    setGoal(brain, level, { name: 'clear nest', tile: t, huntId: world.id(pest)! });
    return;
  }

  // 3. A harvester with a good haul.
  const fullHarvester = nearestOf(level, brain, ownBuildings(entity, 'economy').filter((h) => h.harvester
    && !h.harvester.emptying && (h.harvester.collected >= profile.drainThreshold
      || h.harvester.collected >= h.harvester.capacity * 0.9)));
  if (fullHarvester) {
    useGoal(level, brain, 'drain', fullHarvester);
    return;
  }

  const turrets = ownBuildings(entity, 'defense');
  const harvesters = ownBuildings(entity, 'economy');

  // 4. The first turret, which starts the coin flow.
  if (turrets.length === 0) {
    const stall = stallFor(entity, 'defense', money - saving);
    if (stall && reachable(level, brain, stall) < INF) {
      useGoal(level, brain, 'buy defense', stall);
      return;
    }
  }

  // 4b. A better gun, which keeps it alive and earns faster.
  const gun = stallFor(entity, 'weapon', spare, (kind) =>
    !entity.weaponInventory!.weapons.includes(kind) && weaponGain(entity, kind) > 2);
  if (gun && reachable(level, brain, gun) < INF) {
    useGoal(level, brain, 'buy weapon', gun);
    return;
  }

  // 4c. Mobs holding the head of the track: a turret goes up there to clear the way.
  const trackBudget = railCost() * (plan?.length ?? 0) + (saving > 0 ? 0 : wall >= 0 && explosive ? explosive.shopItem!.cost : 0);
  const frontBusy = railHead !== null && wall < 0 && !brain.railDone
    && mobsNear(level, entity, 3 * TILE_WIDTH, railHead) >= 3
    && !guards.some((g) => dist(g.position!, railHead) < g.turret!.radius);
  if (frontBusy && turrets.length < profile.maxTurrets) {
    const stall = stallFor(entity, 'defense', spare);
    if (stall && reachable(level, brain, stall) < INF) {
      brain.front = railHead;
      useGoal(level, brain, 'buy defense', stall);
      return;
    }
  }

  // 4d. The laid track gets turrets of its own, so the line is held as it grows. Track laying
  // pauses while it saves up for one; each such turret later gets a harvester from step 7.
  let savingForGuard = false;
  const unguarded = needsBaseDefense ? null : unguardedTrack(level, entity, field);
  if (unguarded && unguarded.count >= GUARD_SPAN && turrets.length < profile.maxTurrets + profile.trackTurrets) {
    const stall = cheapestStall(entity, 'defense');
    if (stall && reachable(level, brain, stall) < INF) {
      if (spare >= stall.shopItem!.cost) {
        brain.front = unguarded;
        useGoal(level, brain, 'buy defense', stall);
        return;
      }
      savingForGuard = true;
    }
  }

  // 4e. Money beyond what the rest of the track needs is spent rather than left piling up:
  // a harvester for each turret, more turrets, then upgrades. Only on a trip home or while the
  // track is held up, so it does not crowd out laying track.
  const atHome = home !== null && home !== undefined
    && walkDistance(level, field, home.x, home.y) < NEST_CLEAR_RANGE;
  const surplus = atHome || frontBusy || brain.railDone ? spare - trackBudget : -INF;
  if (turrets.length > harvesters.length || turrets.length < profile.maxTurrets) {
    const role = turrets.length > harvesters.length ? 'economy' : 'defense';
    const stall = stallFor(entity, role, surplus);
    if (stall && reachable(level, brain, stall) < INF) {
      useGoal(level, brain, `buy ${role}`, stall);
      return;
    }
  }
  const rich = nearestOf(level, brain, [...q.upgradables].filter((b) => !b.removed && b.team === entity.team
    && b.carriedBy === undefined && b.upgradable!.level < profile.maxUpgrade
    && (upgradeCostOf(b) ?? INF) <= surplus));
  if (rich) {
    useGoal(level, brain, 'upgrade', rich, 'upgradeId');
    return;
  }

  // Stage a small fleet as the connected line grows, not only after it reaches treasure.
  const desiredCarriages = carriageDemand(level, entity, profile);
  if (!needsBaseDefense && desiredCarriages > ownCarriages(entity) && money >= carriageCost()
    && brain.age - brain.lastCarriageAt >= CARRIAGE_DELAY) {
    const spot = carriageSpot(level, entity, field);
    if (spot >= 0) {
      setGoal(brain, level, { name: 'carriage', tile: spot, build: 'carriage' });
      return;
    }
  }

  // 5. Track to the treasure, once the base has its opening defenses.
  if (!needsBaseDefense && !savingForGuard && brain.age >= profile.railDelay && plan && plan.length > 0 && money >= railCost()) {
    const next = plan[0];
    if (Number.isFinite(field.dist[next])) {
      setGoal(brain, level, { name: 'rail', tile: next, build: 'rail' });
      return;
    }
  }

  // 7. A harvester for every turret.
  if (turrets.length > harvesters.length) {
    const stall = stallFor(entity, 'economy', harvesters.length === 0 ? spare + profile.reserve : spare);
    if (stall && reachable(level, brain, stall) < INF) {
      useGoal(level, brain, 'buy economy', stall);
      return;
    }
  }

  // 8. More defence.
  if (turrets.length < profile.maxTurrets) {
    const surplus = brain.railDone || brain.age < profile.railDelay || !plan;
    const stall = stallFor(entity, 'defense', surplus ? spare : spare - trackBudget);
    if (stall && reachable(level, brain, stall) < INF) {
      useGoal(level, brain, 'buy defense', stall);
      return;
    }
  }

  // 9. Upgrades.
  const upgradable = [...q.upgradables].filter((b) => !b.removed && b.team === entity.team && b.carriedBy === undefined
    && b.upgradable!.level < profile.maxUpgrade && (upgradeCostOf(b) ?? INF) <= spare);
  const up = nearestOf(level, brain, upgradable);
  if (up) {
    useGoal(level, brain, 'upgrade', up, 'upgradeId');
    return;
  }

  // 10. With nothing affordable to do, loot lying about: close coins, or rich drops further away; chests are opened.
  const loot = nearestLoot(level, brain);
  if (loot) {
    setGoal(brain, level, { name: 'loot', tile: tileOf(level, loot.position!.x, loot.position!.y), walk: true });
    return;
  }
  const chest = nearestOf(level, brain, [...q.buildings].filter((b) => b.chest && !b.chest.opened), LOOT_DETOUR * 1.5);
  if (chest) {
    useGoal(level, brain, 'chest', chest);
    return;
  }

  // 11. Otherwise hunt: rival players in versus, then nests and mobs; or wait by the treasure.
  const prey = nearestOf(level, brain, [...world.with('position', 'health')].filter((e) =>
    hostile(entity, e) && (e.playerInput !== undefined || e.spawner !== undefined || e.ai !== undefined)));
  if (prey) {
    const t = approachTile(level, field, tileOf(level, prey.position!.x, prey.position!.y));
    setGoal(brain, level, { name: 'hunt', tile: t, huntId: world.id(prey)! });
    return;
  }
  const treasure = treasureOf();
  if (treasure) {
    const t = approachTile(level, field, tileOf(level, treasure.position!.x, treasure.position!.y + TILE_HEIGHT));
    if (t >= 0 && field.dist[t] > 0) {
      setGoal(brain, level, { name: 'roam', tile: t, walk: true });
      return;
    }
  }

  // Idle: never stand on the track, where carriages would be held up.
  if (onTrack(level, field.origin)) {
    let best = -1;
    for (let t = 0; t < field.dist.length; t++) {
      if (!Number.isFinite(field.dist[t]) || onTrack(level, t)) continue;
      if (best < 0 || field.dist[t] < field.dist[best]) best = t;
    }
    if (best >= 0) setGoal(brain, level, { name: 'clear track', tile: best, walk: true });
  }
}

/**
 * Laid track of ours beyond the home defences that no turret of ours covers: its
 * length in tiles and the stretch farthest from home, where the next turret goes.
 */
function unguardedTrack(level: Level, entity: Entity, field: Field): { x: number; y: number; count: number } | null {
  const home = level.getRandomSpawnPoint(entity.team ?? Team.Two);
  if (!home) return null;
  const turrets = ownBuildings(entity, 'defense').filter((b) => b.turret && alive(b) && b.carriedBy === undefined);
  let best: { x: number; y: number } | null = null;
  let bestDist = BASE_DEFENSE_RANGE;
  let count = 0;
  for (let t = 0; t < level.width * level.height; t++) {
    const tile = tileAt(level, t);
    if (!tile || !RAIL_TYPES.has(tile.type) || tile.team !== entity.team || !Number.isFinite(field.dist[t])) continue;
    const p = { x: centreX(t % level.width), y: centreY(Math.floor(t / level.width)) };
    const d = dist(p, home);
    if (d <= BASE_DEFENSE_RANGE || turrets.some((b) => dist(b.position!, p) < b.turret!.radius * 0.85)) continue;
    count++;
    if (d > bestDist) {
      best = p;
      bestDist = d;
    }
  }
  return best ? { ...best, count } : null;
}

/** Track, or a tile touching it, where anything set down would hold up carriages. */
function besideTrack(level: Level, t: number): boolean {
  if (onTrack(level, t)) return true;
  const tx = t % level.width;
  const ty = (t - tx) / level.width;
  for (const [dx, dy] of DIRS) {
    const nx = tx + dx;
    const ny = ty + dy;
    if (nx >= 0 && ny >= 0 && nx < level.width && ny < level.height && onTrack(level, nx + ny * level.width)) return true;
  }
  return false;
}

/** Puts the load down right here, unless here is on or against the track (or its planned route); then the nearest clear tile. */
function stashGoal(level: Level, brain: Brain): void {
  const field = brain.field!;
  const planned = new Set(brain.railPlan);
  const clear = (t: number) => tileAt(level, t)?.buildable === true && !besideTrack(level, t) && !planned.has(t);
  if (clear(field.origin)) {
    setGoal(brain, level, { name: 'stash', tile: field.origin, drop: true, stash: true });
    return;
  }
  let best = -1;
  for (let t = 0; t < field.dist.length; t++) {
    if (field.dist[t] > 8 || !clear(t)) continue;
    if (best < 0 || field.dist[t] < field.dist[best]) best = t;
  }
  if (best >= 0) setGoal(brain, level, { name: 'stash', tile: best, drop: true });
  else setGoal(brain, level, { name: 'stash', tile: field.origin, drop: true, stash: true });
}

function onTrack(level: Level, t: number): boolean {
  const type = tileAt(level, t)?.type;
  return type === TileType.Rail || type === TileType.PlayerRail || type === TileType.UnbreakableRail;
}

function goalStillValid(level: Level, entity: Entity, brain: Brain, g: Goal): boolean {
  if (g.drop) return entity.carryingId !== undefined && !g.faceTile;
  if (entity.carryingId !== undefined) return false;
  const id = g.useId ?? g.upgradeId;
  if (id !== undefined) {
    const target = world.entity(id);
    if (!target || target.removed || target.carriedBy !== undefined) return false;
    if (target.shopItem) return entity.playerStats!.score >= target.shopItem.cost;
    if (target.harvester && g.useId !== undefined) return target.harvester.collected > 0 && !target.harvester.emptying;
    if (target.chest) return !target.chest.opened;
    if (g.upgradeId !== undefined) return (upgradeCostOf(target) ?? INF) <= entity.playerStats!.score;
    return true;
  }
  if (g.build === 'rail') {
    const tile = level.getTile(g.tile % level.width, Math.floor(g.tile / level.width));
    return brain.railPlan[0] === g.tile && tile?.buildable === true && entity.playerStats!.score >= railCost();
  }
  if (g.build === 'carriage') return entity.playerStats!.score >= carriageCost();
  return false;
}

function enemiesNear(entity: Entity, range: number): boolean {
  for (const e of world.with('position', 'health')) {
    if ((e.ai || e.playerInput) && hostile(entity, e) && dist(e.position!, entity.position!) < range) return true;
  }
  return false;
}

/** Mobs within range that can actually get at the entity (not shut in behind a wall). */
function mobsNear(level: Level, entity: Entity, range: number, pos = entity.position!): number {
  let count = 0;
  for (const e of world.with('position', 'ai')) {
    if (hostile(entity, e) && dist(e.position!, pos) < range
      && level.checkLineOfSight(pos.x, pos.y, e.position!.x, e.position!.y)) count++;
  }
  return count;
}

/** Direction away from the mobs pressing in, weighted by closeness; null when none are close. */
function crowdEscape(level: Level, entity: Entity, range: number): { x: number; y: number; count: number } | null {
  const pos = entity.position!;
  let x = 0;
  let y = 0;
  let count = 0;
  for (const e of world.with('position', 'ai')) {
    if (!hostile(entity, e)) continue;
    const dx = pos.x - e.position!.x;
    const dy = pos.y - e.position!.y;
    const d = Math.hypot(dx, dy);
    if (d >= range || !level.checkLineOfSight(pos.x, pos.y, e.position!.x, e.position!.y)) continue;
    const w = (range - d) / range / Math.max(d, 1);
    x += dx * w;
    y += dy * w;
    count++;
  }
  return count > 0 && (x !== 0 || y !== 0) ? { x, y, count } : null;
}

function nearestLoot(level: Level, brain: Brain): Entity | null {
  let best: Entity | null = null;
  let bestScore = INF;
  for (const coin of q.loot) {
    if (coin.removed || (coin.loot!.burstTicks ?? 0) > 0) continue;
    const limit = coin.loot!.value >= RICH_LOOT ? RICH_LOOT_DETOUR : LOOT_DETOUR;
    const d = walkDistance(level, brain.field!, coin.position!.x, coin.position!.y);
    if (d > limit) continue;
    // Prefer worthwhile pickups a little.
    const score = d - Math.min(80, coin.loot!.value / 2);
    if (score < bestScore) {
      bestScore = score;
      best = coin;
    }
  }
  return best;
}

function tileAt(level: Level, t: number) {
  return level.getTile(t % level.width, Math.floor(t / level.width));
}

/** Cheapest stall of a role, to know what to save up for. */
function cheapestStall(entity: Entity, role: ShopRole): Entity | null {
  let best: Entity | null = null;
  for (const stall of q.shopItems) {
    if (stall.team !== entity.team || stall.removed || SHOP_DEFS[stall.shopItem!.kind].role !== role) continue;
    if (!best || stall.shopItem!.cost < best.shopItem!.cost) best = stall;
  }
  return best;
}

/** Open floor beside a wall, where a bomb can be put against it. */
function besideWall(level: Level, field: Field, wall: number): number {
  const wx = wall % level.width;
  const wy = (wall - wx) / level.width;
  let best = -1;
  let bestScore = INF;
  for (let dy = -1; dy <= 1; dy++) {
    for (let dx = -1; dx <= 1; dx++) {
      if (dx === 0 && dy === 0) continue;
      const tile = level.getTile(wx + dx, wy + dy);
      const t = wx + dx + (wy + dy) * level.width;
      if (!tile?.passable || !Number.isFinite(field.dist[t])) continue;
      // Square to the wall on bare floor is best; the bomb cannot sit on track.
      const score = field.dist[t] + (dx !== 0 && dy !== 0 ? 20 : 0) + (tile.buildable ? 0 : 40);
      if (score < bestScore) {
        bestScore = score;
        best = t;
      }
    }
  }
  return best;
}

function clearOfBlast(entity: Entity, bomb: Entity): boolean {
  const bx = tileX(bomb.position!.x);
  const by = tileY(bomb.position!.y - (bomb.yOffset ?? 0));
  const reach = bomb.bomb!.blastTiles;
  const r = entity.radius ?? { x: 10, y: 10 };
  return Math.abs(entity.position!.x - centreX(bx)) >= (reach + 0.5) * TILE_WIDTH + r.x
    || Math.abs(entity.position!.y - centreY(by)) >= (reach + 0.5) * TILE_HEIGHT + r.y;
}

/** A reachable tile outside the actual blast, preferably with extra clearance. */
function blastCover(level: Level, field: Field, bomb: Entity, needsShot = true): number {
  const bp = bomb.position!;
  const bx = tileX(bp.x);
  const by = tileY(bp.y - (bomb.yOffset ?? 0));
  const reach = bomb.bomb!.blastTiles;
  let best = -1;
  let bestScore = INF;
  for (let ty = by - reach - 6; ty <= by + reach + 6; ty++) {
    for (let tx = bx - reach - 6; tx <= bx + reach + 6; tx++) {
      const clearance = Math.max(Math.abs(tx - bx), Math.abs(ty - by)) - reach;
      if (clearance <= 0) continue;
      if (tx < 0 || ty < 0 || tx >= level.width || ty >= level.height) continue;
      const t = tx + ty * level.width;
      if (!Number.isFinite(field.dist[t])) continue;
      if (needsShot && !level.checkLineOfSight(centreX(tx), centreY(ty), bp.x, bp.y)) continue;
      const score = field.dist[t] + (needsShot ? Math.max(0, BLAST_CLEARANCE - clearance) * 4 : 0);
      if (score < bestScore) {
        best = t;
        bestScore = score;
      }
    }
  }
  return best;
}

function ownCarriages(entity: Entity): number {
  let count = 0;
  for (const d of world.with('railDroid')) if (!d.removed && d.team === entity.team) count++;
  return count;
}

function carriageDemand(level: Level, entity: Entity, profile: AIDifficulty): number {
  const connected = new Set<number>();
  const queue: number[] = [];
  for (let ty = 0; ty < level.height; ty++) {
    for (let tx = 0; tx < level.width; tx++) {
      const tile = level.getTile(tx, ty);
      if (tile?.type !== TileType.PlayerRail || tile.team !== entity.team) continue;
      const t = tx + ty * level.width;
      connected.add(t);
      queue.push(t);
    }
  }
  for (let i = 0; i < queue.length; i++) {
    const cur = queue[i];
    const x = cur % level.width;
    const y = Math.floor(cur / level.width);
    for (const [dx, dy] of DIRS) {
      if (!railJoins(level, x, y, dx, dy)) continue;
      const tile = level.getTile(x + dx, y + dy)!;
      if (tile.team !== undefined && tile.team !== entity.team) continue;
      const t = x + dx + (y + dy) * level.width;
      if (!connected.has(t)) {
        connected.add(t);
        queue.push(t);
      }
    }
  }
  const outward = queue.filter((t) => tileAt(level, t)?.type === TileType.Rail).length;
  const treasure = treasureOf();
  const reachesTreasure = treasure !== null && [...treasureReachTiles(level, treasure)].some((t) => connected.has(t));
  if (!reachesTreasure && outward < 6) return 0;
  return Math.min(profile.maxCarriages, reachesTreasure ? profile.maxCarriages : 2, Math.max(1, Math.ceil(outward / 12)));
}

/** A tile of the team's own base track with no carriage on it. */
function carriageSpot(level: Level, entity: Entity, field: Field): number {
  const props = [...world.with('position')].filter((e) => !e.removed && e.carriedBy === undefined
    && (e.shopItem !== undefined || e.building !== undefined));
  let best = -1;
  for (let t = 0; t < field.dist.length; t++) {
    if (!Number.isFinite(field.dist[t])) continue;
    const tx = t % level.width;
    const ty = (t - tx) / level.width;
    const tile = level.getTile(tx, ty);
    if (tile?.type !== TileType.PlayerRail || tile.team !== entity.team) continue;
    if (!canSpawnRailDroid(level, centreX(tx), centreY(ty))) continue;
    // A stall or building within reach would take the key press instead of the track.
    if (props.some((b) => dist(b.position!, { x: centreX(tx), y: centreY(ty) }) < INTERACT_REACH + (b.radius?.x ?? 10) + 8)) continue;
    if (best < 0 || field.dist[t] < field.dist[best]) best = t;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Fighting.

function pickEnemy(level: Level, entity: Entity, profile: AIDifficulty, focusId?: number): Entity | null {
  const pos = entity.position!;
  const weapon = entity.weaponInventory!.weapons;
  const reach = Math.min(profile.engageRange,
    Math.max(...weapon.map((w) => BULLET_CONFIGS[WEAPON_STATS[w]?.bullet]?.range ?? 0)));
  let best: Entity | null = null;
  let bestScore = INF;
  for (const e of world.with('position', 'health')) {
    if (!hostile(entity, e)) continue;
    const d = dist(e.position!, pos);
    if (d > reach || !level.checkLineOfSight(pos.x, pos.y, e.position!.x, e.position!.y)) continue;
    // People first, then whatever is closest; property last.
    let score = d;
    // What it set out to hunt comes first, unless something is already biting.
    if (focusId !== undefined && world.id(e) === focusId) score -= 200;
    else if (e.ai && d < 40) score -= 300;
    if (e.playerInput) score -= 120;
    else if (e.building || e.railDroid) score += 80;
    if (score < bestScore) {
      bestScore = score;
      best = e;
    }
  }
  return best;
}

/** Whether firing a gun along the current aim would shove the shooter into a pit. */
function kickedIntoPit(level: Level, entity: Entity, weapon: string): boolean {
  const aim = entity.aimVector;
  if (!aim) return false;
  // Recoil goes into velocity, which friction (0.4) lets coast about 1.7 times as far.
  const kick = (WEAPON_STATS[weapon]?.recoil ?? 0) * 1.7 + 6;
  const type = level.getTileAt(entity.position!.x - aim.x * kick, entity.position!.y - aim.y * kick)?.type;
  return type === TileType.Hole || type === TileType.DropTrap;
}

/** Whether an unlit bomb lies close to the line of fire, short of the target. */
function bombInLine(entity: Entity, angle: number, reach: number): boolean {
  const pos = entity.position!;
  const ux = Math.cos(angle);
  const uy = Math.sin(angle);
  for (const b of world.with('bomb', 'position')) {
    if (b.removed || b.bomb!.lit || b.carriedBy !== undefined) continue;
    const dx = b.position!.x - pos.x;
    const dy = b.position!.y - (b.yOffset ?? 0) / 2 - pos.y;
    const along = dx * ux + dy * uy;
    if (along < -8 || along > reach + 16) continue;
    // Spread widens the cone a little with distance.
    if (Math.abs(dx * uy - dy * ux) < 16 + Math.max(0, along) * 0.15) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Per-tick control.

type Controls = { up: boolean; down: boolean; left: boolean; right: boolean; sprint: boolean };

function steerTo(entity: Entity, x: number, y: number, deadzone: number, out: Controls): void {
  const pos = entity.position!;
  const dx = x - pos.x;
  const dy = y - pos.y;
  out.right = dx > deadzone;
  out.left = dx < -deadzone;
  out.down = dy > deadzone;
  out.up = dy < -deadzone;
}

function setAim(entity: Entity, x: number, y: number): void {
  const len = Math.hypot(x, y);
  if (len === 0) return;
  const aim = { x: x / len, y: y / len };
  entity.aimVector = { ...aim };
  entity.playerInput!.keyAim = aim;
}

/** Aims in some direction where nothing is in reach, so the build key works the floor. */
function aimAtNothing(entity: Entity): boolean {
  const saved = entity.aimVector ? { ...entity.aimVector } : undefined;
  const dirs = [[0, 1], [1, 0], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
  for (const [x, y] of dirs) {
    setAim(entity, x, y);
    if (!hitByAimLine(entity)) return true;
  }
  if (saved) setAim(entity, saved.x, saved.y);
  return false;
}

/** Faces an entity and reports whether it is the one the aim line would act on. */
function reachFor(entity: Entity, target: Entity): boolean {
  const pos = entity.position!;
  const at = target.position!;
  if (dist(pos, at) > INTERACT_REACH + (target.radius?.x ?? 10)) return false;
  setAim(entity, at.x - pos.x, at.y - pos.y);
  return hitByAimLine(entity) === target;
}

function clearIntents(entity: Entity): void {
  const it = entity.playerInput!.intents;
  it.weaponSlot = -1;
  it.weaponStep = 0;
  it.use = false;
  it.build = false;
  it.upgrade = false;
}

function control(level: Level, entity: Entity, brain: Brain, profile: AIDifficulty): void {
  const pi = entity.playerInput!;
  const pos = entity.position!;
  const out: Controls = { up: false, down: false, left: false, right: false, sprint: false };
  let aimed = false;
  let shooting = false;
  const goal = brain.goal;

  // --- the goal's action, once there
  if (goal) {
    const targetId = goal.useId ?? goal.upgradeId;
    const target = targetId !== undefined ? world.entity(targetId) : undefined;
    const tx = goal.tile % level.width;
    const ty = Math.floor(goal.tile / level.width);
    const onTile = tileOf(level, pos.x, pos.y) === goal.tile;
    const centred = Math.abs(pos.x - centreX(tx)) <= 6 && Math.abs(pos.y - centreY(ty)) <= 6;

    if (target && reachFor(entity, target)) {
      aimed = true;
      brain.path = [];
      if (goal.upgradeId !== undefined) pi.intents.upgrade = true;
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
    const next = brain.path[0];
    const nx = centreX(next % level.width);
    const ny = centreY(Math.floor(next / level.width));
    if (Math.abs(pos.x - nx) <= 3 && Math.abs(pos.y - ny) <= 3) brain.path.shift();
    if (brain.path.length > 0) {
      const wp = brain.path[0];
      steerTo(entity, centreX(wp % level.width), centreY(Math.floor(wp / level.width)), 1.5, out);
      out.sprint = profile.sprint && brain.path.length > 6 && entity.carryingId === undefined;
    } else if (goal && !goal.walk) {
      steerTo(entity, nx, ny, 1.5, out);
    }
  } else if (goal && (goal.drop || goal.build)) {
    const tx = goal.tile % level.width;
    steerTo(entity, centreX(tx), centreY(Math.floor(goal.tile / level.width)), 1.5, out);
  }

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
  if (alive(enemy) && !aimed && entity.carryingId === undefined && goal?.name !== 'escape blast') {
    const at = enemy.position!;
    const d = dist(at, pos);
    if (brain.reaction > 0) brain.reaction--;
    if (--brain.triggerTicks <= 0) {
      brain.trigger = Math.random() < profile.fireRate;
      brain.triggerTicks = 8 + Math.floor(Math.random() * 10);
      brain.jitter = (Math.random() * 2 - 1) * profile.aimError;
    }
    // Lead moving targets a little on the higher difficulties.
    const lead = profile.aimError < 0.1 && enemy.velocity ? d / 8 : 0;
    const ax = at.x + (enemy.velocity?.x ?? 0) * lead - pos.x;
    const ay = at.y - (enemy.yOffset ?? 0) / 2 + (enemy.velocity?.y ?? 0) * lead - pos.y;
    const angle = Math.atan2(ay, ax) + brain.jitter;
    setAim(entity, Math.cos(angle), Math.sin(angle));
    aimed = true;
    shooting = brain.reaction <= 0 && brain.trigger && !bombInLine(entity, Math.atan2(ay, ax), d);

    // Switch to whichever gun suits the distance.
    if (brain.swapTicks > 0) brain.swapTicks--;
    const slot = bestSlot(entity, d, (w) => !kickedIntoPit(level, entity, w));
    if (slot !== entity.weaponInventory!.current && brain.swapTicks <= 0) {
      pi.intents.weaponSlot = slot;
      brain.swapTicks = SWAP_DELAY;
    }

    // Keep some distance from things that bite, when not walking anywhere in particular.
    if (!moving && enemy.ai && d < 40) steerTo(entity, pos.x * 2 - at.x, pos.y * 2 - at.y, 0, out);
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

/**
 * Plays every computer-controlled player: re-plans every few ticks (how often
 * depends on its difficulty), then steers, aims and presses keys each tick.
 * Runs right after keyboard input, before targeting and interaction read it.
 */
export function updateAIPlayers(level: Level): void {
  for (const entity of world.with('aiPlayer', 'playerInput', 'position', 'playerStats', 'weaponInventory', 'health')) {
    if (entity.removed) continue;
    const brain = brainOf(entity);
    const pi = entity.playerInput!;
    clearIntents(entity);
    pi.up = pi.down = pi.left = pi.right = pi.shoot = pi.sprint = false;

    if (entity.respawnTicks !== undefined || entity.falling || entity.health!.current <= 0) {
      // Plans made before dying are stale.
      brain.goal = null;
      brain.path = [];
      brain.enemyId = undefined;
      brain.think = 0;
      continue;
    }
    brain.age++;
    const profile = profileOf(entity);

    const blastDanger = [...world.with('position', 'bomb')].some((b) => !b.removed && b.carriedBy === undefined
      && b.bomb!.lit && !clearOfBlast(entity, b));
    if (blastDanger && brain.goal?.name !== 'escape blast') brain.think = 0;
    if (entity.carryingId === undefined && entity.health!.current < entity.health!.max * profile.retreatHealth
      && enemiesNear(entity, 160) && brain.goal?.name !== 'retreat') brain.think = 0;
    if (--brain.think <= 0) {
      think(level, entity, brain, profile);
      brain.think = profile.thinkTicks;
    }

    // Spotting enemies happens more often than planning, but still with a reaction delay.
    if (brain.age % 4 === 0 || (brain.enemyId !== undefined && !alive(world.entity(brain.enemyId)))) {
      const enemy = pickEnemy(level, entity, profile, brain.goal?.huntId);
      const id = enemy ? world.id(enemy) : undefined;
      if (id !== brain.enemyId) {
        brain.enemyId = id;
        brain.reaction = profile.reactionTicks;
      }
    }

    control(level, entity, brain, profile);
  }
}
