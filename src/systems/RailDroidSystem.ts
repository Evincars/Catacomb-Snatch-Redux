import { Rectangle, Sprite } from 'pixi.js';
import type { Container } from 'pixi.js';
import { world } from '../world';
import type { Entity } from '../world';
import { TILE_WIDTH, TILE_HEIGHT, TileType } from '../level/TileType';
import { isRailTile, railJoins } from '../level/RailLayout';
import type { Level } from '../level/Level';
import { frameTexture } from '../render/Sheets';
import { boxAround } from '../core/geometry';
import { move } from './MovementSystem';
import { sound } from '../audio/SoundPlayer';
import { gameState, isVersus } from '../game/GameState';

/** Steady speed of Java's RailDroid (0.7 px of thrust against 0.4 drag). */
const SPEED = 1.15;
/** Closer than this, two carriages (or a carriage and a player) have bumped. */
const BUMP_DIST = 23;

const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
/** raildroid.png cell per heading: [col, row]. */
const FRAMES: Array<[number, number]> = [[0, 1], [1, 0], [0, 0], [1, 1]];
/** bullets.png cells of the pot a carriage holds: empty, and brimming with treasure. */
const POT_EMPTY: [number, number] = [1, 1];
const POT_FULL: [number, number] = [0, 0];
/** The pot rests on the carriage's head (Java carries it 20px above the feet). */
const POT_RAISE = 15;
/** A carriage this close to the treasure pile (Java's getBB().grow(32)) fills its pot. */
const TREASURE_REACH = 32;
/** Ticks between filling and emptying, Java's swapTime. */
const SWAP_TIME = 30;
/** Coins credited to the team for each pot of treasure brought home in a co-operative game. */
export const TREASURE_REWARD = 100;
/** Original versus treasury progress per delivery, independent of the coin reward. */
const TREASURE_PROGRESS = 2;
const HEALTH = 10;
/** A carriage that has gone nowhere in this many ticks while meant to be rolling is wedged. */
const WEDGE_TICKS = 90;
/** Each carriage times its own window, so a jam is never broken by everyone turning at once. */
const WEDGE_JITTER = 90;
const WEDGE_DISTANCE = 6;
/** Carriages closer than this to a tile centre block a new one being set down there. */
const SPAWN_CLEARANCE = 28;

const carriages = world.with('position', 'railDroid');
const pushable = world.with('position', 'radius', 'playerInput');
const buildings = world.with('position', 'building');
const banked = world.with('playerStats', 'playerInput');
const loaded = world.with('railDroid', 'sprite');

/** Scratch boxes for overlap tests; each test fills them and reads them straight away. */
const boxA = new Rectangle();
const boxB = new Rectangle();

export function canSpawnRailDroid(level: Level, x: number, y: number): boolean {
  const tx = Math.floor(x / TILE_WIDTH);
  const ty = Math.floor(y / TILE_HEIGHT);
  if (!isRailTile(level, tx, ty)) return false;
  const cx = tx * TILE_WIDTH + TILE_WIDTH / 2;
  const cy = ty * TILE_HEIGHT + TILE_HEIGHT / 2;
  for (const other of carriages) {
    if (!other.removed && Math.abs(other.position!.x - cx) < SPAWN_CLEARANCE && Math.abs(other.position!.y - cy) < SPAWN_CLEARANCE) return false;
  }
  return true;
}

export function createRailDroid(x: number, y: number, team: number): Entity {
  const tx = Math.floor(x / TILE_WIDTH);
  const ty = Math.floor(y / TILE_HEIGHT);
  return world.add({
    position: { x: tx * TILE_WIDTH + TILE_WIDTH / 2, y: ty * TILE_HEIGHT + TILE_HEIGHT / 2 },
    radius: { x: 10, y: 8 },
    blocking: true,
    team,
    yOffset: 6,
    railDroid: { dir: -1, lastDir: 2, full: false, swapTime: 0 },
    visual: { sheet: 'raildroid', col: 0, row: 0 },
    health: { current: HEALTH, max: HEALTH },
    healthBarOffset: 10,
    hurtTime: 0,
    freezeTime: 0,
    regenTimer: 60,
    regenInterval: 60,
    deathPoints: 0,
    minimapColor: 0xc0c0c0,
  });
}

/** Ways out of a rail tile, never doubling straight back unless it is a dead end. */
function chooseDir(level: Level, tx: number, ty: number, dir: number): number {
  const exits: number[] = [];
  for (let d = 0; d < 4; d++) {
    if (railJoins(level, tx, ty, DX[d], DY[d])) exits.push(d);
  }
  if (exits.length === 0) return -1;
  if (dir < 0) return exits[Math.floor(Math.random() * exits.length)];
  const back = (dir + 2) % 4;
  const onward = exits.filter((d) => d !== back);
  if (onward.length === 0) return back;
  return onward[Math.floor(Math.random() * onward.length)];
}

/** Whether another carriage sits ahead of this one, heading in `dir`. */
function isAhead(self: Entity, other: Entity, dir: number): boolean {
  const dx = other.position!.x - self.position!.x;
  const dy = other.position!.y - self.position!.y;
  const ahead = dx * DX[dir] + dy * DY[dir];
  const aside = Math.abs(dx * DY[dir] - dy * DX[dir]);
  return ahead > 0 && ahead < BUMP_DIST && aside < 12;
}

function boxOf(e: Entity, x = e.position!.x, y = e.position!.y, out = boxA): Rectangle {
  return boxAround(x, y, e.radius!.x, e.radius!.y, out);
}

/** Whether `a` placed at (ax, ay) would overlap `b` placed at (bx, by). */
function overlapAt(a: Entity, ax: number, ay: number, b: Entity, bx = b.position!.x, by = b.position!.y): boolean {
  return boxOf(a, ax, ay, boxA).intersects(boxOf(b, bx, by, boxB));
}

function distSquared(x: number, y: number, other: Entity): number {
  return (x - other.position!.x) ** 2 + (y - other.position!.y) ** 2;
}

/** Which way the player is trying to walk, from their held movement keys. */
function walkDir(player: Entity): { x: number; y: number } {
  const pi = player.playerInput!;
  return { x: (pi.right ? 1 : 0) - (pi.left ? 1 : 0), y: (pi.down ? 1 : 0) - (pi.up ? 1 : 0) };
}

/**
 * A carriage rolling into a player shoves them along the track. A player
 * leaning against it the other way turns it back instead, and so does one
 * pinned against a wall. Returns whether the carriage must reverse.
 */
function meetPlayers(level: Level, droid: Entity, players: Iterable<Entity>, dir: number): boolean {
  const pos = droid.position!;
  const nx = pos.x + DX[dir] * SPEED;
  const ny = pos.y + DY[dir] * SPEED;
  for (const player of players) {
    if (player.falling || (player.health?.current ?? 1) <= 0) continue;
    const pp = player.position!;
    const ahead = (pp.x - pos.x) * DX[dir] + (pp.y - pos.y) * DY[dir];
    if (ahead <= 0 || !overlapAt(droid, nx, ny, player)) continue;
    const w = walkDir(player);
    if (w.x * DX[dir] + w.y * DY[dir] < 0 || !shove(level, droid, player, dir, ahead)) return true;
  }
  return false;
}

/**
 * Shoves the player just clear of where the carriage is about to be. A player already overlapping it is
 * eased out over a few ticks instead of being flung across the tile. Returns false when a wall stops them.
 */
function shove(level: Level, droid: Entity, player: Entity, dir: number, ahead: number): boolean {
  const pp = player.position!;
  const r = player.radius!;
  const gap = ahead - (DX[dir] !== 0 ? droid.radius!.x + r.x : droid.radius!.y + r.y);
  const push = Math.min(SPEED * 2, Math.max(0, SPEED - gap));
  const bx = pp.x;
  const by = pp.y;
  move(pp, r, DX[dir] * push, DY[dir] * push, level.getClipBBs(pp.x, pp.y, r.x, r.y), false);
  return Math.abs(pp.x - bx) + Math.abs(pp.y - by) >= push - 0.05;
}

/** Fills the pot beside the treasure pile and banks it on the team's own track. */
function handleTreasure(level: Level, droid: Entity): void {
  const rd = droid.railDroid!;
  if (rd.swapTime > 0) {
    rd.swapTime--;
    return;
  }
  if (!rd.full) fillAtTreasure(droid);
  else deliver(level, droid);
}

/** A carriage within reach of the treasure pile (Java's getBB().grow(32)) fills its pot. */
function fillAtTreasure(droid: Entity): void {
  const rd = droid.railDroid!;
  const reach = boxOf(droid, undefined, undefined, boxA).pad(TREASURE_REACH);
  for (const b of buildings) {
    if (b.building!.type !== 'treasure' || !reach.intersects(boxOf(b, undefined, undefined, boxB))) continue;
    rd.full = true;
    rd.swapTime = SWAP_TIME;
    sound.playSound('gem', droid.position!.x, droid.position!.y);
    return;
  }
}

/** A full pot is emptied on the team's own base track. A delivery only moves the score; nothing drops and nothing sounds. */
function deliver(level: Level, droid: Entity): void {
  const rd = droid.railDroid!;
  const pos = droid.position!;
  const tile = level.getTileAt(pos.x, pos.y);
  if (!tile || tile.type !== TileType.PlayerRail || (isVersus() && tile.team !== droid.team)) return;
  rd.full = false;
  rd.swapTime = SWAP_TIME;
  if (!isVersus()) {
    payTeam(droid.team);
    return;
  }
  if (droid.team === 1) level.player1Score += TREASURE_PROGRESS;
  else if (droid.team === 2) level.player2Score += TREASURE_PROGRESS;
}

/** In a co-operative game every player of the team is credited for a pot brought home. */
function payTeam(team: number | undefined): void {
  for (const player of banked) if (player.team === team) player.playerStats!.score += TREASURE_REWARD;
}

/**
 * Two carriages can end up pinned against each other on a bend, each waiting for
 * the other to clear. A carriage that has not really moved for a while turns
 * round, and one that is still pinned after that takes another way out.
 */
function breakWedge(level: Level, droid: Entity): void {
  const rd = droid.railDroid!;
  const pos = droid.position!;
  if (rd.dir < 0 || (droid.freezeTime ?? 0) > 0) {
    rd.watch = undefined;
    return;
  }
  const watch = rd.watch;
  if (!watch) {
    rd.watch = { x: pos.x, y: pos.y, age: -Math.floor(Math.random() * WEDGE_JITTER) };
    return;
  }
  if (++watch.age < WEDGE_TICKS) return;
  const moved = Math.hypot(pos.x - watch.x, pos.y - watch.y);
  rd.watch = { x: pos.x, y: pos.y, age: -Math.floor(Math.random() * WEDGE_JITTER) };
  if (moved >= WEDGE_DISTANCE) return;
  const tx = Math.floor(pos.x / TILE_WIDTH);
  const ty = Math.floor(pos.y / TILE_HEIGHT);
  const back = (rd.dir + 2) % 4;
  rd.dir = Math.random() < 0.5 ? back : chooseDir(level, tx, ty, back);
}

/** Track taken up beneath it: the carriage just sits there; a stopped one on track picks a way to go. */
function chooseStart(level: Level, droid: Entity): void {
  const rd = droid.railDroid!;
  const tx = Math.floor(droid.position!.x / TILE_WIDTH);
  const ty = Math.floor(droid.position!.y / TILE_HEIGHT);
  if (!isRailTile(level, tx, ty)) rd.dir = -1;
  else if (rd.dir < 0) rd.dir = chooseDir(level, tx, ty, -1);
}

/** Whether two carriages are about to run into each other this tick. */
function aboutToMeet(a: Entity, b: Entity): boolean {
  const ar = a.railDroid!;
  const br = b.railDroid!;
  if (ar.dir < 0 || br.dir < 0 || ar.dir === br.dir) return false;
  const ax = a.position!.x + DX[ar.dir] * SPEED;
  const ay = a.position!.y + DY[ar.dir] * SPEED;
  const bx = b.position!.x + DX[br.dir] * SPEED;
  const by = b.position!.y + DY[br.dir] * SPEED;
  if ((ax - bx) ** 2 + (ay - by) ** 2 >= distSquared(a.position!.x, a.position!.y, b)) return false;
  return isAhead(a, b, ar.dir) || isAhead(b, a, br.dir) || overlapAt(a, ax, ay, b, bx, by);
}

/** Two carriages of a team meeting with one pot full and one empty hand the treasure over. */
function handOver(a: Entity, b: Entity, handedOver: Set<Entity>): void {
  const ar = a.railDroid!;
  const br = b.railDroid!;
  if (a.team !== b.team || ar.full === br.full || handedOver.has(a) || handedOver.has(b)) return;
  [ar.full, br.full] = [br.full, ar.full];
  ar.swapTime = br.swapTime = SWAP_TIME;
  handedOver.add(a);
  handedOver.add(b);
  sound.playSound('gem', a.position!.x, a.position!.y);
}

function meet(a: Entity, b: Entity, bumped: Set<Entity>, handedOver: Set<Entity>): void {
  if (!aboutToMeet(a, b)) return;
  handOver(a, b, handedOver);
  bumped.add(a);
  bumped.add(b);
}

/** Processes each meeting once, before either carriage moves or changes its cargo; both turn back. */
function resolveMeetings(droids: readonly Entity[]): void {
  const bumped = new Set<Entity>();
  const handedOver = new Set<Entity>();
  for (let i = 0; i < droids.length; i++) {
    for (let j = i + 1; j < droids.length; j++) meet(droids[i], droids[j], bumped, handedOver);
  }
  for (const droid of bumped) droid.railDroid!.dir = (droid.railDroid!.dir + 2) % 4;
}

/**
 * A reversal can happen exactly on a centre, including the instant of purchase. Never leave that centre
 * along a nonexistent connection.
 */
function keepOnTrack(level: Level, droid: Entity, tx: number, ty: number, cx: number, cy: number): void {
  const rd = droid.railDroid!;
  const pos = droid.position!;
  if (railJoins(level, tx, ty, DX[rd.dir], DY[rd.dir])) return;
  const along = (pos.x - cx) * DX[rd.dir] + (pos.y - cy) * DY[rd.dir];
  if (along > 0) rd.dir = (rd.dir + 2) % 4;
  else if (Math.abs(pos.x - cx) < 0.001 && Math.abs(pos.y - cy) < 0.001) rd.dir = chooseDir(level, tx, ty, rd.dir);
}

/** Whether another carriage takes up the spot it would roll into, and stepping there would bring them closer. */
function blockedAt(droids: readonly Entity[], droid: Entity, nx: number, ny: number): boolean {
  const pos = droid.position!;
  return droids.some((other) => other !== droid && overlapAt(droid, nx, ny, other)
    && distSquared(nx, ny, other) < distSquared(pos.x, pos.y, other));
}

/**
 * Rolls one step towards the next tile centre; on reaching it, settles there and picks where to go next.
 * Returns false when it could not roll at all (no way on, or another carriage in the way).
 */
function roll(level: Level, droids: readonly Entity[], droid: Entity): boolean {
  const rd = droid.railDroid!;
  const pos = droid.position!;
  const tx = Math.floor(pos.x / TILE_WIDTH);
  const ty = Math.floor(pos.y / TILE_HEIGHT);
  const cx = tx * TILE_WIDTH + TILE_WIDTH / 2;
  const cy = ty * TILE_HEIGHT + TILE_HEIGHT / 2;
  if (meetPlayers(level, droid, pushable, rd.dir)) rd.dir = (rd.dir + 2) % 4;
  keepOnTrack(level, droid, tx, ty, cx, cy);
  if (rd.dir < 0) return false;
  const dir = rd.dir;
  // Signed distance to this tile's centre along the heading, before and after the step.
  const before = (pos.x - cx) * DX[dir] + (pos.y - cy) * DY[dir];
  const step = before < 0 ? Math.min(SPEED, -before) : SPEED;
  const nx = pos.x + DX[dir] * step;
  const ny = pos.y + DY[dir] * step;
  if (blockedAt(droids, droid, nx, ny)) return false;
  pos.x = nx;
  pos.y = ny;
  const after = (pos.x - cx) * DX[dir] + (pos.y - cy) * DY[dir];
  if (before < 0 && after >= 0) {
    pos.x = cx;
    pos.y = cy;
    rd.dir = chooseDir(level, tx, ty, dir);
  } else if (dir % 2 === 0) {
    pos.x = cx;
  } else {
    pos.y = cy;
  }
  return true;
}

/** Shows the carriage facing the way it last rolled. */
function updateFrame(droid: Entity): void {
  const rd = droid.railDroid!;
  if (rd.dir >= 0) rd.lastDir = rd.dir;
  const [col, row] = FRAMES[rd.lastDir];
  const v = droid.visual!;
  if (v.col === col && v.row === row) return;
  v.col = col;
  v.row = row;
  if (droid.sprite) droid.sprite.texture = frameTexture(v.sheet, col, row);
}

/**
 * Carriages roll along the track from tile centre to tile centre, picking a
 * random onward branch at junctions and reversing at dead ends, on meeting
 * another carriage, or when a player pushes back against them.
 */
export function updateRailDroids(level: Level): void {
  const droids = [...carriages].filter((d) => !d.removed);
  for (const droid of droids) {
    chooseStart(level, droid);
    handleTreasure(level, droid);
  }
  resolveMeetings(droids);
  for (const droid of droids) {
    breakWedge(level, droid);
    // A struck carriage stalls for a moment, like any hurt mob; one that cannot roll keeps its old look.
    const rolling = droid.railDroid!.dir >= 0 && (droid.freezeTime ?? 0) <= 0;
    if (rolling && !roll(level, droids, droid)) continue;
    updateFrame(droid);
  }
}

/** Keeps each carriage's pot over its head, empty or full. */
export function updateRailDroidCargo(gameLayer: Container): void {
  for (const droid of loaded) {
    let pot = droid.cargoSprite;
    if (!pot) {
      pot = new Sprite();
      pot.anchor.set(0.5, 0.5);
      gameLayer.addChild(pot);
      world.addComponent(droid, 'cargoSprite', pot);
    }
    const [col, row] = droid.railDroid!.full ? POT_FULL : POT_EMPTY;
    pot.texture = frameTexture('bullets', col, row);
    const body = droid.sprite!;
    pot.x = body.x;
    pot.y = body.y - POT_RAISE;
    pot.zIndex = body.zIndex + 0.02;
    pot.visible = body.visible;
  }
}
