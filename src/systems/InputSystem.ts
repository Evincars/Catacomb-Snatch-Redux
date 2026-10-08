import { q, world } from '../world';

const keys = new Set<string>();
let mouseX = 0;
let mouseY = 0;
let mouseDown = false;
let mouseRight = false;

export function initInput(canvas: HTMLCanvasElement): void {
  window.addEventListener('keydown', e => keys.add(e.code));
  window.addEventListener('keyup', e => keys.delete(e.code));
  canvas.addEventListener('mousemove', e => {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    mouseX = (e.clientX - rect.left) * scaleX;
    mouseY = (e.clientY - rect.top) * scaleY;
  });
  canvas.addEventListener('mousedown', e => {
    if (e.button === 0) mouseDown = true;
    if (e.button === 2) mouseRight = true;
  });
  canvas.addEventListener('mouseup', e => {
    if (e.button === 0) mouseDown = false;
    if (e.button === 2) mouseRight = false;
  });
  canvas.addEventListener('contextmenu', e => e.preventDefault());
}

export function updateInput(_dt: number): void {
  for (const entity of q.players) {
    if (!entity.playerInput) continue;
    const pi = entity.playerInput;
    pi.up    = keys.has('KeyW') || keys.has('ArrowUp');
    pi.down  = keys.has('KeyS') || keys.has('ArrowDown');
    pi.left  = keys.has('KeyA') || keys.has('ArrowLeft');
    pi.right = keys.has('KeyD') || keys.has('ArrowRight');
    pi.shoot = mouseDown;
    pi.use   = mouseRight || keys.has('KeyE');
    pi.mouseX = mouseX;
    pi.mouseY = mouseY;
    pi.mouseAiming = true;
  }
}
