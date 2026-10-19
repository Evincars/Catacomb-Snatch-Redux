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
const { updateAIPlayers, openingCoins } = await load('systems/AIPlayerSystem');
const { updateAI, MAX_CHASERS } = await load('systems/AISystem');
const { updateTargeting } = await load('systems/TargetingSystem');
const { updateInteraction, updateCarried } = await load('systems/InteractionSystem');
const { updateMovement, updateSlides } = await load('systems/MovementSystem');
const { updateWeapons } = await load('systems/WeaponSystem');
const { updateBullets } = await load('systems/BulletSystem');
const { updateBulletCollision, updateCombatTimers } = await load('systems/CombatSystem');
const { updateBombs } = await load('systems/BuildingSystem');
const { updateHoles, overHole } = await load('systems/HoleSystem');
const { canSpawnMob, updateSpawners, MAX_PER_NEST } = await load('systems/SpawnerSystem');
const { updateRandomSpawner, spawnInitialSpawners } = await load('systems/RandomSpawnerSystem');
const { spawnTreasureGuards } = await load('systems/TreasureSystem');
const { createSpawner } = await load('entities/SpawnerFactory');
const { createMob } = await load('entities/MobFactory');
const { gameState, DIFFICULTIES, AI_DIFFICULTIES } = await load('game/GameState');
const { runCommand, cheats } = await load('game/Console');
const { captureWorld, validateWorld, restoreSettings } = await load('game/WorldState');
const { solveRicochet } = await load('systems/Ricochet');
const { createBullet, BULLET_CONFIGS } = await load('entities/BulletFactory');
const { cleanName } = await load('game/Settings');

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
  gameState.multiplayerMode = 'companion';
  gameState.aiDifficulty = AI_DIFFICULTIES[1];
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

test('a player standing inside a carriage is eased out, not thrown across the tile', () => {
  const level = new Level(12, 8);
  for (let x = 2; x <= 9; x++) track(level, x, 4);
  const droid = createRailDroid(centre(5), centre(4), Team.Two);
  droid.railDroid.dir = 1;
  const p = createPlayer(centre(5) + 1, centre(4), Team.One);
  const startX = p.position.x;
  updateRailDroids(level);
  assert.ok(Math.abs(p.position.x - startX) <= 3, `shoved ${p.position.x - startX}px in one tick`);
});

test('console commands give money, toggle god mode and change the game speed', () => {
  const p = createPlayer(centre(5), centre(4), Team.One);
  const ctx = { player: p };
  const before = p.playerStats.score;
  runCommand('/money 250', ctx);
  assert.equal(p.playerStats.score, before + 250);
  runCommand('/give money 50', ctx);
  assert.equal(p.playerStats.score, before + 300);
  assert.match(runCommand('/money lots', ctx)[0], /Usage/);
  runCommand('/god', ctx);
  assert.equal(p.health.immortal, true);
  runCommand('/god off', ctx);
  assert.equal(p.health.immortal, false);
  runCommand('/speed 4', ctx);
  assert.equal(cheats.speed, 4);
  runCommand('/speed 99', ctx);
  assert.equal(cheats.speed, 4, 'out-of-range speed must be refused');
  runCommand('/speed normal', ctx);
  assert.equal(cheats.speed, 1);
  assert.match(runCommand('help', ctx)[0], /slash/);
  assert.match(runCommand('/nope', ctx)[0], /Unknown/);
});

test('delivering treasure empties the carriage silently and only moves the score', () => {
  const level = new Level(12, 8);
  track(level, 5, 4, TileType.PlayerRail);
  const droid = createRailDroid(centre(5), centre(4), Team.Two);
  droid.railDroid.full = true;
  updateRailDroids(level);
  assert.equal(droid.railDroid.full, false);
  assert.equal([...world.with('loot')].length, 0, 'delivery must not drop an emerald');
  assert.equal(level.player2Score, 2);
});

test('a player carrying a building cannot shoot', () => {
  const p = createPlayer(centre(5), centre(4), Team.One);
  p.playerInput.shoot = true;
  p.aimVector = { x: 1, y: 0 };
  updateWeapons(1);
  assert.ok([...world.with('bullet')].length > 0, 'an empty-handed player should shoot');
  for (const b of [...world.with('bullet')]) world.remove(b);
  p.weapon.currentCooldown = 0;
  const held = createBuilding(centre(5), centre(4), 'turret', Team.One);
  world.addComponent(held, 'carriedBy', world.id(p));
  world.addComponent(p, 'carryingId', world.id(held));
  updateWeapons(1);
  assert.equal([...world.with('bullet')].length, 0);
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

test('opening nests include every kind of mob, bats the most', () => {
  for (const difficulty of DIFFICULTIES) {
    gameState.difficulty = difficulty;
    const level = new Level(96, 96);
    level.setSpawnPoints(Team.One, [{ x: centre(48), y: centre(85) }]);
    level.setSpawnPoints(Team.Two, [{ x: centre(48), y: centre(10) }]);
    spawnInitialSpawners(level);
    const kinds = {};
    for (const nest of world.with('spawner')) kinds[nest.spawner.mobType] = (kinds[nest.spawner.mobType] ?? 0) + 1;
    for (const kind of ['bat', 'snake', 'mummy', 'scarab']) assert.ok(kinds[kind] >= 1, `${difficulty.name} has no ${kind} nests: ${JSON.stringify(kinds)}`);
    assert.ok(kinds.bat >= Math.max(kinds.snake, kinds.mummy, kinds.scarab), JSON.stringify(kinds));
    for (const e of [...world]) world.remove(e);
  }
});

test('mobs never walk into a pit, whether wandering or chasing', () => {
  const level = new Level(24, 12);
  for (let y = 2; y <= 9; y++) put(level, 12, y, TileType.Hole);
  const p = createPlayer(centre(20), centre(5), Team.One);
  p.health.immortal = true;
  const mobs = ['mummy', 'snake', 'scarab'].flatMap((kind, i) => [
    createMob(level, kind, centre(8), centre(3 + i * 2)),
    createMob(level, kind, centre(14), centre(4 + i * 2)),
  ]);
  for (let tick = 0; tick < 3000; tick++) {
    updateAI(level, 1);
    updateMovement(level, 1);
    for (const m of mobs) {
      assert.notEqual(level.getTileAt(m.position.x, m.position.y)?.type, TileType.Hole, `${m.mobType} stepped into the pit at tick ${tick}`);
    }
  }
});

test('rival turrets, harvesters and stalls are not offered or marked to a player in versus', () => {
  const level = new Level(14, 8);
  const p = createPlayer(centre(5), centre(4), Team.One);
  p.aimVector = { x: 1, y: 0 };
  const rival = createBuilding(centre(6), centre(4), 'turret', Team.Two);
  updateTargeting();
  assert.equal(p.targetId, undefined, 'targeted a rival turret');
  assert.equal(rival.targeted, undefined);
  rival.team = Team.One;
  updateTargeting();
  assert.equal(p.targetId, world.id(rival));
  void level;
});

test('the computer opens with enough coins for its best gun, and its first buildings', () => {
  createShopItem(centre(4), centre(4), 'raygun', Team.Two);
  createShopItem(centre(6), centre(4), 'turret', Team.Two);
  createShopItem(centre(8), centre(4), 'harvester', Team.Two);
  const coins = openingCoins(AI_DIFFICULTIES[1]);
  assert.ok(coins >= 800 + 75 * 3 + 300, `only ${coins} coins`);
});

test('AI walled in by its own buildings lifts one to get out', () => {
  const level = new Level(20, 12);
  level.setSpawnPoints(Team.Two, [{ x: centre(10), y: centre(5) }]);
  const ai = computer(10, 5, 0);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) createBuilding(centre(10 + dx), centre(5 + dy), 'turret', Team.Two);
  const before = [...world.with('turret')].filter((t) => t.carriedBy === undefined).length;
  let freed = false;
  for (let tick = 0; tick < 1200 && !freed; tick++) {
    aiTick(level);
    freed = ai.carryingId !== undefined || [...world.with('turret')].filter((t) => t.carriedBy === undefined).length < before;
  }
  assert.ok(freed, 'stayed boxed in');
});

test('a carriage wedged behind another turns round instead of waiting forever', () => {
  const level = new Level(14, 8);
  for (let x = 2; x <= 11; x++) track(level, x, 4);
  const front = createRailDroid(centre(7), centre(4), Team.Two);
  front.railDroid.dir = 1;
  front.freezeTime = 1e9;
  const back = createRailDroid(centre(3), centre(4), Team.Two);
  back.railDroid.dir = 1;
  let farthestBack = Infinity;
  for (let t = 0; t < 600; t++) {
    updateRailDroids(level);
    if (t > 120) farthestBack = Math.min(farthestBack, back.position.x);
  }
  assert.ok(farthestBack < centre(4), `stayed jammed at ${back.position.x}`);
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

test('a base exposed to nests gets its home turret before the bomb fund on a walled route', () => {
  const level = new Level(20, 20);
  for (let x = 0; x < level.width; x++) put(level, x, 10, TileType.Wall, { destroyable: true });
  track(level, 9, 4, TileType.PlayerRail);
  level.setSpawnPoints(Team.Two, [{ x: centre(9), y: centre(3) }]);
  createBuilding(centre(9), centre(16), 'treasure');
  createShopItem(centre(8), centre(3), 'bomb', Team.Two);
  createShopItem(centre(10), centre(3), 'turret', Team.Two);
  const nest = createSpawner(centre(17), centre(7), 'bat');
  nest.spawner.timer = 1e9;
  computer(9, 3, 100);
  for (let tick = 0; tick < 1800 && [...world.with('turret')].length === 0; tick++) aiTick(level);
  assert.equal([...world.with('turret')].length, 1, 'saved for the bomb while nests could reach the base');
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

test('hole edges support the feet on all four sides, but not deep inside the hole', () => {
  const level = new Level(12, 12);
  put(level, 5, 5, TileType.Hole);
  const p = createPlayer(centre(5), centre(5), Team.One);
  for (const [x, y] of [[165, 176], [187, 176], [176, 165], [176, 187], [165, 165]]) {
    p.position = { x, y };
    assert.equal(overHole(level, p), false, `lost footing on edge ${x},${y}`);
    updateHoles(level);
    assert.equal(p.falling, undefined);
  }
  p.position = { x: 167, y: 176 };
  assert.equal(overHole(level, p), true);
  updateHoles(level);
  assert.ok(p.falling);
});

test('adjacent hole tiles do not provide false support at their seam; flying and held entities are safe', () => {
  const level = new Level(12, 12);
  put(level, 5, 5, TileType.Hole);
  put(level, 6, 5, TileType.Hole);
  const p = createPlayer(192, centre(5), Team.One);
  const bat = createMob(level, 'bat', 192, centre(5));
  const held = createBuilding(192, centre(5), 'bomb', Team.One);
  world.addComponent(held, 'carriedBy', world.id(p));
  updateHoles(level);
  assert.ok(p.falling);
  assert.equal(bat.removed, undefined);
  assert.equal(held.removed, undefined);
});

test('Normal spawn pressure spans grid boundaries and counts mixed species', () => {
  const level = new Level(32, 32);
  for (let i = 0; i < gameState.difficulty.mobDensity; i++) {
    createMob(level, i % 2 ? 'snake' : 'bat', 330 + i * 15, 330);
  }
  assert.equal(canSpawnMob(level, 'mummy', 310, 310), false);
  for (const mob of world.with('ai')) mob.removed = true;
  assert.equal(canSpawnMob(level, 'mummy', 310, 310), true, 'removed mobs should not consume population');
});

test('nearby nests pause while the player is already surrounded', () => {
  const level = new Level(40, 40);
  const p = createPlayer(centre(12), centre(12), Team.One);
  for (let i = 0; i < gameState.difficulty.mobDensity * 2; i++) {
    createMob(level, 'snake', p.position.x + 25 + i * 3, p.position.y);
  }
  // Outside the nest's local density radius, but still feeding the same fight.
  assert.equal(canSpawnMob(level, 'mummy', centre(22), centre(12)), false);
});

test('a sustained eight-nest siege pauses reinforcements instead of growing without bound', () => {
  const level = new Level(64, 64);
  const p = createPlayer(centre(32), centre(32), Team.One);
  // The player deliberately does not shoot: reinforcement pressure must work
  // without depending on kills to keep the base usable.
  for (let i = 0; i < 8; i++) {
    const angle = i * Math.PI / 4;
    const nest = createSpawner(p.position.x + Math.cos(angle) * 288, p.position.y + Math.sin(angle) * 288,
      ['bat', 'snake', 'mummy'][i % 3]);
    nest.freezeTime = 0;
    nest.spawner.timer = 1 + i * 30;
  }
  let peak = 0;
  for (let tick = 0; tick < 60 * 120; tick++) {
    updateSpawners(level, 1);
    updateAI(level, 1);
    updateMovement(level, 1);
    peak = Math.max(peak, [...world.with('ai')].length);
  }
  assert.ok(peak <= 8 * MAX_PER_NEST, `eight nests accumulated ${peak} mobs around an undefended player`);
});

test('Normal and Hard have the same bounded populations; only Nightmare is moderately busier', () => {
  const [, normal, hard, nightmare] = DIFFICULTIES;
  for (const key of ['maxMobs', 'maxSpawners', 'mobDensity', 'spawnMod']) assert.equal(hard[key], normal[key], key);
  assert.ok(nightmare.maxMobs <= normal.maxMobs * 1.25);
  assert.ok(nightmare.maxSpawners <= normal.maxSpawners * 1.25);
  assert.ok(nightmare.mobDensity <= normal.mobDensity * 1.25);
  for (const difficulty of DIFFICULTIES) {
    gameState.difficulty = difficulty;
    const level = new Level(128, 128);
    for (let i = 0; i < difficulty.maxMobs; i++) createMob(level, 'bat', centre(i % 16 * 7), centre(Math.floor(i / 16) * 7));
    assert.equal(canSpawnMob(level, 'mummy', centre(115), centre(115)), false, `${difficulty.name} exceeds mob cap`);
    for (const e of [...world]) world.remove(e);
  }
});

test('treasure guards are placed once by difficulty and never rise again', () => {
  for (const difficulty of DIFFICULTIES) {
    gameState.difficulty = difficulty;
    const level = new Level(40, 40);
    createBuilding(centre(20), centre(20), 'treasure');
    spawnTreasureGuards(level);
    const guards = () => [...world.with('ai')].filter((m) => m.mobType === 'pharao');
    assert.equal(guards().length, difficulty.pharaohs, difficulty.name);
    for (const g of guards()) g.removed = true;
    for (const e of [...world]) if (e.removed) world.remove(e);
    for (let t = 0; t < 60 * 60 * 2; t++) updateSpawners(level, 1);
    assert.equal(guards().length, 0, `${difficulty.name} pharaohs respawned`);
    for (const e of [...world]) world.remove(e);
  }
});

test('a nest stops at its brood limit', () => {
  const level = new Level(40, 40);
  gameState.difficulty = DIFFICULTIES[3];
  const nest = createSpawner(centre(20), centre(20), 'snake');
  nest.freezeTime = 0;
  for (let t = 0; t < 60 * 60 * 5; t++) {
    nest.spawner.timer = Math.min(nest.spawner.timer, 1);
    updateSpawners(level, 1);
    // Far from home, the brood still counts against its nest.
    for (const m of world.with('ai')) m.position.x = nest.position.x + 500 + (m.position.x % 7) * 20;
  }
  assert.equal([...world.with('ai')].length, MAX_PER_NEST);
});

test('only the nearest few mobs keep chasing one player', () => {
  const level = new Level(40, 40);
  const p = createPlayer(centre(20), centre(20), Team.One);
  const mobs = [];
  for (let i = 0; i < 10; i++) mobs.push(createMob(level, 'bat', p.position.x + 20 + i * 8, p.position.y));
  for (let t = 0; t < 120; t++) updateAI(level, 1);
  const chasing = mobs.filter((m) => m.ai.type === 'chase');
  assert.equal(chasing.length, MAX_CHASERS);
});

test('Hard mobs regenerate health, Normal mobs do not', () => {
  const level = new Level(12, 12);
  for (const index of [1, 2]) {
    gameState.difficulty = DIFFICULTIES[index];
    const mob = createMob(level, 'mummy', centre(5), centre(5));
    mob.health.current = 1;
    mob.regenTimer = 1;
    updateCombatTimers(1);
    assert.equal(mob.health.current, index === 2 ? 2 : 1);
    world.remove(mob);
  }
});

test('nest output respects the original interval and ignores dead nests', () => {
  const level = new Level(20, 20);
  const nest = createSpawner(centre(8), centre(8), 'mummy');
  nest.freezeTime = 0;
  nest.spawner.timer = 1;
  updateSpawners(level, 1);
  assert.equal(nest.spawner.spawnCount, 1);
  assert.equal(nest.spawner.timer, 300, 'Normal nests should wait five seconds');
  for (const mob of [...world.with('ai')]) world.remove(mob);
  for (let t = 0; t < 299; t++) updateSpawners(level, 1);
  assert.equal(nest.spawner.spawnCount, 1);
  updateSpawners(level, 1);
  assert.equal(nest.spawner.spawnCount, 2);
  nest.health.current = 0;
  nest.spawner.timer = 1;
  updateSpawners(level, 1);
  assert.equal(nest.spawner.spawnCount, 2);
});

test('random nests replenish each second, stay away from home, and stop at the nest cap', () => {
  const level = new Level(96, 96);
  level.setSpawnPoints(Team.One, [{ x: centre(48), y: centre(48) }]);
  for (let t = 0; t < 59; t++) updateRandomSpawner(level);
  assert.equal([...world.with('spawner')].length, 0);
  for (let t = 0; t < 60000; t++) updateRandomSpawner(level);
  const nests = [...world.with('spawner')];
  assert.equal(nests.length, gameState.difficulty.maxSpawners);
  for (const nest of nests) assert.ok(Math.hypot(nest.position.x - centre(48), nest.position.y - centre(48)) >= 256);
});

test('a new map opens with half the nest cap, all clear of both homes', () => {
  const level = new Level(96, 96);
  level.setSpawnPoints(Team.One, [{ x: centre(48), y: centre(80) }]);
  level.setSpawnPoints(Team.Two, [{ x: centre(48), y: centre(15) }]);
  spawnInitialSpawners(level);
  const nests = [...world.with('spawner')];
  assert.equal(nests.length, Math.ceil(gameState.difficulty.maxSpawners / 2));
  for (const nest of nests) {
    for (const team of [Team.One, Team.Two]) {
      const home = level.getRandomSpawnPoint(team);
      assert.ok(Math.hypot(nest.position.x - home.x, nest.position.y - home.y) >= 256);
    }
  }
});

test('old saves adopt current spawn limits rather than restoring the former unlimited settings', () => {
  const p = createPlayer(centre(5), centre(5), Team.One);
  world.addComponent(p, 'playerSlot', 'host');
  const state = captureWorld(new Level(12, 12));
  state.settings.difficulty = { ...state.settings.difficulty, mobDensity: 100000, spawnMod: 0.25 };
  delete state.settings.difficulty.maxMobs;
  delete state.settings.difficulty.maxSpawners;
  validateWorld(state);
  restoreSettings(state);
  assert.equal(gameState.difficulty, DIFFICULTIES[1]);
});

test('Normal AI places three spaced home turrets before rails, then stages one carriage on an unfinished line', () => {
  const level = new Level(32, 32);
  level.setSpawnPoints(Team.Two, [{ x: centre(14), y: centre(5) }]);
  track(level, 14, 8, TileType.PlayerRail);
  for (let y = 9; y <= 15; y++) track(level, 14, y);
  createBuilding(centre(14), centre(28), 'treasure');
  createShopItem(centre(12), centre(4), 'turret', Team.Two);
  const ai = computer(14, 5, 1500);
  ai.aiPlayer.difficulty = 'Normal';
  let firstRail = -1;
  let firstCarriage = -1;
  let turretsAtFirstTransport = 0;
  for (let tick = 0; tick < 3400; tick++) {
    aiTick(level);
    updateRailDroids(level);
    if (firstRail < 0 && level.getTile(14, 16).type === TileType.Rail) {
      firstRail = tick;
      turretsAtFirstTransport = [...world.with('turret')].filter((e) => e.carriedBy === undefined).length;
    }
    if (firstCarriage < 0 && [...world.with('railDroid')].length > 0) {
      firstCarriage = tick;
      turretsAtFirstTransport = [...world.with('turret')].filter((e) => e.carriedBy === undefined).length;
      assert.notEqual(level.getTile(14, 26).type, TileType.Rail, 'waited until the line reached treasure');
    }
    if (firstRail >= 0 && firstCarriage >= 0) break;
  }
  const turrets = [...world.with('turret')].filter((e) => e.carriedBy === undefined);
  assert.equal(turrets.length, 3);
  assert.equal(turretsAtFirstTransport, 3, 'started transport before securing home');
  for (const turret of turrets) {
    assert.ok(Math.hypot(turret.position.x - centre(14), turret.position.y - centre(5)) <= 224 + 26);
    for (const other of turrets) if (turret !== other) {
      assert.ok(Math.hypot(turret.position.x - other.position.x, turret.position.y - other.position.y) >= 54);
    }
  }
  assert.ok(firstRail >= 0, 'never started track construction');
  assert.ok(firstCarriage >= 0, 'never staged a carriage');
  assert.equal([...world.with('railDroid')].length, 1, 'overpopulated the short unfinished line');
});

test('AI stands a turret beside laid track far from home', () => {
  const level = new Level(32, 32);
  level.setSpawnPoints(Team.Two, [{ x: centre(14), y: centre(5) }]);
  track(level, 14, 8, TileType.PlayerRail);
  for (let y = 9; y <= 22; y++) track(level, 14, y);
  createBuilding(centre(14), centre(28), 'treasure');
  createShopItem(centre(12), centre(4), 'turret', Team.Two);
  createShopItem(centre(10), centre(4), 'harvester', Team.Two);
  for (const x of [10, 14, 18]) createBuilding(centre(x), centre(5), 'turret', Team.Two);
  computer(14, 5, 1500).aiPlayer.difficulty = 'Normal';
  for (let tick = 0; tick < 6000; tick++) aiTick(level);
  const far = [...world.with('turret')].filter((e) => e.carriedBy === undefined
    && Math.hypot(e.position.x - centre(14), e.position.y - centre(5)) > 8 * 32);
  assert.ok(far.length >= 1, 'no turret was stood along the track');
  assert.ok(far.every((e) => Math.abs(e.position.x - centre(14)) <= 4 * 32), 'turret not beside the track');
});

test('AI carrying a turret gives up on a tunnel blocked by a stuck carriage', () => {
  const level = new Level(30, 12);
  for (let y = 0; y < 12; y++) for (let x = 0; x < 30; x++) put(level, x, y, TileType.Wall);
  for (let x = 2; x <= 25; x++) put(level, x, 5, TileType.Floor);
  for (let y = 2; y <= 8; y++) for (let x = 19; x <= 25; x++) put(level, x, y, TileType.Floor);
  for (let x = 9; x <= 11; x++) track(level, x, 5);
  level.setSpawnPoints(Team.Two, [{ x: centre(3), y: centre(5) }]);
  const blocker = createRailDroid(centre(10), centre(5), Team.Two);
  blocker.railDroid.dir = 1;
  blocker.freezeTime = 1e9;
  const ai = computer(4, 5, 0);
  const turret = createBuilding(centre(4), centre(5), 'turret', Team.Two);
  world.addComponent(turret, 'carriedBy', world.id(ai));
  world.addComponent(ai, 'carryingId', world.id(turret));
  for (let tick = 0; tick < 2400 && ai.carryingId !== undefined; tick++) {
    aiTick(level);
    updateRailDroids(level);
  }
  assert.equal(ai.carryingId, undefined, 'still holding the turret, jammed against the carriage');
});

test('an unfinished long line gets only two staggered carriages, not a purchase burst', () => {
  const level = new Level(36, 40);
  level.setSpawnPoints(Team.Two, [{ x: centre(14), y: centre(5) }]);
  track(level, 14, 8, TileType.PlayerRail);
  for (let y = 9; y <= 25; y++) track(level, 14, y);
  createBuilding(centre(14), centre(37), 'treasure');
  const ai = computer(14, 5, 400);
  ai.aiPlayer.difficulty = 'Normal';
  // Other expenditures are unavailable so only the carriage strategy is measured.
  const buys = [];
  let count = 0;
  for (let tick = 0; tick < 1700; tick++) {
    aiTick(level);
    updateRailDroids(level);
    const next = [...world.with('railDroid')].length;
    if (next > count) {
      buys.push(tick);
      count = next;
    }
  }
  assert.equal(buys.length, 2);
  assert.ok(buys[1] - buys[0] >= 600, `carriage purchase burst: ${buys}`);
  assert.notEqual(level.getTile(14, 26).type, TileType.Rail);
});

test('isolated rails do not inflate the AI fleet for a short connected line', () => {
  const level = new Level(32, 32);
  level.setSpawnPoints(Team.Two, [{ x: centre(14), y: centre(5) }]);
  track(level, 14, 8, TileType.PlayerRail);
  for (let y = 9; y <= 11; y++) track(level, 14, y);
  for (let y = 15; y <= 25; y++) {
    for (let x = 18; x <= 22; x++) track(level, x, y);
  }
  createBuilding(centre(14), centre(28), 'treasure');
  const ai = computer(14, 5, 200);
  ai.aiPlayer.difficulty = 'Normal';
  for (let tick = 0; tick < 300; tick++) aiTick(level);
  assert.equal([...world.with('railDroid')].length, 0);
});

/** A room with a tall wall between two spots; the ceiling (the map edge) is the only way to bank a shot over it. */
function wallRoom() {
  const level = new Level(20, 8);
  for (let y = 1; y <= 7; y++) put(level, 10, y, TileType.Wall);
  return level;
}
const RAY = BULLET_CONFIGS.ray;
const rayShot = { speed: RAY.speed, range: RAY.range, bounces: RAY.bounces, radius: RAY.radius };

test('a plasma ricochet worked out round a wall really hits when fired', () => {
  const level = wallRoom();
  const shooter = createPlayer(centre(8), centre(2), Team.Two);
  const victim = createPlayer(centre(12), centre(2), Team.One);
  assert.equal(level.checkLineOfSight(shooter.position.x, shooter.position.y, victim.position.x, victim.position.y), false);
  const rad = victim.radius;
  const shot = solveRicochet(level, shooter.position, rayShot, {
    x: victim.position.x, y: victim.position.y - victim.yOffset, hw: rad.x, hh: rad.y + victim.yOffset / 2,
  });
  assert.ok(shot, 'found no way round the wall');
  assert.ok(shot.bounces >= 1);
  createBullet(shooter, 'ray', Math.cos(shot.angle), Math.sin(shot.angle));
  for (let tick = 0; tick < 300 && victim.health.current === victim.health.max; tick++) {
    updateBullets(level, 1);
    updateBulletCollision(1);
    for (const e of [...world]) if (e.removed) world.remove(e);
  }
  assert.ok(victim.health.current < victim.health.max, 'the bank shot missed');
});

test('there is no ricochet when no wall can bounce a shot to the target', () => {
  const level = new Level(40, 40);
  const shooter = createPlayer(centre(20), centre(20), Team.Two);
  const victim = createPlayer(centre(32), centre(20), Team.One);
  const shot = solveRicochet(level, shooter.position, rayShot, {
    x: victim.position.x, y: victim.position.y - victim.yOffset, hw: 10, hh: 14,
  });
  assert.equal(shot, null);
});

test('Hard AI with a plasma gun shoots a rival hiding behind a wall by banking the shot', () => {
  const level = wallRoom();
  level.setSpawnPoints(Team.Two, [{ x: centre(8), y: centre(2) }]);
  const ai = computer(8, 2, 0);
  ai.aiPlayer.difficulty = 'Hard';
  ai.weaponInventory.weapons.push('raygun');
  const human = createPlayer(centre(12), centre(2), Team.One);
  world.addComponent(human, 'playerSlot', 'host');
  world.addComponent(human, 'remoteInput', true);
  for (let tick = 0; tick < 900 && human.health.current === human.health.max; tick++) aiTick(level);
  assert.ok(human.health.current < human.health.max, 'never hit the hidden rival');
  assert.equal(ai.weaponInventory.weapons[ai.weaponInventory.current], 'raygun');
});

test('weapon choice follows the range: the shotgun comes out up close', () => {
  const level = new Level(24, 12);
  level.setSpawnPoints(Team.Two, [{ x: centre(3), y: centre(5) }]);
  const ai = computer(3, 5, 0);
  ai.aiPlayer.difficulty = 'Hard';
  ai.weaponInventory.weapons.push('shotgun', 'raygun');
  const rival = createPlayer(centre(5), centre(5), Team.One);
  world.addComponent(rival, 'playerSlot', 'host');
  world.addComponent(rival, 'remoteInput', true);
  rival.health.immortal = true;
  const closeUp = new Set();
  for (let tick = 0; tick < 200; tick++) {
    aiTick(level);
    if (Math.hypot(ai.position.x - rival.position.x, ai.position.y - rival.position.y) < 80) {
      closeUp.add(ai.weaponInventory.weapons[ai.weaponInventory.current]);
    }
  }
  assert.ok(closeUp.has('shotgun'), `close range used ${[...closeUp]}`);
});

test('AI carrying a turret puts it down to fight a rival in sight, then goes back for it', () => {
  const level = new Level(24, 12);
  level.setSpawnPoints(Team.Two, [{ x: centre(4), y: centre(5) }]);
  const ai = computer(4, 5, 0);
  ai.aiPlayer.difficulty = 'Normal';
  const turret = createBuilding(centre(4), centre(5), 'turret', Team.Two);
  world.addComponent(turret, 'carriedBy', world.id(ai));
  world.addComponent(ai, 'carryingId', world.id(turret));
  const rival = createPlayer(centre(10), centre(5), Team.One);
  world.addComponent(rival, 'playerSlot', 'host');
  world.addComponent(rival, 'remoteInput', true);
  rival.health.immortal = true;
  let dropped = false;
  let firedAt = -1;
  let retaken = false;
  for (let tick = 0; tick < 1500 && !retaken; tick++) {
    aiTick(level);
    if (ai.carryingId === undefined && !dropped) dropped = true;
    if (dropped && ai.playerInput.shoot && firedAt < 0) firedAt = tick;
    // The rival gives up and leaves a while after the AI starts shooting.
    if (firedAt >= 0 && tick > firedAt + 60 && world.has(rival)) world.remove(rival);
    if (dropped && firedAt >= 0 && tick > firedAt + 60 && ai.carryingId !== undefined) retaken = true;
  }
  assert.ok(dropped, 'kept the turret in its hands');
  assert.ok(firedAt >= 0, 'never fought back');
  assert.ok(retaken, 'did not go back for the turret');
});

test('a saboteur buys a bomb and blows up the rival track', () => {
  const level = new Level(30, 12);
  level.setSpawnPoints(Team.Two, [{ x: centre(3), y: centre(5) }]);
  createShopItem(centre(3), centre(3), 'bomb', Team.Two);
  for (let x = 18; x <= 21; x++) put(level, x, 5, TileType.Rail, { team: Team.One });
  const ai = computer(3, 5, 500);
  ai.aiPlayer.role = 'saboteur';
  const rails = () => [18, 19, 20, 21].filter((x) => level.getTile(x, 5).type === TileType.Rail).length;
  for (let tick = 0; tick < 3000 && rails() === 4; tick++) aiTick(level);
  assert.ok(rails() < 4, 'the rival rails are untouched');
  assert.equal(ai.health.current, ai.health.max, 'hurt itself with its bomb');
});

test('a builder never goes after the rival track, and a lone computer does both jobs', () => {
  const level = new Level(30, 12);
  level.setSpawnPoints(Team.Two, [{ x: centre(3), y: centre(5) }]);
  createShopItem(centre(3), centre(3), 'bomb', Team.Two);
  for (let x = 18; x <= 21; x++) put(level, x, 5, TileType.Rail, { team: Team.One });
  const ai = computer(3, 5, 500);
  ai.aiPlayer.role = 'builder';
  for (let tick = 0; tick < 1200; tick++) aiTick(level);
  assert.equal([18, 19, 20, 21].filter((x) => level.getTile(x, 5).type === TileType.Rail).length, 4);
  assert.equal([...world.with('bomb')].length, 0, 'a builder bought a bomb with nothing to open');
});

test('four players, three guests and several computers validate; bad slots, names and roles do not', () => {
  const slots = ['host', 'guest', 'guest2', 'guest3'];
  slots.forEach((slot, i) => {
    const p = createPlayer(centre(3 + i), centre(5), Team.One);
    world.addComponent(p, 'playerSlot', slot);
    world.addComponent(p, 'playerName', `Player ${i + 1}`);
  });
  const roles = ['builder', 'saboteur'];
  for (let i = 0; i < 2; i++) {
    const ai = createPlayer(centre(3 + i), centre(9), Team.Two);
    world.addComponent(ai, 'aiPlayer', { character: 'lord_lard', difficulty: 'Normal', role: roles[i] });
  }
  gameState.opponent = 'ai';
  const state = captureWorld(new Level(12, 12));
  validateWorld(state);

  const tweak = (change) => {
    const copy = structuredClone(state);
    change(copy);
    return copy;
  };
  assert.throws(() => validateWorld(tweak((c) => { c.entities.find((e) => e.data.playerSlot === 'guest3').data.playerSlot = 'guest'; })));
  assert.throws(() => validateWorld(tweak((c) => { c.entities.find((e) => e.data.playerSlot === 'guest').data.playerName = '<b>'; })));
  assert.throws(() => validateWorld(tweak((c) => { c.entities.find((e) => e.data.aiPlayer).data.aiPlayer.role = 'pirate'; })));
  assert.throws(() => validateWorld(tweak((c) => { c.settings.multiplayerMode = 'enemy'; })), 'extra guests cannot play an enemy match');
});

test('player names are trimmed, limited and stripped of markup', () => {
  assert.equal(cleanName('  Ann   Lee  '), 'Ann Lee');
  assert.equal(cleanName('<script>alert(1)</script>'), 'scriptalert1');
  assert.equal(cleanName('x'.repeat(40)).length, 12);
  assert.equal(cleanName(42), '');
});
