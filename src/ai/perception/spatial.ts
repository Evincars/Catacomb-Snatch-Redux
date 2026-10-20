import RBush from 'rbush';
import { world } from '../../world';
import type { Entity } from '../../world';

const placed = world.with('position');

/** What an entity is to a computer player: the groups its senses ask about. */
export type Kind = 'player' | 'mob' | 'nest' | 'machine' | 'building' | 'bomb' | 'loot' | 'gun';

type Item = { minX: number; minY: number; maxX: number; maxY: number; entity: Entity; kind: Kind };

const tree = new RBush<Item>();
let builtFor = -1;
let frame = 0;

function kindOf(e: Entity): Kind | null {
  if (e.playerInput) return 'player';
  if (e.ai) return 'mob';
  if (e.spawner) return 'nest';
  if (e.bomb) return 'bomb';
  if (e.turret || e.harvester || e.railDroid) return 'machine';
  if (e.building) return 'building';
  if (e.loot) return 'loot';
  if (e.weaponPickup) return 'gun';
  return null;
}

/** Starts a new tick: every sense this tick reads one snapshot of where things are. */
export function beginPerception(): void {
  frame++;
}

function ensureBuilt(): void {
  if (builtFor === frame) return;
  builtFor = frame;
  tree.clear();
  const items: Item[] = [];
  for (const e of placed) {
    if (e.removed) continue;
    const kind = kindOf(e);
    if (!kind) continue;
    const p = e.position!;
    items.push({ minX: p.x, minY: p.y, maxX: p.x, maxY: p.y, entity: e, kind });
  }
  tree.load(items);
}

/** Entities of the given kinds within `radius` pixels of a point, from the spatial index (an R-tree). */
export function nearby(x: number, y: number, radius: number, kinds?: readonly Kind[]): Entity[] {
  ensureBuilt();
  const found: Entity[] = [];
  const r2 = radius * radius;
  for (const item of tree.search({ minX: x - radius, minY: y - radius, maxX: x + radius, maxY: y + radius })) {
    if (kinds && !kinds.includes(item.kind)) continue;
    const p = item.entity.position!;
    if ((p.x - x) ** 2 + (p.y - y) ** 2 <= r2 && !item.entity.removed) found.push(item.entity);
  }
  return found;
}
