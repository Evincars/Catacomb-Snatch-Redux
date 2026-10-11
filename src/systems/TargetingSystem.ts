import { world } from '../world';
import type { Entity } from '../world';
import { screenToWorld } from '../render/Camera';

/** Matches Java's INTERACT_DISTANCE of 20px, measured from the reach point. */
export const INTERACT_RANGE = 20;
/** Java probes a point this far in front of the player rather than the player itself. */
export const INTERACT_REACH = 30;
/** How close the pointer must be to an entity's centre to count as hovering it. */
const HOVER_RADIUS = 18;

/** The point the player is reaching toward, ahead of them in their aim direction. */
export function reachPoint(player: Entity): { x: number; y: number } {
  const pos = player.position!;
  const aim = player.aimVector;
  const len = aim ? Math.hypot(aim.x, aim.y) : 0;
  if (!aim || len === 0) return { x: pos.x, y: pos.y };
  return { x: pos.x + (aim.x / len) * INTERACT_REACH, y: pos.y + (aim.y / len) * INTERACT_REACH };
}

/** Whether a player may interact with this entity: stalls belong to a team, buildings are free for all. */
function usableBy(player: Entity, candidate: Entity): boolean {
  if (candidate.carriedBy !== undefined) return false;
  if (candidate.shopItem) return candidate.team === player.team;
  return candidate.building !== undefined;
}

/** Visual centre of an entity, which is where the eye expects a marker or hover to be. */
function centreOf(entity: Entity): { x: number; y: number } {
  const p = entity.position!;
  return { x: p.x, y: p.y - (entity.yOffset ?? 0) };
}

function closest(player: Entity, from: { x: number; y: number }, maxDist: number, useCentre: boolean): Entity | null {
  let best: Entity | null = null;
  let bestDist = maxDist * maxDist;

  for (const candidate of world.with('position', 'tooltip')) {
    if (!usableBy(player, candidate)) continue;
    const at = useCentre ? centreOf(candidate) : candidate.position!;
    const d = (at.x - from.x) ** 2 + (at.y - from.y) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = candidate;
    }
  }
  return best;
}

/**
 * Works out what each player is reaching for and what the pointer is over,
 * recording it as `targeted` / `hovered` tags so marker and tooltip systems
 * can react without knowing anything about shops or buildings.
 */
export function updateTargeting(): void {
  for (const entity of world.with('targeted')) world.removeComponent(entity, 'targeted');
  for (const entity of world.with('hovered')) world.removeComponent(entity, 'hovered');

  for (const player of world.with('position', 'playerInput')) {
    // A carried building is already in hand; nothing else can be targeted.
    if (player.carryingId !== undefined) {
      delete player.targetId;
      continue;
    }

    const target = closest(player, reachPoint(player), INTERACT_RANGE, false);
    if (target) {
      player.targetId = world.id(target)!;
      world.addComponent(target, 'targeted', true);
    } else {
      delete player.targetId;
    }

    const pi = player.playerInput!;
    const hovered = closest(player, screenToWorld(pi.mouseX, pi.mouseY), HOVER_RADIUS, true);
    if (hovered) world.addComponent(hovered, 'hovered', true);
  }
}

export function targetOf(player: Entity): Entity | null {
  return player.targetId === undefined ? null : (world.entity(player.targetId) ?? null);
}
