import { Application, Container, Sprite } from 'pixi.js';
import { world } from '../world';
import { Level } from '../level/Level';
import { TileType, TILE_WIDTH, TILE_HEIGHT } from '../level/TileType';
import { buildLevelSprite } from '../level/TileRenderer';
import { createPlayer } from '../entities/PlayerFactory';
import { createMob } from '../entities/MobFactory';
import { Team } from '../world';
import { initInput, updateInput } from '../systems/InputSystem';
import { updateMovement } from '../systems/MovementSystem';
import { updateRender, sortByDepth } from '../systems/RenderSystem';
import { updateCombatTimers, updateBulletCollision } from '../systems/CombatSystem';
import { updateAI } from '../systems/AISystem';
import { updateAnimation } from '../systems/AnimationSystem';
import { updateBuffs } from '../systems/BuffSystem';
import { updateLoot } from '../systems/LootSystem';
import { updateDeath } from '../systems/DeathSystem';
import { updateSpawners } from '../systems/SpawnerSystem';

const GAME_WIDTH = 320;
const GAME_HEIGHT = 240;
const SCALE = 3;

export class Game {
  private app: Application;
  private level!: Level;
  private gameLayer!: Container;
  private uiLayer!: Container;

  constructor() {
    this.app = new Application();
  }

  async init(): Promise<void> {
    await this.app.init({
      width: GAME_WIDTH * SCALE,
      height: GAME_HEIGHT * SCALE,
      backgroundColor: 0x000000,
      antialias: false,
    });

    document.body.appendChild(this.app.canvas);

    this.gameLayer = new Container();
    this.uiLayer = new Container();
    this.app.stage.addChild(this.gameLayer);
    this.app.stage.addChild(this.uiLayer);

    // Scale up for pixel art
    this.gameLayer.scale.set(SCALE);
    this.uiLayer.scale.set(SCALE);

    initInput(this.app.canvas as HTMLCanvasElement);

    this.setupLevel();
  }

  private setupLevel(): void {
    this.level = new Level(30, 20);

    // Build walls around the border
    for (let tx = 0; tx < 30; tx++) {
      this.level.setTile(tx, 0, { ...this.level.getTile(tx, 0)!, type: TileType.Wall, solid: true, passable: false, buildable: false, castsShadow: true });
      this.level.setTile(tx, 19, { ...this.level.getTile(tx, 19)!, type: TileType.Wall, solid: true, passable: false, buildable: false, castsShadow: true });
    }
    for (let ty = 0; ty < 20; ty++) {
      this.level.setTile(0, ty, { ...this.level.getTile(0, ty)!, type: TileType.Wall, solid: true, passable: false, buildable: false, castsShadow: true });
      this.level.setTile(29, ty, { ...this.level.getTile(29, ty)!, type: TileType.Wall, solid: true, passable: false, buildable: false, castsShadow: true });
    }

    // Add spawn points
    this.level.addSpawnPoint(3 * TILE_WIDTH, 3 * TILE_HEIGHT, Team.One);
    this.level.addSpawnPoint(26 * TILE_WIDTH, 16 * TILE_HEIGHT, Team.Two);

    // Render static level layer
    const levelSprite = buildLevelSprite(this.app, this.level);
    this.gameLayer.addChild(levelSprite);

    // Spawn a test player
    const spawn1 = this.level.getRandomSpawnPoint(Team.One);
    if (spawn1) createPlayer(spawn1.x, spawn1.y, Team.One, 'lord_lard');

    // Spawn some mobs for testing
    for (let i = 0; i < 5; i++) {
      const mx = (5 + Math.floor(Math.random() * 20)) * TILE_WIDTH + TILE_WIDTH / 2;
      const my = (5 + Math.floor(Math.random() * 10)) * TILE_HEIGHT + TILE_HEIGHT / 2;
      createMob(this.level, 'mummy', mx, my);
    }

    // Start game loop
    this.app.ticker.add(this.tick.bind(this));
  }

  private tick(ticker: { deltaTime: number }): void {
    const dt = ticker.deltaTime;

    updateInput(dt);
    updateAI(this.level, dt);
    updateMovement(this.level, dt);
    updateCombatTimers(dt);
    updateBulletCollision(dt);
    updateBuffs(dt);
    updateLoot(dt);
    updateSpawners(this.level, dt);
    updateDeath(this.level, dt);
    updateAnimation(dt);
    updateRender(dt);
    sortByDepth(this.gameLayer);
  }
}
