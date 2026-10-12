import { world } from '../world';
import type { Entity } from '../world';
import { TILE_WIDTH, TILE_HEIGHT } from '../level/TileType';
import { isRailTile, railJoins } from '../level/RailLayout';
import type { Level } from '../level/Level';
import { frameTexture } from '../render/Sheets';

/** Steady speed of Java's RailDroid (0.7 px of thrust against 0.4 drag). */
const SPEED = 1.15;
/** Closer than this, two carriages (or a carriage and a player) have bumped. */
const BUMP_DIST = 18;

const DX = [0, 1, 0, -1];
const DY = [-1, 0, 1, 0];
/** raildroid.png cell per heading: [col, row]. */
const FRAMES: Array<[number, number]> = [[0, 1], [1, 0], [0, 0], [1, 1]];

export function createRailDroid(x: number, y: number, team: number): Entity {
  const tx = Math.floor(x / TILE_WIDTH);
  const ty = Math.floor(y / TILE_HEIGHT);
  return world.add({
    position: { x: tx * TILE_WIDTH + TILE_WIDTH / 2, y: ty * TILE_HEIGHT + TILE_HEIGHT / 2 },
    radius: { x: 10, y: 8 },
    team,
    yOffset: 6,
    railDroid: { dir: -1, lastDir: 2 },
    visual: { sheet: 'raildroid', col: 0, row: 0 },
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

/** Whether `other` sits ahead of a carriage heading in `dir`. */
function isAhead(self: Entity, other: Entity, dir: number): boolean {
  const dx = other.position!.x - self.position!.x;
  const dy = other.position!.y - self.position!.y;
  const ahead = dx * DX[dir] + dy * DY[dir];
  const aside = Math.abs(dx * DY[dir] - dy * DX[dir]);
  return ahead > 0 && ahead < BUMP_DIST && aside < 12;
}

/**
 * Carriages roll along the track from tile centre to tile centre, picking a
 * random onward branch at junctions and reversing at dead ends or when they
 * run into another carriage or a player.
 */
export function updateRailDroids(level: Level): void {
  const droids = [...world.with('position', 'railDroid')];
  const players = [...world.with('position', 'playerInput')];

  for (const droid of droids) {
    const rd = droid.railDroid!;
    const pos = droid.position!;
    const tx = Math.floor(pos.x / TILE_WIDTH);
    const ty = Math.floor(pos.y / TILE_HEIGHT);
    // Track taken up beneath it: the carriage just sits there.
    if (!isRailTile(level, tx, ty)) rd.dir = -1;
    else if (rd.dir < 0) rd.dir = chooseDir(level, tx, ty, -1);
  }

  // Bumps are judged before anyone moves, so two carriages meeting head-on both turn back.
  const bumped = droids.filter((droid) => {
    const dir = droid.railDroid!.dir;
    if (dir < 0) return false;
    return (
      droids.some((o) => o !== droid && isAhead(droid, o, dir)) ||
      players.some((p) => isAhead(droid, p, dir))
    );
  });
  for (const droid of bumped) droid.railDroid!.dir = (droid.railDroid!.dir + 2) % 4;

  for (const droid of droids) {
    const rd = droid.railDroid!;
    const pos = droid.position!;
    const tx = Math.floor(pos.x / TILE_WIDTH);
    const ty = Math.floor(pos.y / TILE_HEIGHT);
    const cx = tx * TILE_WIDTH + TILE_WIDTH / 2;
    const cy = ty * TILE_HEIGHT + TILE_HEIGHT / 2;

    if (rd.dir >= 0) {
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
