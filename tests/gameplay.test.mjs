import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { createServer } from 'vite';

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom' });
after(() => server.close());
const load = (path) => server.ssrLoadModule(`/src/${path}.ts`);
const { world, Team } = await load('world');
const { Level } = await load('level/Level');
const { createTile, TileType } = await load('level/TileType');
const { railJoins, isRailTile } = await load('level/RailLayout');
const { createRailDroid, canSpawnRailDroid, updateRailDroids } = await load('systems/RailDroidSystem');
const { createBuilding } = await load('entities/BuildingFactory');
const { createPlayer } = await load('entities/PlayerFactory');
const { createShopItem } = await load('entities/ShopItemFactory');
const { updateAIPlayers } = await load('systems/AIPlayerSystem');
const { updateTargeting } = await load('systems/TargetingSystem');
const { updateInteraction, updateCarried } = await load('systems/InteractionSystem');
const { updateMovement, updateSlides } = await load('systems/MovementSystem');
const { updateWeapons } = await load('systems/WeaponSystem');
const { updateBullets } = await load('systems/BulletSystem');
const { updateBulletCollision, updateCombatTimers } = await load('systems/CombatSystem');
const { updateBombs } = await load('systems/BuildingSystem');
const { gameState, DIFFICULTIES } = await load('game/GameState');

const centre = (t) => t * 32 + 16;
const put = (level, x, y, type, extra = {}) => level.setTile(x, y, { ...createTile(type), ...extra });
function track(level, x, y, type = TileType.Rail) {
  put(level, x, y, type, { team: Team.Two });
}
function aiTick(level) {
  updateAIPlayers(level);
  updateTargeting();
  updateInteraction(level);
  updateWeapons(1);
  updateMovement(level, 1);
  updateSlides(level);
  updateBullets(level, 1);
  updateCombatTimers(1);
  updateBulletCollision(1);
  updateBombs(level, 1);
  updateCarried();
  for (const e of [...world]) if (e.removed) world.remove(e);
}
function computer(x, y, score = 500) {
  const ai = createPlayer(centre(x), centre(y), Team.Two);
  world.addComponent(ai, 'aiPlayer', { character: 'lord_lard', difficulty: 'Easy' });
  ai.playerStats.score = score;
  return ai;
}

beforeEach(() => {
  for (const e of [...world]) world.remove(e);
  gameState.opponent = 'ai';
  gameState.difficulty = DIFFICULTIES[1];
  gameState.debug = false;
});

test('occupied carriage purchases are rejected without spending coins', () => {
  const level = new Level(12, 8);
  track(level, 5, 4, TileType.PlayerRail);
  track(level, 6, 4);
  const p = createPlayer(centre(5), centre(4), Team.Two);
  p.playerStats.score = 100;
  p.playerInput.intents.build = true;
  updateInteraction(level);
  p.railCooldown = 0;
  updateInteraction(level);
  assert.equal([...world.with('railDroid')].length, 1);
  assert.equal(p.playerStats.score, 50);
  assert.equal(canSpawnRailDroid(level, centre(5), centre(4)), false);
  assert.equal(canSpawnRailDroid(level, centre(6), centre(4)), true);
});

test('carriages stay on centres and connected track through corners and end reversals', () => {
  const level = new Level(14, 12);
  const tiles = [[3, 3], [4, 3], [5, 3], [5, 4], [5, 5], [6, 5], [7, 5], [7, 6]];
  for (const [x, y] of tiles) track(level, x, y);
  const droid = createRailDroid(centre(3), centre(3), Team.Two);
  droid.railDroid.dir = 3; // A collision reversed it at the endpoint centre.
  const visited = new Set();
  for (let t = 0; t < 2000; t++) {
    updateRailDroids(level);
    const { x, y } = droid.position;
    const tx = Math.floor(x / 32);
    const ty = Math.floor(y / 32);
    assert.ok(isRailTile(level, tx, ty), `off rails at ${x}, ${y}`);
    assert.ok(Math.abs(x - centre(tx)) < 0.001 || Math.abs(y - centre(ty)) < 0.001);
    visited.add(`${tx},${ty}`);
    const dir = droid.railDroid.dir;
    if (Math.abs(x - centre(tx)) < 0.001 && Math.abs(y - centre(ty)) < 0.001) {
      assert.ok(railJoins(level, tx, ty, [0, 1, 0, -1][dir], [-1, 0, 1, 0][dir]));
    }
  }
  assert.equal(visited.size, tiles.length);
});

test('head-on carriages hand over one treasure pot and both reverse', () => {
  const level = new Level(12, 8);
  for (let x = 2; x <= 9; x++) track(level, x, 4);
  const a = createRailDroid(centre(5), centre(4), Team.Two);
  const b = createRailDroid(centre(6), centre(4), Team.Two);
  a.position.x += 6;
  b.position.x -= 6;
  Object.assign(a.railDroid, { dir: 1, full: true, swapTime: 30 });
  b.railDroid.dir = 3;
  updateRailDroids(level);
  assert.equal(a.railDroid.full, false);
  assert.equal(b.railDroid.full, true);
  assert.equal(a.railDroid.dir, 3);
  assert.equal(b.railDroid.dir, 1);
  assert.equal(a.railDroid.swapTime, 30);
  assert.equal(b.railDroid.swapTime, 30);
  for (let i = 0; i < 5; i++) updateRailDroids(level);
  assert.equal(b.railDroid.full, true);
});

test('enemy carriages cannot steal a pot by bumping', () => {
  const level = new Level(12, 8);
  for (let x = 2; x <= 9; x++) track(level, x, 4);
  const a = createRailDroid(centre(5), centre(4), Team.One);
  const b = createRailDroid(centre(6), centre(4), Team.Two);
  a.position.x += 6;
  b.position.x -= 6;
  Object.assign(a.railDroid, { dir: 1, full: true });
  b.railDroid.dir = 3;
  updateRailDroids(level);
  assert.equal(a.railDroid.full, true);
  assert.equal(b.railDroid.full, false);
});

test('a crowded single-track chain keeps delivering without overlapping or derailing', () => {
  const level = new Level(22, 10);
  for (let x = 2; x <= 17; x++) track(level, x, 5, x === 2 ? TileType.PlayerRail : TileType.Rail);
  createBuilding(centre(18), centre(5), 'treasure');
  const droids = [2, 6, 10, 14].map((x) => createRailDroid(centre(x), centre(5), Team.Two));
  for (let t = 0; t < 6000; t++) {
    updateRailDroids(level);
    for (const a of droids) {
      assert.equal(Math.floor(a.position.y / 32), 5);
      assert.ok(a.position.x >= centre(2) && a.position.x <= centre(17));
      for (const b of droids) {
        if (a !== b) assert.ok(Math.abs(a.position.x - b.position.x) >= 20 - 0.001, 'overlapping carriages');
      }
    }
  }
  assert.ok(level.player2Score >= 10, `only ${level.player2Score}% delivered`);
});

test('carriages meeting on bends keep moving instead of wedging across the corner', () => {
  const level = new Level(14, 12);
  const tiles = [[3, 3], [4, 3], [5, 3], [5, 4], [5, 5], [6, 5], [7, 5], [7, 6], [7, 7]];
  for (const [x, y] of tiles) track(level, x, y);
  const droids = [0, 3, 6].map((i) => createRailDroid(centre(tiles[i][0]), centre(tiles[i][1]), Team.Two));
  const distances = droids.map(() => 0);
  for (let t = 0; t < 3000; t++) {
    const before = droids.map((d) => ({ ...d.position }));
    updateRailDroids(level);
    droids.forEach((d, i) => {
      const { x, y } = d.position;
      assert.ok(isRailTile(level, Math.floor(x / 32), Math.floor(y / 32)));
      if (t > 2000) distances[i] += Math.hypot(x - before[i].x, y - before[i].y);
    });
  }
  distances.forEach((distance) => assert.ok(distance > 300, `stalled carriage moved only ${distance}px`));
});

test('Easy buys, places and safely detonates a bomb before its rail delay', () => {
  const level = new Level(20, 20);
  for (let x = 0; x < level.width; x++) put(level, x, 10, TileType.Wall, { destroyable: true });
  track(level, 9, 4, TileType.PlayerRail);
  level.setSpawnPoints(Team.Two, [{ x: centre(9), y: centre(3) }]);
  createBuilding(centre(9), centre(16), 'treasure');
  createShopItem(centre(8), centre(3), 'bomb', Team.Two);
  createShopItem(centre(10), centre(3), 'turret', Team.Two);
  const ai = computer(9, 3);
  let bought = false;
  let placed = false;
  let lit = false;
  let tick = 0;
  for (; tick < 1800 && level.getTile(9, 10).destroyable; tick++) {
    aiTick(level);
    for (const bomb of world.with('bomb')) {
      bought = true;
      if (bomb.carriedBy === undefined) placed = true;
      if (bomb.bomb.lit) lit = true;
    }
  }
  assert.ok(bought, 'never bought a bomb');
  assert.ok(placed, 'never placed the bomb');
  assert.ok(lit, 'never lit the bomb');
  assert.ok(!level.getTile(9, 10).destroyable, `wall still closed after ${tick} ticks`);
  assert.equal(ai.health.current, ai.health.max, 'hurt itself with its bomb');
  assert.equal([...world.with('turret')].length, 0, 'spent the escape budget on a turret');
});

test('Easy interrupts an ongoing purchase to retreat when badly hurt', () => {
  const level = new Level(24, 16);
  level.setSpawnPoints(Team.Two, [{ x: centre(3), y: centre(5) }]);
  createShopItem(centre(14), centre(5), 'turret', Team.Two);
  const ai = computer(8, 5, 100);
  updateAIPlayers(level);
  assert.equal(ai.playerInput.right, true, 'did not start towards the shop');
  ai.health.current = 1;
  world.add({ position: { x: centre(10), y: centre(5) }, ai: { type: 'bat' }, health: { current: 10, max: 10 }, team: Team.Neutral });
  updateAIPlayers(level);
  assert.equal(ai.playerInput.left, true, 'did not interrupt the purchase to retreat');
  assert.equal(ai.playerInput.right, false);
});

test('Easy opens successive wall layers and keeps aiming after recoil', () => {
  const level = new Level(20, 20);
  for (let x = 0; x < level.width; x++) {
    for (const y of [10, 11]) put(level, x, y, TileType.Wall, { destroyable: true });
  }
  track(level, 9, 4, TileType.PlayerRail);
  level.setSpawnPoints(Team.Two, [{ x: centre(9), y: centre(3) }]);
  createBuilding(centre(9), centre(16), 'treasure');
  createShopItem(centre(8), centre(3), 'bomb', Team.Two);
  const ai = computer(9, 3, 1000);
  let kicked = false;
  let opened = false;
  for (let tick = 0; tick < 2400; tick++) {
    aiTick(level);
    if (!kicked && ai.playerInput.shoot) {
      // A missed shot and recoil must not leave the AI waiting for a centre
      // it no longer occupies. Remove that shot and shove it farther back.
      for (const shot of [...world.with('bullet')]) world.remove(shot);
      ai.position.x += 12;
      kicked = true;
    }
    opened = Array.from({ length: level.width }, (_, x) => x)
      .some((x) => level.getTile(x, 10).passable && level.getTile(x, 11).passable);
    if (opened) break;
  }
  assert.ok(kicked, 'never attempted to ignite the bomb');
  assert.ok(opened, 'did not open both wall layers');
  assert.equal(ai.health.current, ai.health.max);
});

test('Easy immediately flees a lit bomb, even while carrying equipment', () => {
  const level = new Level(20, 20);
  const ai = computer(8, 8);
  const held = createBuilding(ai.position.x, ai.position.y, 'turret', Team.Two);
  world.addComponent(held, 'carriedBy', world.id(ai));
  world.removeComponent(held, 'blocking');
  world.addComponent(ai, 'carryingId', world.id(held));
  const bomb = createBuilding(centre(9), centre(8), 'bomb', Team.One);
  bomb.bomb.lit = true;
  for (let t = 0; t < 65; t++) aiTick(level);
  assert.equal(ai.health.current, ai.health.max);
  assert.ok(ai.position.x < centre(8) || ai.position.y !== centre(8), 'did not flee the bomb');
});
