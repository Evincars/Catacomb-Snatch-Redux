import { Container, Graphics, Sprite, Ticker } from 'pixi.js';
import type { Application, Text } from 'pixi.js';
import type { Scene, SceneManager } from '../game/SceneManager';
import { world, Team } from '../world';
import type { Entity } from '../world';
import type { Level } from '../level/Level';
import { TILE_WIDTH, TILE_HEIGHT } from '../level/TileType';
import { loadTmxLevel } from '../level/TmxLoader';
import { buildLevelSprite } from '../level/TileRenderer';
import { createPlayer } from '../entities/PlayerFactory';
import { initInput, updateInput } from '../systems/InputSystem';
import { updateMovement } from '../systems/MovementSystem';
import { updateRender } from '../systems/RenderSystem';
import { updateSprites, clearSprites } from '../systems/SpriteSystem';
import { updateCombatTimers, updateBulletCollision, updateContactDamage } from '../systems/CombatSystem';
import { updateWeapons } from '../systems/WeaponSystem';
import { updateBullets } from '../systems/BulletSystem';
import { updateAI } from '../systems/AISystem';
import { updateAnimation } from '../systems/AnimationSystem';
import { updateBuffs } from '../systems/BuffSystem';
import { updateLoot } from '../systems/LootSystem';
import { updateDeath } from '../systems/DeathSystem';
import { updateSpawners } from '../systems/SpawnerSystem';
import { makeText, makeTitle } from '../ui/PixelText';
import { PixelButton } from '../ui/PixelButton';
import { gameState } from '../game/GameState';
import { sound } from '../audio/SoundPlayer';
import { camera, GAME_WIDTH, GAME_HEIGHT } from '../render/Camera';
import { frameTexture } from '../render/Sheets';

const HUD_H = 26;
const BAR_W = 60;

export class InGameScene implements Scene {
  container: Container;
  private gameLayer = new Container();
  private hudLayer = new Container();
  private overlay = new Container();

  private level!: Level;
  private player!: Entity;
  private ticker = new Ticker();

  private scoreText!: Text;
  private healthBar!: Graphics;
  private sprintBar!: Graphics;

  private paused = false;
  private finished = false;
  private manager: SceneManager;
  private app: Application;
  private onKeyDown: (e: KeyboardEvent) => void;

  constructor(manager: SceneManager) {
    this.manager = manager;
    this.app = manager.application;
    this.container = new Container();

    const loading = makeText('Loading level...', 0xffffff, 12, 'center');
    loading.x = GAME_WIDTH / 2;
    loading.y = GAME_HEIGHT / 2;
    this.container.addChild(loading);

    initInput(this.app.canvas as HTMLCanvasElement);

    this.onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape' && !this.finished) this.togglePause();
    };
    window.addEventListener('keydown', this.onKeyDown);

    this.load()
      .then(() => {
        this.container.removeChild(loading);
        loading.destroy();
        this.ticker.add((t) => this.tick(t.deltaTime));
        this.ticker.start();
        sound.startBackgroundMusic();
      })
      .catch((err: unknown) => {
        // A failed load used to leave a silent black screen; show it instead.
        console.error('Failed to start level', err);
        loading.destroy();
        this.container.removeChildren();
        this.showLoadError(err);
      });
  }

  private async load(): Promise<void> {
    // Drop everything from any previous session before building this one.
    clearSprites();
    for (const entity of world.entities.slice()) world.remove(entity);

    this.level = await loadTmxLevel(gameState.selectedLevel.path);
    this.level.targetScore = gameState.targetScore;

    this.gameLayer.sortableChildren = true;
    this.container.addChild(this.gameLayer);
    this.container.addChild(this.hudLayer);
    this.container.addChild(this.overlay);

    const levelSprite = buildLevelSprite(this.app, this.level);
    levelSprite.zIndex = -Number.MAX_SAFE_INTEGER;
    this.gameLayer.addChild(levelSprite);

    const spawn =
      this.level.getRandomSpawnPoint(Team.One) ??
      { x: 2 * TILE_WIDTH, y: 2 * TILE_HEIGHT };
    this.player = createPlayer(spawn.x, spawn.y, Team.One, gameState.selectedCharacter);

    updateSprites(this.gameLayer);
    this.buildHud();
    this.centerCameraOn(spawn.x, spawn.y);
  }

  private showLoadError(err: unknown): void {
    const title = makeTitle('Could not load level');
    title.x = GAME_WIDTH / 2;
    title.y = 70;
    this.container.addChild(title);

    const detail = makeText(
      `${gameState.selectedLevel.name}\n${err instanceof Error ? err.message : String(err)}`,
      0xff8888,
      8,
      'center',
    );
    detail.x = GAME_WIDTH / 2;
    detail.y = 100;
    this.container.addChild(detail);

    const back = new PixelButton('Main Menu', 120, 22);
    back.x = (GAME_WIDTH - 120) / 2;
    back.y = GAME_HEIGHT - 60;
    back.onPress = () => this.manager.goto('title');
    this.container.addChild(back);
  }

  private buildHud(): void {
    const bg = new Graphics();
    bg.rect(0, GAME_HEIGHT - HUD_H, GAME_WIDTH, HUD_H).fill({ color: 0x000000, alpha: 0.7 });
    this.hudLayer.addChild(bg);

    const y = GAME_HEIGHT - HUD_H + 4;

    this.scoreText = makeText('0', 0xffdd44, 9);
    this.scoreText.x = 20;
    this.scoreText.y = y + 6;
    this.hudLayer.addChild(this.scoreText);

    const coin = new Sprite(frameTexture('pickup_coin_gold_16', 0, 0));
    coin.x = 5;
    coin.y = y + 4;
    this.hudLayer.addChild(coin);

    const hpLabel = makeText('HP', 0xaaaaaa, 7);
    hpLabel.x = 96;
    hpLabel.y = y + 2;
    this.hudLayer.addChild(hpLabel);
    this.healthBar = new Graphics();
    this.healthBar.x = 112;
    this.healthBar.y = y + 3;
    this.hudLayer.addChild(this.healthBar);

    const spLabel = makeText('SP', 0xaaaaaa, 7);
    spLabel.x = 96;
    spLabel.y = y + 12;
    this.hudLayer.addChild(spLabel);
    this.sprintBar = new Graphics();
    this.sprintBar.x = 112;
    this.sprintBar.y = y + 13;
    this.hudLayer.addChild(this.sprintBar);

    const hint = makeText('WASD move · mouse aim · click shoot · ESC pause', 0x777777, 6, 'right');
    hint.x = GAME_WIDTH - 4;
    hint.y = GAME_HEIGHT - 9;
    this.hudLayer.addChild(hint);
  }

  private togglePause(): void {
    this.paused = !this.paused;
    this.overlay.removeChildren();
    if (!this.paused) return;

    const dim = new Graphics();
    dim.rect(0, 0, GAME_WIDTH, GAME_HEIGHT).fill({ color: 0x000000, alpha: 0.65 });
    this.overlay.addChild(dim);

    const title = makeTitle('Paused');
    title.x = GAME_WIDTH / 2;
    title.y = 70;
    this.overlay.addChild(title);

    const resume = new PixelButton('Resume', 120, 22);
    resume.x = (GAME_WIDTH - 120) / 2;
    resume.y = 110;
    resume.onPress = () => this.togglePause();
    this.overlay.addChild(resume);

    const quit = new PixelButton('Quit to Menu', 120, 22);
    quit.x = (GAME_WIDTH - 120) / 2;
    quit.y = 140;
    quit.onPress = () => this.manager.goto('title');
    this.overlay.addChild(quit);
  }

  private centerCameraOn(x: number, y: number): void {
    const maxX = Math.max(0, this.level.width * TILE_WIDTH - GAME_WIDTH);
    const maxY = Math.max(0, this.level.height * TILE_HEIGHT - (GAME_HEIGHT - HUD_H));
    camera.x = Math.min(Math.max(x - GAME_WIDTH / 2, 0), maxX);
    camera.y = Math.min(Math.max(y - (GAME_HEIGHT - HUD_H) / 2, 0), maxY);
    this.gameLayer.x = -Math.round(camera.x);
    this.gameLayer.y = -Math.round(camera.y);
  }

  private tick(dt: number): void {
    if (this.paused || this.finished) return;

    updateInput(dt);
    updateAI(this.level, dt);
    updateWeapons(dt);
    updateMovement(this.level, dt);
    updateBullets(this.level, dt);
    updateCombatTimers(dt);
    updateBulletCollision(dt);
    updateContactDamage(dt);
    updateBuffs(dt);
    updateLoot(dt);
    updateSpawners(this.level, dt);
    updateDeath(this.level, dt);
    updateSprites(this.gameLayer);
    updateAnimation(dt);
    updateRender(dt);

    const pos = this.player.position;
    const stats = this.player.playerStats;
    const health = this.player.health;

    if (pos) {
      this.centerCameraOn(pos.x, pos.y);
      sound.setListener(pos.x, pos.y);
    }

    if (stats) this.scoreText.text = `${stats.score}`;
    if (health) this.drawBar(this.healthBar, health.current / health.max, 0xcc3333);
    if (stats) this.drawBar(this.sprintBar, stats.sprint / stats.maxSprint, 0x3399dd);

    // The player entity is removed by DeathSystem once health hits zero.
    if (!health || health.current <= 0 || this.player.removed) {
      this.end(0);
    } else if (stats && stats.score >= this.level.targetScore) {
      this.end(Team.One);
    }
  }

  private drawBar(g: Graphics, fraction: number, color: number): void {
    const f = Math.max(0, Math.min(1, fraction));
    g.clear();
    g.rect(0, 0, BAR_W, 6).fill(0x222222);
    if (f > 0) g.rect(0, 0, Math.max(1, BAR_W * f), 6).fill(color);
    g.rect(0, 0, BAR_W, 6).stroke({ color: 0x000000, width: 1 });
  }

  private end(winner: number): void {
    this.finished = true;
    gameState.winningTeam = winner;
    sound.stopBackgroundMusic();
    this.manager.goto('game_over');
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.ticker.stop();
    this.ticker.destroy();
    clearSprites();
    this.container.destroy({ children: true });
  }
}
