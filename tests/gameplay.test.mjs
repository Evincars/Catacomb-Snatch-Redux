import assert from 'node:assert/strict';
import { after, beforeEach, test } from 'node:test';
import { createServer } from 'vite';

// The network module registers a browser listener when it loads.
globalThis.window ??= { addEventListener() {} };
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
const { updateAIPlayers, openingCoins, startingCoins } = await load('ai/index');
const { updateAI, MAX_CHASERS } = await load('systems/AISystem');
const { updateTargeting } = await load('systems/TargetingSystem');
const { updateInteraction, updateCarried } = await load('systems/InteractionSystem');
const { updateMovement, updateSlides } = await load('systems/MovementSystem');
const { updateWeapons } = await load('systems/WeaponSystem');
const { updateBullets } = await load('systems/BulletSystem');
const { updateBulletCollision, updateCombatTimers } = await load('systems/CombatSystem');
const { updateBombs, playerBlastDamage } = await load('systems/BuildingSystem');
const { updateHoles, overHole } = await load('systems/HoleSystem');
const { canSpawnMob, updateSpawners, MAX_PER_NEST } = await load('systems/SpawnerSystem');
const { updateRandomSpawner, spawnInitialSpawners } = await load('systems/RandomSpawnerSystem');
const { spawnTreasureGuards } = await load('systems/TreasureSystem');
const { createSpawner } = await load('entities/SpawnerFactory');
const { createMob } = await load('entities/MobFactory');
const { gameState, DIFFICULTIES, AI_DIFFICULTIES } = await load('game/GameState');
const { runCommand, cheats } = await load('game/Console');
const { captureWorld, validateWorld, restoreSettings } = await load('game/WorldState');
const { solveRicochet } = await load('ai/perception/ricochet');
const { unguardedTrack } = await load('ai/perception/rails');
const { walkField, routeFor } = await load('ai/perception/navigation');
const { nearby, beginPerception } = await load('ai/perception/spatial');
const { createBullet, BULLET_CONFIGS } = await load('entities/BulletFactory');
const { cleanName, settings, AI_START_GOLD } = await load('game/Settings');
const { updateDeath } = await load('systems/DeathSystem');
const { updateWeaponPickups, createWeaponPickup, FALLEN_DROP_LIFE, throwDownWeapon } = await load('systems/DeathDropSystem');
const { giveCoins, giftRecipients, defaultGift } = await load('game/CoinGift');
const { nestFrame } = await load('entities/SpawnerFactory');
const { takePot, pileFrame, TREASURE_POTS } = await load('game/Treasury');
const { treasureVerdict, deathmatchVerdict, versusTarget } = await load('game/MatchRules');
const { scatterChests, CHEST_CAMP_CLEARANCE } = await load('systems/ChestSystem');
const { updateRespawns } = await load('systems/RespawnSystem');
const { createLoot } = await load('entities/LootFactory');
const { updateLoot } = await load('systems/LootSystem');
const { flushRemoved } = await load('systems/DeathSystem');
const { coop } = await load('network/CoopSession');
const { AI_GUN_DAMAGE, AI_DEATH_GOLD } = await load('ai/constants');
const { findMobPath } = await load('systems/AISystem');
const { attempt, attemptAsync, ensure, ValidationError, GameError, toGameError } = await load('core/errors/index');
const { Log, LogLevel, useLog, activeLog, createLog } = await load('core/log/index');

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
  assert.ok(coins >= 5000, `only ${coins} coins`);
  assert.ok(coins >= 800 + 75 * 3 + 300);
});

test('the computer spends its opening gold on the plasma gun before anything else', () => {
  const level = new Level(24, 16);
  level.setSpawnPoints(Team.Two, [{ x: centre(12), y: centre(4) }]);
  createShopItem(centre(8), centre(3), 'raygun', Team.Two);
  createShopItem(centre(10), centre(3), 'shotgun', Team.Two);
  createShopItem(centre(14), centre(3), 'turret', Team.Two);
  const ai = computer(12, 5, openingCoins(AI_DIFFICULTIES[1]));
  ai.aiPlayer.difficulty = 'Normal';
  let turretBeforeGun = false;
  for (let tick = 0; tick < 1500 && !ai.weaponInventory.weapons.includes('raygun'); tick++) {
    aiTick(level);
    if ([...world.with('turret')].length > 0) turretBeforeGun = true;
  }
  assert.ok(ai.weaponInventory.weapons.includes('raygun'), 'never bought the plasma gun');
  assert.equal(turretBeforeGun, false, 'bought a turret first');
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
    createMob(level, i % 2 ? 'snake' : 'bat', 330 + i * 8, 330);
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
  const atHome = turrets.filter((t) => Math.hypot(t.position.x - centre(14), t.position.y - centre(5)) <= 224 + 26);
  assert.ok(atHome.length >= 3, `only ${atHome.length} turrets at home`);
  assert.ok(turretsAtFirstTransport >= 3, 'started transport before securing home');
  // A well-off computer also adds turrets beyond the opening three, but never on top of each other.
  for (const turret of turrets) {
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

/** Counts how often a movement key swaps to its opposite, the twitch a person cannot produce. */
function reversals(ticks) {
  let flips = 0;
  const last = { x: 0, y: 0 };
  for (const { pi } of ticks) {
    const x = (pi.right ? 1 : 0) - (pi.left ? 1 : 0);
    const y = (pi.down ? 1 : 0) - (pi.up ? 1 : 0);
    if (x !== 0) { if (last.x !== 0 && x !== last.x) flips++; last.x = x; }
    if (y !== 0) { if (last.y !== 0 && y !== last.y) flips++; last.y = y; }
  }
  return flips;
}

test('the AI walks a long corridor and an open field without twitching left and right', () => {
  const corridor = new Level(44, 9);
  for (let y = 0; y < 9; y++) for (let x = 0; x < 44; x++) put(corridor, x, y, TileType.Wall);
  for (let x = 1; x <= 40; x++) put(corridor, x, 4, TileType.Floor);
  for (const level of [corridor, new Level(44, 20)]) {
    for (const e of [...world]) world.remove(e);
    level.setSpawnPoints(Team.Two, [{ x: centre(2), y: centre(4) }]);
    createShopItem(centre(38), centre(level === corridor ? 4 : 15), 'turret', Team.Two);
    const ai = computer(2, 4, 500);
    const seen = [];
    for (let tick = 0; tick < 700; tick++) {
      aiTick(level);
      seen.push({ pi: { ...ai.playerInput } });
      if (ai.carryingId !== undefined) break;
    }
    assert.ok(ai.carryingId !== undefined || ai.position.x > centre(30), 'never made it across');
    assert.ok(reversals(seen) <= 2, `${reversals(seen)} left/right-up/down reversals on the way`);
  }
});

test('a builder joins the rival laid track instead of laying a whole line of its own', () => {
  const level = new Level(36, 20);
  level.setSpawnPoints(Team.Two, [{ x: centre(5), y: centre(2) }]);
  track(level, 5, 3, TileType.PlayerRail);
  createBuilding(centre(30), centre(16), 'treasure');
  for (let x = 10; x <= 29; x++) put(level, x, 15, TileType.Rail, { team: Team.One });
  const ai = computer(5, 2, 3000);
  ai.aiPlayer.role = 'builder';
  ai.aiPlayer.difficulty = 'Insane';
  const mine = () => {
    const out = [];
    for (let y = 0; y < 20; y++) for (let x = 0; x < 36; x++) {
      const t = level.getTile(x, y);
      if (t.type === TileType.Rail && t.team === Team.Two) out.push({ x, y });
    }
    return out;
  };
  const touches = () => mine().some((r) => [[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dy]) => {
    const t = level.getTile(r.x + dx, r.y + dy);
    return t.type === TileType.Rail && t.team === Team.One;
  }));
  for (let tick = 0; tick < 4000 && !touches(); tick++) aiTick(level);
  assert.ok(touches(), 'never joined the rival track');
  assert.ok(mine().length < 25, `laid ${mine().length} pieces, as if it ignored the rival line`);
});

test('a saboteur whose track is joined to the rival cuts the rival link to their home first', () => {
  const level = new Level(40, 14);
  level.baseAreas.push({ x0: 2, y0: 2, x1: 7, y1: 6, team: Team.One });
  level.setSpawnPoints(Team.Two, [{ x: centre(30), y: centre(11) }]);
  put(level, 7, 4, TileType.PlayerRail, { team: Team.One });
  for (let x = 8; x <= 30; x++) put(level, x, 4, TileType.Rail, { team: Team.One });
  put(level, 30, 10, TileType.PlayerRail, { team: Team.Two });
  for (let y = 5; y <= 9; y++) put(level, 30, y, TileType.Rail, { team: Team.Two });
  createShopItem(centre(33), centre(11), 'bomb', Team.Two);
  const ai = computer(30, 11, 800);
  ai.aiPlayer.role = 'saboteur';
  const isRail = (x) => level.getTile(x, 4).type === TileType.Rail;
  for (let tick = 0; tick < 4500 && isRail(8); tick++) aiTick(level);
  assert.equal(isRail(8), false, 'the link to the rival base is still there');
  assert.equal(isRail(20), true, 'it wrecked track in the middle instead');
});

test('the AI skips a turret upgrade whose bigger circle covers little new ground', () => {
  const upgraded = (setup) => {
    for (const e of [...world]) world.remove(e);
    const level = new Level(30, 12);
    for (let y = 0; y < 12; y++) for (let x = 0; x < 30; x++) put(level, x, y, TileType.Wall);
    for (let y = 2; y <= 9; y++) for (let x = 2; x <= 12; x++) put(level, x, y, TileType.Floor);
    for (let x = 13; x <= 22; x++) put(level, x, 5, TileType.Floor);
    level.setSpawnPoints(Team.Two, [{ x: centre(4), y: centre(5) }]);
    const turret = createBuilding(centre(setup.x), centre(5), 'turret', Team.Two);
    const ai = computer(4, 5, 5000);
    ai.aiPlayer.difficulty = 'Insane';
    // Experienced enough for a level-two turret, so only the ground covered decides.
    ai.playerStats.level = 3;
    for (let tick = 0; tick < 1500 && turret.upgradable.level === 1; tick++) aiTick(level);
    return turret.upgradable.level > 1;
  };
  assert.equal(upgraded({ x: 7 }), true, 'a turret over open ground should be upgraded');
  assert.equal(upgraded({ x: 19 }), false, 'a turret at the end of a bare corridor should not');
});

function homeLevel() {
  const level = new Level(24, 12);
  level.setSpawnPoints(Team.One, [{ x: centre(3), y: centre(3) }, { x: centre(3), y: centre(3) }]);
  level.setSpawnPoints(Team.Two, [{ x: centre(20), y: centre(9) }, { x: centre(20), y: centre(9) }]);
  return level;
}
function richPlayer(slot = 'host') {
  const p = createPlayer(centre(15), centre(8), Team.One);
  world.addComponent(p, 'playerSlot', slot);
  p.playerStats.score = 1000;
  p.weaponInventory.weapons.push('shotgun', 'raygun');
  return p;
}

test('a fallen player counts down at home, leaving nine tenths of the coins and every spare gun behind', () => {
  const level = homeLevel();
  const p = richPlayer();
  p.health.current = 0;
  updateDeath(level, 1);
  assert.equal(p.respawnTicks, 600, 'no ten second countdown');
  assert.deepEqual([p.position.x, p.position.y], [centre(3), centre(3)], 'did not go home');
  assert.equal(p.playerStats.score, 100);
  const loot = [...world.with('loot')];
  assert.equal(loot.reduce((sum, c) => sum + c.loot.value, 0), 900);
  assert.ok(loot.some((c) => c.loot.kind >= 6), 'a rich purse should leave gems behind');
  assert.deepEqual([...world.with('weaponPickup')].map((g) => g.weaponPickup.kind).sort(), ['raygun', 'shotgun']);
  assert.deepEqual(p.weaponInventory.weapons, ['rifle']);
  assert.equal(p.weapon.type, 'rifle');
});

test('a co-op companion without a computer opponent also waits out the countdown', () => {
  gameState.opponent = 'none';
  coop.role = 'host';
  try {
    const level = homeLevel();
    const p = richPlayer('guest');
    p.health.current = 0;
    updateDeath(level, 1);
    assert.equal(p.respawnTicks, 600);
    assert.ok(!p.removed);
  } finally {
    coop.role = null;
  }
});

test('a lone player who dies still ends the run, with nothing dropped', () => {
  gameState.opponent = 'none';
  const level = homeLevel();
  const p = richPlayer();
  p.health.current = 0;
  updateDeath(level, 1);
  assert.equal(p.respawnTicks, undefined);
  assert.equal([...world.with('weaponPickup')].length, 0);
});

test('dropped guns lie on the ground for anyone without them to pick up, and the dead cannot', () => {
  const level = homeLevel();
  const fallen = richPlayer();
  fallen.health.current = 0;
  updateDeath(level, 1);
  const rescuer = createPlayer(centre(15), centre(8), Team.One);
  world.addComponent(rescuer, 'playerSlot', 'guest');
  const [gun, far] = [...world.with('weaponPickup')];
  far.position.x += 200;
  gun.position.x = rescuer.position.x;
  gun.position.y = rescuer.position.y;
  fallen.position.x = gun.position.x;
  fallen.position.y = gun.position.y;
  const kind = gun.weaponPickup.kind;
  updateWeaponPickups();
  assert.deepEqual(rescuer.weaponInventory.weapons, ['rifle', kind]);
  assert.equal(fallen.weaponInventory.weapons.length, 1, 'a player waiting to respawn picked a gun up');
  assert.equal([...world.with('weaponPickup')].length, 1);
  // The same kind cannot be picked up twice, and a far-off gun stays where it is.
  const again = createWeaponPickup(rescuer.position.x, rescuer.position.y, kind);
  updateWeaponPickups();
  assert.ok(again.weaponPickup, 'picked up a gun it already owned');
  assert.deepEqual(rescuer.weaponInventory.weapons, ['rifle', kind]);
});

test('the computer does not waste shots on a rival standing protected in their own base', () => {
  const level = new Level(30, 12);
  level.setSpawnPoints(Team.Two, [{ x: centre(4), y: centre(5) }]);
  const ai = computer(4, 5, 0);
  ai.aiPlayer.difficulty = 'Hard';
  const rival = createPlayer(centre(10), centre(5), Team.One);
  world.addComponent(rival, 'playerSlot', 'host');
  world.addComponent(rival, 'remoteInput', true);
  rival.spawnProtected = true;
  let shots = 0;
  for (let tick = 0; tick < 240; tick++) {
    aiTick(level);
    if (ai.playerInput.shoot) shots++;
  }
  assert.equal(shots, 0);
  assert.equal([...world.with('bullet')].length, 0);
});

test('track behind a wall counts as unguarded even inside a turret circle', () => {
  const level = new Level(24, 12);
  level.setSpawnPoints(Team.Two, [{ x: centre(2), y: centre(5) }]);
  put(level, 12, 5, TileType.Rail, { team: Team.Two });
  createBuilding(centre(10), centre(5), 'turret', Team.Two);
  const ai = computer(2, 5);
  const field = walkField(level, 2 + 5 * level.width);
  assert.equal(unguardedTrack(level, ai, field), null, 'a turret with a clear line covers the track');
  put(level, 11, 5, TileType.Wall);
  assert.ok(unguardedTrack(level, ai, walkField(level, 2 + 5 * level.width)), 'a wall between turret and track leaves it bare');
});

test('a lone computer cuts the rival link home once its track is joined to theirs', () => {
  const level = new Level(40, 14);
  level.baseAreas.push({ x0: 2, y0: 2, x1: 7, y1: 6, team: Team.One });
  level.setSpawnPoints(Team.Two, [{ x: centre(30), y: centre(11) }]);
  put(level, 7, 4, TileType.PlayerRail, { team: Team.One });
  for (let x = 8; x <= 30; x++) put(level, x, 4, TileType.Rail, { team: Team.One });
  put(level, 30, 10, TileType.PlayerRail, { team: Team.Two });
  for (let y = 5; y <= 9; y++) put(level, 30, y, TileType.Rail, { team: Team.Two });
  createShopItem(centre(33), centre(11), 'bomb', Team.Two);
  computer(30, 11, 5000);
  for (let tick = 0; tick < 4500 && level.getTile(8, 4).type === TileType.Rail; tick++) aiTick(level);
  assert.notEqual(level.getTile(8, 4).type, TileType.Rail, 'the link to the rival base is still there');
});

test('a lone computer also blows up rival track that nothing joins to its own', () => {
  const level = new Level(30, 12);
  level.setSpawnPoints(Team.Two, [{ x: centre(3), y: centre(5) }]);
  createShopItem(centre(3), centre(3), 'bomb', Team.Two);
  for (let x = 18; x <= 21; x++) put(level, x, 5, TileType.Rail, { team: Team.One });
  const ai = computer(3, 5, 5000);
  const rails = () => [18, 19, 20, 21].filter((x) => level.getTile(x, 5).type === TileType.Rail).length;
  for (let tick = 0; tick < 3500 && rails() === 4; tick++) aiTick(level);
  assert.ok(rails() < 4, 'ignored the rival track');
  assert.equal(ai.health.current, ai.health.max);
});

test('the spatial index finds entities by kind within a radius', () => {
  const near = createMob(new Level(10, 10), 'bat', 100, 100);
  createMob(new Level(10, 10), 'bat', 500, 500);
  const p = createPlayer(110, 100, Team.One);
  beginPerception();
  const found = nearby(100, 100, 40, ['mob']);
  assert.deepEqual(found, [near]);
  assert.ok(nearby(100, 100, 40, ['player']).includes(p));
});

test('routes found with Yuka A* follow the cheapest tiles and go round walls', () => {
  const level = new Level(16, 8);
  for (let y = 0; y < 7; y++) put(level, 8, y, TileType.Wall);
  const from = 2 + 3 * level.width;
  const field = walkField(level, from);
  const goal = 13 + 3 * level.width;
  const route = routeFor(level, field, goal);
  assert.equal(route.at(-1), goal);
  assert.ok(route.some((t) => t % level.width === 8 && Math.floor(t / level.width) === 7), 'went through the wall');
  assert.equal(route.length, field.dist[goal], 'the route costs what the distance field says');
});

/** Fires one shot from `shooter` along +x and returns the damage of the bullet it made. */
function shotDamage(shooter, gun) {
  shooter.weaponInventory.weapons = [gun];
  shooter.weaponInventory.current = 0;
  shooter.weapon = { type: gun, cooldown: 1, currentCooldown: 0 };
  shooter.aimVector = { x: 1, y: 0 };
  shooter.playerInput.shoot = true;
  updateWeapons(1);
  shooter.playerInput.shoot = false;
  const shots = [...world.with('bullet')].filter((b) => b.bullet.ownerId === world.id(shooter));
  for (const b of shots) world.remove(b);
  return shots[0].bullet.damage;
}

test('computer gunfire hits 0/10/20/30 % harder from Easy to Insane, gun by gun; people deal base damage', () => {
  const expected = { Easy: 1, Normal: 1.1, Hard: 1.2, Insane: 1.3 };
  for (const gun of ['rifle', 'shotgun', 'raygun']) {
    const base = BULLET_CONFIGS[{ rifle: 'rifle', shotgun: 'shotgun', raygun: 'ray' }[gun]].damage;
    const person = createPlayer(centre(2), centre(2), Team.One);
    assert.equal(shotDamage(person, gun), base, `${gun} for a person`);
    for (const [difficulty, scale] of Object.entries(expected)) {
      assert.equal(AI_GUN_DAMAGE[difficulty][gun], scale);
      const ai = createPlayer(centre(2), centre(2), Team.Two);
      world.addComponent(ai, 'aiPlayer', { character: 'lord_lard', difficulty });
      assert.ok(Math.abs(shotDamage(ai, gun) - base * scale) < 1e-9, `${gun} on ${difficulty}`);
    }
  }
});

test('a computer player that dies is handed 3000 coins to rebuild with, after dropping its purse', () => {
  const level = homeLevel();
  const ai = computer(15, 8, 1000);
  ai.health.current = 0;
  updateDeath(level, 1);
  assert.equal(AI_DEATH_GOLD, 3000);
  assert.equal(ai.respawnTicks, 600);
  assert.equal(ai.playerStats.score, 100 + AI_DEATH_GOLD, 'kept a tenth, plus the bonus');
  const dropped = [...world.with('loot')].reduce((sum, c) => sum + c.loot.value, 0);
  assert.equal(dropped, 900, 'the bonus is not spilled');
  const person = richPlayer();
  person.health.current = 0;
  updateDeath(level, 1);
  assert.equal(person.playerStats.score, 100, 'people get no bonus');
});

test('mobs path round walls with Yuka A*, and give up when walled off', () => {
  const level = new Level(10, 6);
  for (let y = 0; y < 5; y++) put(level, 5, y, TileType.Wall);
  const path = findMobPath(level, { x: centre(2), y: centre(1) }, { x: centre(8), y: centre(1) });
  assert.ok(path && path.length > 0);
  assert.deepEqual(path.at(-1), { x: 8, y: 1 });
  assert.ok(path.some((p) => p.x === 5 && p.y === 5), 'went round the bottom of the wall');
  put(level, 5, 5, TileType.Wall);
  assert.equal(findMobPath(level, { x: centre(2), y: centre(1) }, { x: centre(8), y: centre(1) }), undefined);
});

test('failures become typed GameErrors in Results, and log entries go to whichever sink is installed', async () => {
  const bad = attempt(() => ensure(false, 'nope', { why: 'test' }));
  assert.equal(bad.ok, false);
  assert.ok(bad.error instanceof ValidationError);
  assert.equal(bad.error.code, 'invalid-data');
  assert.deepEqual(bad.error.context, { why: 'test' });
  assert.deepEqual(attempt(() => 7), { ok: true, value: 7 });
  const rejected = await attemptAsync(async () => { throw new TypeError('boom'); }, 'load-failed');
  assert.ok(rejected.error instanceof GameError && rejected.error.code === 'load-failed' && rejected.error.cause instanceof TypeError);
  assert.equal(toGameError('text').message, 'text');

  class MemoryLog extends Log {
    entries = [];
    write(entry) { this.entries.push(entry); }
  }
  const previous = activeLog();
  const memory = new MemoryLog(LogLevel.Info);
  useLog(memory);
  try {
    const log = createLog('test');
    log.debug('below the threshold');
    log.warn('kept', { n: 1 });
    assert.equal(memory.entries.length, 1);
    assert.deepEqual([memory.entries[0].scope, memory.entries[0].message, memory.entries[0].context], ['test', 'kept', { n: 1 }]);
  } finally {
    useLog(previous);
  }
});

test('the computer starts with no coins unless the host grants a head start', () => {
  createShopItem(centre(4), centre(4), 'raygun', Team.Two);
  assert.equal(settings.aiStartGold, 0, 'a head start by default');
  assert.equal(startingCoins(AI_DIFFICULTIES[1], 0), 0);
  assert.equal(startingCoins(AI_DIFFICULTIES[1], 1000), 1000);
  assert.equal(startingCoins(AI_DIFFICULTIES[1], 'full'), openingCoins(AI_DIFFICULTIES[1]));
  assert.ok(AI_START_GOLD.includes(0) && AI_START_GOLD.includes('full'));
});

test('a player walking over a coin while firing picks it up, even when it passes under the body', () => {
  const level = new Level(20, 20);
  const p = createPlayer(centre(3), centre(5), Team.One);
  // Level with the chest, well above the feet: the old 16px circle round the feet never reached it.
  const coin = createLoot(centre(9), centre(5) - 18, 0, 0, 10, true);
  coin.loot.burstTicks = 0;
  for (let tick = 0; tick < 200 && !coin.removed; tick++) {
    p.playerInput.right = true;
    p.playerInput.shoot = true;
    p.aimVector = { x: 1, y: 0 };
    updateWeapons(1);
    updateMovement(level, 1);
    updateLoot(level, 1);
  }
  assert.ok(coin.removed, 'walked through the coin without taking it');
  assert.equal(p.playerStats.score, 10);
});

test("a fallen player's coins and guns vanish 25 seconds later, whatever the difficulty", () => {
  const level = homeLevel();
  gameState.difficulty = DIFFICULTIES[0];
  const p = richPlayer();
  p.health.current = 0;
  updateDeath(level, 1);
  p.position.x = p.position.y = -1000;
  assert.equal(FALLEN_DROP_LIFE, 60 * 25);
  const coins = () => [...world.with('loot')].filter((c) => !c.removed).length;
  const guns = () => [...world.with('weaponPickup')].length;
  assert.ok(coins() > 0 && guns() > 0);
  for (let tick = 0; tick < FALLEN_DROP_LIFE - 1; tick++) {
    updateLoot(level, 1);
    updateWeaponPickups();
  }
  assert.ok(coins() > 0 && guns() > 0, 'gone before 25 seconds');
  updateLoot(level, 1);
  updateWeaponPickups();
  assert.equal(coins(), 0, 'coins outlived 25 seconds');
  assert.equal(guns(), 0, 'guns outlived 25 seconds');
});

test('a lit bomb cannot be picked up, and a load that vanishes frees the hands', () => {
  const level = new Level(12, 12);
  const p = createPlayer(centre(5), centre(5), Team.One);
  p.aimVector = { x: 1, y: 0 };
  const bomb = createBuilding(centre(6), centre(5), 'bomb', Team.One);
  bomb.bomb.lit = true;
  updateTargeting();
  assert.equal(p.targetId, undefined, 'a burning bomb was offered');
  p.playerInput.intents.build = true;
  updateInteraction(level);
  assert.equal(p.carryingId, undefined, 'lifted a burning bomb');
  // Should one go off overhead anyway, the carrier's hands are empty again.
  world.addComponent(bomb, 'carriedBy', world.id(p));
  world.addComponent(p, 'carryingId', world.id(bomb));
  world.addComponent(bomb, 'removed', true);
  flushRemoved();
  assert.equal(p.carryingId, undefined, 'still holding a bomb that is gone');
});

test('a bomb hurts a player more the closer they stand to it', () => {
  assert.ok(playerBlastDamage(5, 1) > playerBlastDamage(5, 0));
  assert.ok(playerBlastDamage(5, 0) > 5, 'no worse than before at the edge');
  const level = new Level(12, 12);
  const near = createPlayer(centre(5), centre(5) + 8, Team.One);
  const far = createPlayer(centre(6) + 12, centre(5) + 8, Team.One);
  const bomb = createBuilding(centre(5), centre(5) + 7, 'bomb', Team.Two);
  bomb.bomb.lit = true;
  bomb.bomb.fuse = 0;
  updateBombs(level, 1);
  const lost = (p) => p.health.max - p.health.current;
  assert.ok(lost(far) > 0, 'the edge of the blast did nothing');
  assert.ok(lost(near) > lost(far), `near ${lost(near)} vs far ${lost(far)}`);
});

test('AI carrying a bomb puts it down to fight a rival player in sight', () => {
  const level = new Level(24, 12);
  level.setSpawnPoints(Team.Two, [{ x: centre(4), y: centre(5) }]);
  const ai = computer(4, 5, 0);
  ai.aiPlayer.difficulty = 'Normal';
  const bomb = createBuilding(centre(4), centre(5), 'bomb', Team.Two);
  world.addComponent(bomb, 'carriedBy', world.id(ai));
  world.removeComponent(bomb, 'blocking');
  world.addComponent(ai, 'carryingId', world.id(bomb));
  const rival = createPlayer(centre(11), centre(5), Team.One);
  world.addComponent(rival, 'playerSlot', 'host');
  world.addComponent(rival, 'remoteInput', true);
  rival.health.immortal = true;
  let dropped = false;
  let fired = false;
  for (let tick = 0; tick < 300 && !fired; tick++) {
    aiTick(level);
    if (ai.carryingId === undefined) dropped = true;
    if (dropped && ai.playerInput.shoot) fired = true;
  }
  assert.ok(dropped, 'kept the bomb in its hands in front of a rival');
  assert.ok(fired, 'never shot back');
});

test('with two computers the saboteur spends on bombs, not on turrets of its own', () => {
  const level = new Level(30, 12);
  level.setSpawnPoints(Team.Two, [{ x: centre(3), y: centre(5) }]);
  createShopItem(centre(3), centre(3), 'bomb', Team.Two);
  createShopItem(centre(5), centre(3), 'turret', Team.Two);
  createShopItem(centre(7), centre(3), 'raygun', Team.Two);
  for (let x = 18; x <= 21; x++) put(level, x, 5, TileType.Rail, { team: Team.One });
  const ai = computer(3, 5, 900);
  ai.aiPlayer.role = 'saboteur';
  let boughtBomb = false;
  for (let tick = 0; tick < 600 && !boughtBomb; tick++) {
    aiTick(level);
    boughtBomb = [...world.with('bomb')].length > 0;
  }
  assert.ok(boughtBomb, 'never bought a bomb');
  assert.equal([...world.with('turret')].length, 0, 'the saboteur built a turret');
  assert.ok(!ai.weaponInventory.weapons.includes('raygun'), 'bought a gun before its bomb');
});

test('the drop key throws the gun in hand down for a teammate; the starting gun stays', () => {
  const thrower = createPlayer(centre(5), centre(5), Team.One);
  thrower.weaponInventory.weapons.push('shotgun');
  thrower.weaponInventory.current = 1;
  thrower.weapon.type = 'shotgun';
  thrower.playerInput.intents.dropWeapon = true;
  updateWeapons(1);
  assert.deepEqual(thrower.weaponInventory.weapons, ['rifle']);
  assert.equal(thrower.weapon.type, 'rifle');
  const [gun] = [...world.with('weaponPickup')];
  assert.equal(gun.weaponPickup.kind, 'shotgun');
  for (let tick = 0; tick < 30; tick++) updateWeaponPickups();
  assert.ok(gun.weaponPickup, 'the thrower snatched it straight back');
  const mate = createPlayer(centre(5) + 4, centre(5), Team.One);
  updateWeaponPickups();
  assert.deepEqual(mate.weaponInventory.weapons, ['rifle', 'shotgun'], 'the teammate could not pick it up');
  assert.equal(throwDownWeapon(thrower), false, 'the starting gun was dropped');
  assert.deepEqual(thrower.weaponInventory.weapons, ['rifle']);
});

test('coins go only to a teammate, never more than the giver holds, half offered by default', () => {
  const giver = createPlayer(centre(2), centre(2), Team.One);
  world.addComponent(giver, 'playerSlot', 'host');
  const mate = createPlayer(centre(3), centre(2), Team.One);
  world.addComponent(mate, 'playerSlot', 'guest');
  const rival = createPlayer(centre(4), centre(2), Team.Two);
  world.addComponent(rival, 'playerSlot', 'guest2');
  giver.playerStats.score = 300;
  assert.deepEqual(giftRecipients(giver), [mate]);
  assert.equal(defaultGift(300), 150);
  assert.equal(giveCoins(giver, mate, 500).ok, false, 'gave more than it had');
  assert.equal(giveCoins(giver, rival, 10).ok, false, 'gave coins to the other side');
  assert.equal(giveCoins(giver, mate, 0).ok, false, 'gave nothing');
  assert.equal(giver.playerStats.score, 300);
  assert.equal(giveCoins(giver, mate, 120).ok, true);
  assert.equal(giver.playerStats.score, 180);
  assert.equal(mate.playerStats.score, 120);
});

test('a nest shows all four spawner frames as it is shot down', () => {
  assert.deepEqual([20, 15, 14, 10, 9, 5, 4, 1].map((hp) => nestFrame(hp, 20)), [0, 1, 1, 2, 2, 3, 3, 3]);
});

test('the treasure pile empties a pot at a time and is drawn emptier as it is mined', () => {
  const pile = createBuilding(centre(5), centre(5), 'treasure');
  assert.equal(pile.frame, 0);
  assert.deepEqual([100, 67, 66, 34, 33, 1, 0].map((left) => pileFrame(left, 100)), [0, 0, 1, 1, 2, 2, 3]);
  for (let i = 0; i < TREASURE_POTS / 2; i++) assert.ok(takePot(pile));
  assert.equal(pile.treasure.left, TREASURE_POTS / 2);
  assert.equal(pile.frame, 1);
  while (takePot(pile));
  assert.equal(pile.treasure.left, 0);
  assert.equal(pile.frame, 3);
  assert.equal(takePot(pile), false, 'an empty pile gave a pot');
});

test('more than half the treasure wins; an even split once it is all mined is a draw', () => {
  const level = new Level(12, 12);
  const pile = createBuilding(centre(5), centre(5), 'treasure');
  level.targetScore = versusTarget(100);
  assert.equal(level.targetScore, TREASURE_POTS, 'half of the pile, at two points a pot');
  level.player1Score = level.targetScore;
  level.player2Score = level.targetScore - 2;
  assert.equal(treasureVerdict(level), null, 'half is not yet a win while pots remain');
  level.player1Score = level.targetScore + 2;
  assert.equal(treasureVerdict(level), Team.One);
  pile.treasure.left = 0;
  level.player1Score = level.player2Score = level.targetScore;
  assert.equal(treasureVerdict(level), 'draw');
  level.player2Score -= 2;
  assert.equal(treasureVerdict(level), Team.One, 'the larger share of a spent pile wins');
});

test('in a team deathmatch the fallen stay down, and the last team standing wins', () => {
  const level = homeLevel();
  level.deathmatch = true;
  const one = richPlayer();
  const two = createPlayer(centre(20), centre(9), Team.Two);
  world.addComponent(two, 'aiPlayer', { character: 'lord_lard', difficulty: 'Easy' });
  assert.equal(deathmatchVerdict(), null);
  two.health.current = 0;
  updateDeath(level, 1);
  assert.ok(two.eliminated, 'the fallen computer was not eliminated');
  for (let tick = 0; tick < 700; tick++) updateRespawns(level, 1);
  assert.notEqual(two.respawnTicks, undefined, 'an eliminated player respawned');
  assert.equal(deathmatchVerdict(), Team.One);
  void one;
});

test('two chests are hidden on open floor well away from both camps, and the computer only opens one it has seen', () => {
  const level = new Level(40, 30);
  level.setSpawnPoints(Team.One, [{ x: centre(3), y: centre(3) }, { x: centre(3), y: centre(3) }]);
  level.setSpawnPoints(Team.Two, [{ x: centre(36), y: centre(26) }, { x: centre(36), y: centre(26) }]);
  for (let y = 0; y < 30; y++) for (let x = 0; x < 40; x++) level.getTile(x, y).buildable = true;
  assert.equal(scatterChests(level), 2);
  const chests = [...world.with('chest')];
  assert.equal(chests.length, 2);
  for (const chest of chests) {
    const tx = Math.floor(chest.position.x / 32);
    const ty = Math.floor(chest.position.y / 32);
    for (const [cx, cy] of [[3, 3], [36, 26]]) {
      assert.ok(Math.max(Math.abs(tx - cx), Math.abs(ty - cy)) > CHEST_CAMP_CLEARANCE, `chest at ${tx},${ty} too close to a camp`);
    }
  }

  for (const e of [...world]) world.remove(e);
  const room = new Level(30, 12);
  room.setSpawnPoints(Team.Two, [{ x: centre(3), y: centre(5) }]);
  // Nine tiles off: close enough that a computer told where it was would go, too far to be seen.
  const far = createBuilding(centre(12), centre(5), 'chest');
  const ai = computer(3, 5, 0);
  for (let tick = 0; tick < 400; tick++) aiTick(room);
  assert.equal(far.chest.opened, false, 'went straight to a chest it was never shown');
  const near = createBuilding(centre(7), centre(5), 'chest');
  for (let tick = 0; tick < 600 && !near.chest.opened; tick++) aiTick(room);
  assert.ok(near.chest.opened, 'never opened the chest in plain sight');
  void ai;
});

test('turret and harvester upgrades open up at player levels 3 and 7, and levels survive death', () => {
  const level = homeLevel();
  const p = createPlayer(centre(5), centre(5), Team.One);
  p.aimVector = { x: 1, y: 0 };
  p.playerStats.score = 5000;
  const turret = createBuilding(centre(6), centre(5), 'turret', Team.One);
  const tryUpgrade = () => {
    updateTargeting();
    p.playerInput.intents.upgrade = true;
    updateInteraction(level);
    p.playerInput.intents.upgrade = false;
  };
  tryUpgrade();
  assert.equal(turret.upgradable.level, 1, 'upgraded at player level 1');
  p.playerStats.level = 3;
  tryUpgrade();
  assert.equal(turret.upgradable.level, 2);
  tryUpgrade();
  assert.equal(turret.upgradable.level, 2, 'reached level 3 before player level 7');
  p.playerStats.level = 7;
  tryUpgrade();
  assert.equal(turret.upgradable.level, 3);

  const fallen = richPlayer();
  fallen.playerStats.level = 5;
  fallen.health.current = 0;
  updateDeath(level, 1);
  for (let tick = 0; tick < 700; tick++) updateRespawns(level, 1);
  assert.equal(fallen.respawnTicks, undefined);
  assert.equal(fallen.playerStats.level, 5, 'dying cost a level');
});

test('coins burst out of a kill bounce off walls instead of landing beyond them', () => {
  const level = new Level(12, 12);
  for (let y = 0; y < 12; y++) put(level, 6, y, TileType.Wall);
  for (let y = 0; y < 12; y++) put(level, 7, y, TileType.UnpassableSand);
  for (let i = 0; i < 40; i++) {
    const coin = createLoot(centre(5) + 10, centre(5), 3, (i % 5) - 2, 10, true);
    coin.position.y += i % 7;
  }
  for (let tick = 0; tick < 120; tick++) updateLoot(level, 1);
  const beyond = [...world.with('loot')].filter((c) => c.position.x >= 6 * 32);
  assert.equal(beyond.length, 0, `${beyond.length} coins went through the wall`);
});
