import { Sprite } from 'pixi.js';
import type { Container } from 'pixi.js';
import { world } from '../world';
import type { Entity } from '../world';
import { TILE_WIDTH, TILE_HEIGHT, TileType } from '../level/TileType';
import { isRailTile, railJoins } from '../level/RailLayout';
import type { Level } from '../level/Level';
import { frameTexture } from '../render/Sheets';
import { BB } from '../math/BB';
import { move } from './MovementSystem';
import { sound } from '../audio/SoundPlayer';
import { createLoot } from '../entities/LootFactory';

/** Steady speed of Java's RailDroid (0.7 px of thrust against 0.4 drag). */
const SPEED = 1.15;
/** Closer than this, two carriages (or a carriage and a player) have bumped. */
const BUMP_DIST = 18;

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
/** Worth of the emerald a carriage drops for each pot of treasure brought home. */
export const TREASURE_REWARD = 100;
const HEALTH = 10;

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

function boxOf(e: Entity, x = e.position!.x, y = e.position!.y): BB {
  return BB.fromCenter(x, y, e.radius!.x, e.radius!.y);
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
function meetPlayers(level: Level, droid: Entity, players: Entity[], dir: number): boolean {
  const pos = droid.position!;
  const next = boxOf(droid, pos.x + DX[dir] * SPEED, pos.y + DY[dir] * SPEED);
  for (const player of players) {
    if (player.falling || (player.health?.current ?? 1) <= 0) continue;
    const pp = player.position!;
    const ahead = (pp.x - pos.x) * DX[dir] + (pp.y - pos.y) * DY[dir];
    if (ahead <= 0 || !next.intersects(boxOf(player))) continue;

    const w = walkDir(player);
    if (w.x * DX[dir] + w.y * DY[dir] < 0) return true;

    // Shove the player just clear of where the carriage is about to be.
    const gap = ahead - (DX[dir] !== 0 ? droid.radius!.x + player.radius!.x : droid.radius!.y + player.radius!.y);
    const push = Math.max(0, SPEED - gap);
    const bx = pp.x;
    const by = pp.y;
    const r = player.radius!;
    move(pp, r, DX[dir] * push, DY[dir] * push, level.getClipBBs(pp.x, pp.y, r.x, r.y), false);
    const moved = Math.abs(pp.x - bx) + Math.abs(pp.y - by);
    if (moved < push - 0.05) return true;
  }
  return false;
}

/** Fills the pot beside the treasure pile and banks it on the team's own track. */
function handleTreasure(level: Level, droid: Entity): void {
  const rd = droid.railDroid!;
  if (rd.swapTime > 0) {
    rd.swapTime--;
    return;
  }
  const pos = droid.position!;
  if (!rd.full) {
    const reach = boxOf(droid).grow(TREASURE_REACH);
    for (const b of world.with('position', 'building')) {
      if (b.building!.type !== 'treasure' || !reach.intersects(boxOf(b))) continue;
      rd.full = true;
      rd.swapTime = SWAP_TIME;
      sound.playSound('gem', pos.x, pos.y);
      return;
    }
    return;
  }

  const tile = level.getTileAt(pos.x, pos.y);
  if (!tile || tile.type !== TileType.PlayerRail) return;
  rd.full = false;
  rd.swapTime = SWAP_TIME;
  // The haul tumbles out as an emerald that has to be picked up before it fades.
  const angle = Math.random() * Math.PI * 2;
  createLoot(pos.x, pos.y, Math.cos(angle) * 0.5, Math.sin(angle) * 0.5, TREASURE_REWARD, true);
  sound.playSound('bigCoin', pos.x, pos.y);
}

/**
 * Carriages roll along the track from tile centre to tile centre, picking a
 * random onward branch at junctions and reversing at dead ends, on meeting
 * another carriage, or when a player pushes back against them.
 */
export function updateRailDroids(level: Level): void {
  const droids = [...world.with('position', 'railDroid')].filter((d) => !d.removed);
  const players = [...world.with('position', 'radius', 'playerInput')];

  for (const droid of droids) {
    const rd = droid.railDroid!;
    const pos = droid.position!;
    const tx = Math.floor(pos.x / TILE_WIDTH);
    const ty = Math.floor(pos.y / TILE_HEIGHT);
    // Track taken up beneath it: the carriage just sits there.
    if (!isRailTile(level, tx, ty)) rd.dir = -1;
    else if (rd.dir < 0) rd.dir = chooseDir(level, tx, ty, -1);
    handleTreasure(level, droid);
  }

  // Bumps are judged before anyone moves, so two carriages meeting head-on both turn back.
  const bumped = droids.filter((droid) => {
    const dir = droid.railDroid!.dir;
    if (dir < 0) return false;
    return droids.some((o) => o !== droid && isAhead(droid, o, dir));
  });
  for (const droid of bumped) droid.railDroid!.dir = (droid.railDroid!.dir + 2) % 4;

  for (const droid of droids) {
    const rd = droid.railDroid!;
    const pos = droid.position!;
    const tx = Math.floor(pos.x / TILE_WIDTH);
    const ty = Math.floor(pos.y / TILE_HEIGHT);
    const cx = tx * TILE_WIDTH + TILE_WIDTH / 2;
    const cy = ty * TILE_HEIGHT + TILE_HEIGHT / 2;

    // A struck carriage stalls for a moment, like any hurt mob.
    if (rd.dir >= 0 && (droid.freezeTime ?? 0) <= 0) {
      if (meetPlayers(level, droid, players, rd.dir)) rd.dir = (rd.dir + 2) % 4;
      const dir = rd.dir;
      // Signed distance to this tile's centre along the heading, before and after the step.
      const before = (pos.x - cx) * DX[dir] + (pos.y - cy) * DY[dir];
      pos.x += DX[dir] * SPEED;
      pos.y += DY[dir] * SPEED;
      const after = (pos.x - cx) * DX[dir] + (pos.y - cy) * DY[dir];

      if (before < 0 && after >= 0) {
        // Reached the centre: settle on it and decide where to go next.
        pos.x = cx;
        pos.y = cy;
        rd.dir = chooseDir(level, tx, ty, dir);
      } else if (dir % 2 === 0) {
        pos.x = cx;
      } else {
        pos.y = cy;
      }
    }

    if (rd.dir >= 0) rd.lastDir = rd.dir;
    const [col, row] = FRAMES[rd.lastDir];
    const v = droid.visual!;
    if (v.col !== col || v.row !== row) {
      v.col = col;
      v.row = row;
      if (droid.sprite) droid.sprite.texture = frameTexture(v.sheet, col, row);
    }
  }
}

/** Keeps each carriage's pot over its head, empty or full. */
export function updateRailDroidCargo(gameLayer: Container): void {
  for (const droid of world.with('railDroid', 'sprite')) {
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
