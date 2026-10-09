import { Container, Graphics, Ticker } from 'pixi.js';
import type { Application } from 'pixi.js';
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
import { updateRandomSpawner } from '../systems/RandomSpawnerSystem';
import { updateInteraction, takeNotices, shopItemNear, carriedByPlayer } from '../systems/InteractionSystem';
import { SHOP_DEFS } from '../entities/ShopItemFactory';
import { updateTurrets, updateHarvesters, updateBombs } from '../systems/BuildingSystem';
import { makeText, makeTitle } from '../ui/PixelText';
import { PixelButton } from '../ui/PixelButton';
import { gameState } from '../game/GameState';
import { sound } from '../audio/SoundPlayer';
import { camera, GAME_WIDTH, GAME_HEIGHT, VIEW_HEIGHT } from '../render/Camera';
import { HudPanel } from '../ui/HudPanel';
import { DarknessRenderer } from '../level/DarknessRenderer';
import { keyLabel } from '../game/Settings';

/** Tiles of sight around the player, as in Java's Player.tick(). */
const REVEAL_RADIUS = 5;

export class InGameScene implements Scene {
  container: Container;
  private gameLayer = new Container();
  private hudLayer = new Container();
  private overlay = new Container();

  private level!: Level;
  private player!: Entity;
  private ticker = new Ticker();

  private hud!: HudPanel;
  private darkness = new DarknessRenderer();

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

    this.level = await loadTmxLevel(gameState.selectedLevel.path, gameState.difficulty.shopCostMod);
    this.level.targetScore = gameState.targetScore;

    this.gameLayer.sortableChildren = true;
    this.container.addChild(this.gameLayer);
    this.container.addChild(this.hudLayer);
    this.container.addChild(this.overlay);

    const levelSprite = buildLevelSprite(this.app, this.level);
    levelSprite.zIndex = -Number.MAX_SAFE_INTEGER;
    this.gameLayer.addChild(levelSprite);

    // Fog sits above every world sprite but below the HUD.
    this.darkness.container.zIndex = Number.MAX_SAFE_INTEGER;
    this.gameLayer.addChild(this.darkness.container);

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
    this.hud = new HudPanel();
    this.hudLayer.addChild(this.hud.container);
  }

  /** Shows what the player is standing next to, or what they are carrying. */
  private updatePrompt(): void {
    this.hud.setNotices(takeNotices().map((n) => n.text));

    const held = carriedByPlayer(this.player);
    if (held) {
      this.hud.setPrompt(`Carrying ${held.building!.type} — [${keyLabel('use')}] to place`);
      return;
    }

    const shop = shopItemNear(this.player);
    this.hud.setPrompt(
      shop
        ? `${SHOP_DEFS[shop.shopItem!.kind].label} — ${shop.shopItem!.cost} coins — [${keyLabel('use')}] to buy`
        : '',
    );
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
    title.y = 110;
    this.overlay.addChild(title);

    const resume = new PixelButton('Resume', 200, 28);
    resume.x = (GAME_WIDTH - 200) / 2;
    resume.y = 170;
    resume.onPress = () => this.togglePause();
    this.overlay.addChild(resume);

    const quit = new PixelButton('Quit to Menu', 200, 28);
    quit.x = (GAME_WIDTH - 200) / 2;
    quit.y = 210;
    quit.onPress = () => this.manager.goto('title');
    this.overlay.addChild(quit);
  }

  private centerCameraOn(x: number, y: number): void {
    const maxX = Math.max(0, this.level.width * TILE_WIDTH - GAME_WIDTH);
    const maxY = Math.max(0, this.level.height * TILE_HEIGHT - VIEW_HEIGHT);
    camera.x = Math.min(Math.max(x - GAME_WIDTH / 2, 0), maxX);
    camera.y = Math.min(Math.max(y - VIEW_HEIGHT / 2, 0), maxY);
    this.gameLayer.x = -Math.round(camera.x);
    this.gameLayer.y = -Math.round(camera.y);
  }

  private tick(dt: number): void {
    if (this.paused || this.finished) return;

    updateInput(dt);
    updateInteraction();
    updateAI(this.level, dt);
    updateWeapons(dt);
    updateTurrets(this.level, dt);
    updateMovement(this.level, dt);
    updateBullets(this.level, dt);
    updateCombatTimers(dt);
    updateBulletCollision(dt);
    updateContactDamage(dt);
    updateBuffs(dt);
    updateLoot(dt);
    updateHarvesters(dt);
    updateSpawners(this.level, dt);
    updateRandomSpawner(this.level);
    // Bombs must detonate before DeathSystem clears the destroyed entity.
    updateBombs(dt);
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
      this.level.reveal(
        Math.floor(pos.x / TILE_WIDTH),
        Math.floor(pos.y / TILE_HEIGHT),
        REVEAL_RADIUS,
      );
    }
    this.darkness.update(this.level);

    this.hud.update(this.player, this.level);
    this.updatePrompt();

    // The player entity is removed by DeathSystem once health hits zero.
    if (!health || health.current <= 0 || this.player.removed) {
      this.end(0);
    } else if (stats && stats.score >= this.level.targetScore) {
      this.end(Team.One);
    }
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
    this.darkness.destroy();
    clearSprites();
    this.container.destroy({ children: true });
  }
}
