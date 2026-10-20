import { world } from '../world';
import type { Entity } from '../world';
import { screenToWorld } from '../render/Camera';
import { sheetInfo } from '../render/Sheets';
import { TILE_HEIGHT } from '../level/TileType';
import { isVersus } from '../game/GameState';

const inspectable = world.with('position', 'tooltip');

/** How far ahead of the player their aim line reaches. */
export const INTERACT_REACH = 36;
/** Slack added to a candidate's own radius when testing the aim line against it. */
const HIT_SLACK = 2;
/** How close the pointer must be to an entity's centre to count as hovering it. */
const HOVER_RADIUS = 18;

/** The point the player is reaching toward, ahead of them in their aim direction. */
export function reachPoint(player: Entity, distance = INTERACT_REACH): { x: number; y: number } {
  const pos = player.position!;
  const aim = player.aimVector;
  const len = aim ? Math.hypot(aim.x, aim.y) : 0;
  if (!aim || len === 0) return { x: pos.x, y: pos.y };
  return { x: pos.x + (aim.x / len) * distance, y: pos.y + (aim.y / len) * distance };
}

/** Whether a player may interact with this entity: stalls belong to a team, buildings and nests are free for all. */
function usableBy(player: Entity, candidate: Entity): boolean {
  if (candidate.removed || candidate.chest?.opened) return false;
  if (candidate.carriedBy !== undefined) return false;
  if (candidate.shopItem) return candidate.team === player.team;
  // The rival's turrets and harvesters cannot be used, so they are not offered or marked either.
  if (isVersus() && candidate.building && !candidate.bomb && candidate.team
    && candidate.team !== player.team) return false;
  return candidate.building !== undefined || candidate.spawner !== undefined;
}

/** Visual centre of an entity, which is where the eye expects a marker or hover to be. */
export function centreOf(entity: Entity): { x: number; y: number } {
  const p = entity.position!;
  // The chest strip leaves room above the closed body for its raised lid.
  const lidSpace = entity.chest && entity.visual
    ? (sheetInfo(entity.visual.sheet).frameHeight - TILE_HEIGHT) / 2
    : 0;
  const bodyOffset = entity.harvester ? TILE_HEIGHT / 2 : lidSpace;
  return { x: p.x, y: p.y - (entity.yOffset ?? 0) + bodyOffset };
}

/** Nearest candidate to a point, used for pointer hover. */
function closest(player: Entity, from: { x: number; y: number }, maxDist: number): Entity | null {
  let best: Entity | null = null;
  let bestDist = maxDist * maxDist;

  for (const candidate of inspectable) {
    if (!usableBy(player, candidate)) continue;
    const at = centreOf(candidate);
    const d = (at.x - from.x) ** 2 + (at.y - from.y) ** 2;
    if (d < bestDist) {
      bestDist = d;
      best = candidate;
    }
  }
  return best;
}

/** The first candidate the player's aim line runs into within reach, or null. */
export function hitByAimLine(player: Entity): Entity | null {
  const from = player.position!;
  const aim = player.aimVector;
  const len = aim ? Math.hypot(aim.x, aim.y) : 0;
  if (!aim || len === 0) return null;
  const dx = aim.x / len;
  const dy = aim.y / len;

  let best: Entity | null = null;
  let bestAlong = Infinity;

  for (const candidate of inspectable) {
    if (!usableBy(player, candidate)) continue;
    const at = candidate.position!;
    const rx = at.x - from.x;
    const ry = at.y - from.y;
    const along = rx * dx + ry * dy;
    const radius = (candidate.radius?.x ?? 10) + HIT_SLACK;
    // The segment may begin inside an object the player is standing against.
    if (along < -radius || along > INTERACT_REACH + radius) continue;

    const across = Math.abs(rx * dy - ry * dx);
    if (across > radius) continue;
    if (along < bestAlong) {
      bestAlong = along;
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
const marked = world.with('targeted');
const pointedAt = world.with('hovered');
const aimers = world.with('position', 'playerInput');

/** Whatever the aim line meets becomes the player's target; the computer's reach is not marked on screen. */
function aimAt(player: Entity): void {
  const target = hitByAimLine(player);
  if (!target) {
    delete player.targetId;
    return;
  }
  player.targetId = world.id(target)!;
  if (!player.aiPlayer) world.addComponent(target, 'targeted', true);
}

/** The local player's cursor highlights what it is over. */
function hoverUnderCursor(player: Entity): void {
  const pi = player.playerInput!;
  const hovered = closest(player, screenToWorld(pi.mouseX, pi.mouseY), HOVER_RADIUS);
  if (hovered) world.addComponent(hovered, 'hovered', true);
}

export function updateTargeting(): void {
  for (const entity of marked) world.removeComponent(entity, 'targeted');
  for (const entity of pointedAt) world.removeComponent(entity, 'hovered');
  for (const player of aimers) {
    // The dead target nothing, and a carried building is already in hand: nothing else can be targeted.
    const idle = player.respawnTicks !== undefined || (player.health?.current ?? 1) <= 0 || player.carryingId !== undefined;
    if (idle) {
      delete player.targetId;
      continue;
    }
    aimAt(player);
    if (!player.remoteInput) hoverUnderCursor(player);
  }
}

export function targetOf(player: Entity): Entity | null {
  return player.targetId === undefined ? null : (world.entity(player.targetId) ?? null);
}
