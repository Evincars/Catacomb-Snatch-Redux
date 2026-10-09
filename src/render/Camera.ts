/** Internal resolution, matching the Java original so its HUD art lines up. */
export const GAME_WIDTH = 512;
export const GAME_HEIGHT = 384;
export const SCALE = 2;

/** Height of the bottom HUD panel; the world viewport is shorter by this much. */
export const PANEL_HEIGHT = 80;
export const VIEW_HEIGHT = GAME_HEIGHT - PANEL_HEIGHT;

/** Top-left of the visible area in world coordinates. */
export const camera = { x: 0, y: 0 };

export function screenToWorld(sx: number, sy: number): { x: number; y: number } {
  return { x: sx + camera.x, y: sy + camera.y };
}
