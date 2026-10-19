import { q } from '../world';
import { GAME_WIDTH, GAME_HEIGHT } from '../render/Camera';
import { bindingFor } from '../game/Settings';
import type { ActionName } from '../game/Settings';

const keys = new Set<string>();
/** Key codes that went down since the last tick, ignoring OS key repeat. */
const pending = new Set<string>();
let pressed = new Set<string>();
let wheel = 0;
let mouseX = 0;
let mouseY = 0;
let mouseDown = false;
let mouseRight = false;
let rightPending = false;
let bound = false;
let captured = false;

/** While the console is open, typing must not move, shoot or buy anything. */
export function setInputCaptured(on: boolean): void {
  captured = on;
  keys.clear();
  resetInput();
}

/** Logical (unscaled) pointer position within the 512x384 surface. */
export function pointer(): { x: number; y: number } {
  return { x: mouseX, y: mouseY };
}

export function isKeyDown(code: string): boolean {
  return keys.has(code);
}

/** True while the key bound to this action is held. */
export function isActionDown(action: ActionName): boolean {
  const code = bindingFor(action);
  return code !== '' && keys.has(code);
}

/** True for the single tick after the key bound to this action went down. */
export function wasActionPressed(action: ActionName): boolean {
  const code = bindingFor(action);
  return code !== '' && pressed.has(code);
}

/** Forgets queued presses, so keys hit while paused do not fire on resume. */
export function resetInput(): void {
  pending.clear();
  pressed.clear();
  wheel = 0;
  rightPending = false;
}

export function initInput(canvas: HTMLCanvasElement): void {
  if (bound) return;
  bound = true;

  window.addEventListener('keydown', (e) => {
    // Typing in a text box (a player name) is not a game key.
    if (e.target instanceof HTMLInputElement) return;
    // Stop the page from scrolling under the canvas.
    if (e.code.startsWith('Arrow') || e.code === 'Space' || e.code === 'Tab') e.preventDefault();
    if (captured) return;
    keys.add(e.code);
    if (!e.repeat) pending.add(e.code);
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
    if (e.button === 2) {
      mouseRight = true;
      rightPending = true;
    }
  });
  window.addEventListener('mouseup', (e) => {
    if (e.button === 0) mouseDown = false;
    if (e.button === 2) mouseRight = false;
  });
  canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  canvas.addEventListener(
    'wheel',
    (e) => {
      wheel += Math.sign(e.deltaY);
      e.preventDefault();
    },
    { passive: false },
  );
}

const WEAPON_SLOTS: ActionName[] = ['weapon_slot_1', 'weapon_slot_2', 'weapon_slot_3'];
const FIRE_DIRECTIONS: Array<[ActionName, number, number]> = [
  ['fire_up', 0, -1],
  ['fire_down', 0, 1],
  ['fire_left', -1, 0],
  ['fire_right', 1, 0],
];

/** Turns raw keyboard and mouse state into components on each player. */
export function updateInput(_dt: number): void {
  pressed = new Set(pending);
  pending.clear();

  const rightClick = rightPending && !captured;
  rightPending = false;
  const step = captured ? 0 : Math.sign(wheel);
  wheel = 0;

  let aimX = 0;
  let aimY = 0;
  for (const [action, dx, dy] of FIRE_DIRECTIONS) {
    if (!isActionDown(action)) continue;
    aimX += dx;
    aimY += dy;
  }
  const keyAimed = aimX !== 0 || aimY !== 0;
  const aimLen = Math.hypot(aimX, aimY) || 1;

  for (const entity of q.players) {
    if (entity.remoteInput) continue;
    const pi = entity.playerInput!;
    pi.up    = isActionDown('up');
    pi.down  = isActionDown('down');
    pi.left  = isActionDown('left');
    pi.right = isActionDown('right');
    pi.sprint = isActionDown('sprint');
    pi.keyAim = keyAimed ? { x: aimX / aimLen, y: aimY / aimLen } : null;
    pi.shoot = !captured && (mouseDown || isActionDown('fire') || keyAimed);
    pi.use   = !captured && (mouseRight || isActionDown('use'));
    pi.mouseX = mouseX;
    pi.mouseY = mouseY;
    pi.mouseAiming = true;

    const it = pi.intents;
    it.use = rightClick || wasActionPressed('use');
    it.build = wasActionPressed('build');
    it.upgrade = wasActionPressed('upgrade');
    it.weaponSlot = WEAPON_SLOTS.findIndex((a) => wasActionPressed(a));
    it.weaponStep =
      (wasActionPressed('next_weapon') ? 1 : 0) - (wasActionPressed('prev_weapon') ? 1 : 0) || step;
  }
}
