import type { Entity } from '../../world';
import type { Level } from '../../level/Level';
import { TILE_WIDTH, TILE_HEIGHT } from '../../level/TileType';

export const tileX = (x: number) => Math.floor(x / TILE_WIDTH);

export const tileY = (y: number) => Math.floor(y / TILE_HEIGHT);

export const centreX = (tx: number) => tx * TILE_WIDTH + TILE_WIDTH / 2;

export const centreY = (ty: number) => ty * TILE_HEIGHT + TILE_HEIGHT / 2;

export function tileOf(level: Level, x: number, y: number): number {
  return tileX(x) + tileY(y) * level.width;
}

export function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function alive(e: Entity | undefined): e is Entity {
  return e !== undefined && !e.removed && (e.health?.current ?? 1) > 0;
}

export function tileAt(level: Level, t: number) {
  return level.getTile(t % level.width, Math.floor(t / level.width));
}
