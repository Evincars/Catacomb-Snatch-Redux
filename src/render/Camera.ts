/** Internal resolution of the game surface, before the stage is scaled up. */
export const GAME_WIDTH = 320;
export const GAME_HEIGHT = 240;
export const SCALE = 3;

/** Top-left of the visible area in world coordinates. */
export const camera = { x: 0, y: 0 };

export function screenToWorld(sx: number, sy: number): { x: number; y: number } {
  return { x: sx + camera.x, y: sy + camera.y };
}
