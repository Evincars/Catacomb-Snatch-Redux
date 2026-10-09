import { q } from '../world';
import { GAME_WIDTH, GAME_HEIGHT } from '../render/Camera';

const keys = new Set<string>();
let mouseX = 0;
let mouseY = 0;
let mouseDown = false;
let mouseRight = false;
let bound = false;

// The use key is edge-triggered: holding it must not buy or drop repeatedly.
let usePressed = false;
let useWasDown = false;

export function wasUsePressed(): boolean {
  return usePressed;
}

/** Logical (unscaled) pointer position within the 320x240 surface. */
export function pointer(): { x: number; y: number } {
  return { x: mouseX, y: mouseY };
}

export function isKeyDown(code: string): boolean {
  return keys.has(code);
}

export function initInput(canvas: HTMLCanvasElement): void {
  if (bound) return;
  bound = true;

  window.addEventListener('keydown', (e) => {
    keys.add(e.code);
    // Stop the page from scrolling under the canvas.
    if (e.code.startsWith('Arrow') || e.code === 'Space') e.preventDefault();
  });
  window.addEventListener('keyup', (e) => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());

  canvas.addEventListener('mousemove', (e) => {
    const rect = canvas.getBoundingClientRect();
    mouseX = ((e.clientX - rect.left) / rect.width) * GAME_WIDTH;
    mouseY = ((e.clientY - rect.top) / rect.height) * GAME_HEIGHT;
  });
  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) mouseDown = true;
    if (e.button === 2) mouseRight = true;
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) mouseDown = false;
    if (e.button === 2) mouseRight = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
}

export function updateInput(_dt: number): void {
  const useDown = mouseRight || keys.has('KeyE');
  usePressed = useDown && !useWasDown;
  useWasDown = useDown;

  for (const entity of q.players) {
    const pi = entity.playerInput!;
    pi.up    = keys.has('KeyW') || keys.has('ArrowUp');
    pi.down  = keys.has('KeyS') || keys.has('ArrowDown');
    pi.left  = keys.has('KeyA') || keys.has('ArrowLeft');
    pi.right = keys.has('KeyD') || keys.has('ArrowRight');
    pi.shoot = mouseDown || keys.has('Space');
    pi.use   = useDown;
    pi.mouseX = mouseX;
    pi.mouseY = mouseY;
    pi.mouseAiming = true;
  }
}
