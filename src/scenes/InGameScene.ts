import { Container, Sprite, Graphics, Text, TextStyle, Ticker, Rectangle, Texture } from 'pixi.js';
import type { Application } from 'pixi.js';
import type { Scene, SceneManager } from '../game/SceneManager';
import { world } from '../world';
import { Team } from '../world';
import { Level } from '../level/Level';
import { TILE_WIDTH, TILE_HEIGHT } from '../level/TileType';
import { loadTmxLevel } from '../level/TmxLoader';
import { buildLevelSprite } from '../level/TileRenderer';
import { createPlayer } from '../entities/PlayerFactory';
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
import { makeText } from '../ui/PixelText';
import { PixelButton } from '../ui/PixelButton';
import { gameState } from '../game/GameState';
import { getTexture } from '../assets/AssetLoader';

const GW = 320;
const GH = 240;
const HUD_H = 24;

export class InGameScene implements Scene {
  container: Container;
  private gameLayer!: Container;
  private hudLayer!: Container;
  private level!: Level;
  private ticker: Ticker;
  private scoreText!: Text;
  private paused = false;
  private manager: SceneManager;
  private app: Application;

  constructor(manager: SceneManager) {
    this.manager = manager;
    this.app = manager.application;
    this.container = new Container();
    this.ticker = new Ticker();

    // Show loading message while TMX loads
    const loading = makeText('Loading level...', 0xffffff, 12, 'center');
    loading.x = GW / 2;
    loading.y = GH / 2;
    this.container.addChild(loading);

    // Init keyboard input on the canvas (safe to call multiple times)
    initInput(this.app.canvas as HTMLCanvasElement);

    this.loadLevel().then(() => {
      this.container.removeChild(loading);
      this.startTicker();
    });
  }

  private async loadLevel(): Promise<void> {
    // Clear all entities from previous game
    for (const e of world.with('position')) world.remove(e);

    // Load TMX
    this.level = await loadTmxLevel(gameState.selectedLevel.path);

    // Build static level sprite
    this.gameLayer = new Container();
    this.hudLayer = new Container();
    this.container.addChild(this.gameLayer);
    this.container.addChild(this.hudLayer);

    const levelSprite = buildLevelSprite(this.app, this.level);
    this.gameLayer.addChild(levelSprite);

    // Spawn player at P1 spawn
    const spawn1 = this.level.getRandomSpawnPoint(Team.One);
    const spawnPos = spawn1 ?? { x: 3 * TILE_WIDTH, y: 3 * TILE_HEIGHT };
    const player = createPlayer(spawnPos.x, spawnPos.y, Team.One, gameState.selectedCharacter);

    // Give the player a Pixi sprite so it renders
    const playerTex = getTexture(`${gameState.selectedCharacter}_sheet`);
    if (playerTex.source) {
      const frame = new Texture({ source: playerTex.source, frame: new Rectangle(0, 0, 48, 48) });
      const sprite = new Sprite(frame);
      sprite.anchor.set(0.5, 0.5);
      world.addComponent(player, 'sprite', sprite);
      this.gameLayer.addChild(sprite);
    }

    // Spawn placeholder sprites for all mob entities
    for (const mob of world.with('position', 'ai', 'animation')) {
      const mobTex = getTexture(mob.animation!.sheet);
      if (mobTex.source) {
        const frame = new Texture({ source: mobTex.source, frame: new Rectangle(0, 0, 48, 48) });
        const sprite = new Sprite(frame);
        sprite.anchor.set(0.5, 0.5);
        world.addComponent(mob, 'sprite', sprite);
        this.gameLayer.addChild(sprite);
      }
    }

    // Build HUD
    this.buildHud();
  }

  private buildHud(): void {
    // HUD background strip at the bottom
    const hudBg = new Graphics();
    hudBg.rect(0, GH - HUD_H, GW, HUD_H).fill(0x000000aa);
    this.hudLayer.addChild(hudBg);

    // Score
    this.scoreText = makeText('Score: 0', 0xffdd44, 9);
    this.scoreText.x = 6;
    this.scoreText.y = GH - HUD_H + 7;
    this.hudLayer.addChild(this.scoreText);

    // Health bar
    const hpLabel = makeText('HP', 0xaaaaaa, 8);
    hpLabel.x = GW / 2 - 40;
    hpLabel.y = GH - HUD_H + 7;
    this.hudLayer.addChild(hpLabel);

    // Pause hint
    const hint = makeText('[ESC] Pause', 0x888888, 7, 'right');
    hint.x = GW - 4;
    hint.y = GH - HUD_H + 8;
    this.hudLayer.addChild(hint);

    // ESC key listener for pause
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') {
        this.paused = !this.paused;
        if (this.paused) this.manager.goto('pause');
      }
    };
    window.addEventListener('keydown', onKeyDown);
    this.container.on('destroyed', () => window.removeEventListener('keydown', onKeyDown));
  }

  private startTicker(): void {
    this.ticker.add((ticker) => this.tick(ticker.deltaTime));
    this.ticker.start();
  }

  private tick(dt: number): void {
    if (this.paused) return;

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

    // Update HUD score from first player
    for (const player of world.with('playerStats')) {
      if (this.scoreText) this.scoreText.text = `Score: ${player.playerStats!.score}`;
      break;
    }

    // Camera: follow the player (simple center-on-player)
    for (const player of world.with('position', 'playerStats')) {
      const px = player.position!.x;
      const py = player.position!.y;
      const targetX = GW / 2 - px;
      const targetY = GH / 2 - py;
      const maxX = 0;
      const minX = -(this.level.width * TILE_WIDTH - GW);
      const maxY = 0;
      const minY = -(this.level.height * TILE_HEIGHT - GH + HUD_H);
      this.gameLayer.x = Math.max(minX, Math.min(maxX, targetX));
      this.gameLayer.y = Math.max(minY, Math.min(maxY, targetY));
      break;
    }
  }

  destroy(): void {
    this.ticker.destroy();
    this.container.destroy({ children: true });
  }
}
