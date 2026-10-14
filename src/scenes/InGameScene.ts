import { Container, Graphics, Sprite, Ticker } from 'pixi.js';
import type { Application } from 'pixi.js';
import type { Scene, SceneManager } from '../game/SceneManager';
import { world, Team } from '../world';
import type { Entity } from '../world';
import type { Level } from '../level/Level';
import { TILE_WIDTH, TILE_HEIGHT } from '../level/TileType';
import { loadTmxLevel } from '../level/TmxLoader';
import { buildLevelSprite } from '../level/TileRenderer';
import { createPlayer } from '../entities/PlayerFactory';
import { initInput, resetInput } from '../systems/InputSystem';
import { runSystems, SIMULATION, PRESENTATION } from '../systems/Simulation';
import type { FrameContext } from '../systems/Simulation';
import { clearSprites, updateSprites } from '../systems/SpriteSystem';
import { spawnInitialSpawners } from '../systems/RandomSpawnerSystem';
import { carriedByPlayer } from '../systems/InteractionSystem';
import { targetOf } from '../systems/TargetingSystem';
import { syncWalls, resetWalls } from '../systems/WallSystem';
import { upgradeCostOf } from '../entities/BuildingFactory';
import { SHOP_DEFS } from '../entities/ShopItemFactory';
import { takeNotices, clearNotices } from '../game/Notices';
import { makeText, makeTitle } from '../ui/PixelText';
import { PixelButton } from '../ui/PixelButton';
import { gameState, DEBUG_COINS } from '../game/GameState';
import { sound } from '../audio/SoundPlayer';
import { camera, GAME_WIDTH, GAME_HEIGHT, VIEW_HEIGHT } from '../render/Camera';
import { getTexture } from '../assets/AssetLoader';
import { HudPanel } from '../ui/HudPanel';
import { TooltipView } from '../ui/Tooltip';
import { WeaponBar } from '../ui/WeaponBar';
import { DarknessRenderer } from '../level/DarknessRenderer';
import { Crosshair } from '../ui/Crosshair';
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

  private levelSprite?: Sprite;
  private hud!: HudPanel;
  private darkness = new DarknessRenderer();
  private crosshair = new Crosshair();
  private tooltip = new TooltipView();
  private weaponBar = new WeaponBar();

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
      if (e.code !== 'Escape' || this.finished) return;
      // Escape backs out of a sub-screen first, and only then closes the pause menu.
      if (this.manager.hasOverlay) this.manager.escapeOverlay();
      else this.togglePause();
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
    resetWalls();
    clearNotices();
    for (const entity of world.entities.slice()) world.remove(entity);

    const { path } = gameState.selectedLevel;
    if (!path) throw new Error('This level has no map file.');
    this.level = await loadTmxLevel(path, gameState.difficulty.shopCostMod);
    this.level.targetScore = gameState.targetScore;
    if (import.meta.env.DEV) (window as unknown as { __level: Level }).__level = this.level;

    this.gameLayer.sortableChildren = true;
    this.container.addChild(this.gameLayer);
    this.container.addChild(this.hudLayer);
    this.container.addChild(this.overlay);

    this.levelSprite = buildLevelSprite(this.app, this.level);
    this.levelSprite.zIndex = -Number.MAX_SAFE_INTEGER;
    this.gameLayer.addChild(this.levelSprite);

    // Fog sits above every world sprite but below the HUD.
    this.darkness.container.zIndex = Number.MAX_SAFE_INTEGER;
    this.gameLayer.addChild(this.darkness.container);

    const spawn =
      this.level.getRandomSpawnPoint(Team.One) ??
      { x: 2 * TILE_WIDTH, y: 2 * TILE_HEIGHT };
    this.player = createPlayer(spawn.x, spawn.y, Team.One, gameState.selectedCharacter);
    if (gameState.debug) this.player.playerStats!.score = DEBUG_COINS;
    // Placed after the player so no nest lands within sight of the start.
    spawnInitialSpawners(this.level);

    syncWalls(this.level);
    updateSprites(this.gameLayer);
    this.buildHud();
    // The crosshair stands in for the OS pointer while playing.
    this.container.addChild(this.crosshair.graphics);
    (this.app.canvas as HTMLCanvasElement).style.cursor = 'none';
    this.centerCameraOn(spawn.x, spawn.y);
  }

  /** Redraws the floor texture and wall entities after bombs change the terrain. */
  private rebuildTerrain = (): void => {
    this.level.tilesDirty = false;
    this.levelSprite?.destroy();
    this.levelSprite = buildLevelSprite(this.app, this.level);
    this.levelSprite.zIndex = -Number.MAX_SAFE_INTEGER;
    this.gameLayer.addChild(this.levelSprite);
    syncWalls(this.level);
  };

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
    this.hudLayer.addChild(this.weaponBar.container);
    this.hudLayer.addChild(this.tooltip.container);
  }

  /** Shows what the player is standing next to, or what they are carrying. */
  private updatePrompt(): void {
    this.hud.setNotices(takeNotices().map((n) => n.text));

    const hover = world.with('hovered').first ?? null;
    const target = targetOf(this.player);
    this.hud.setHint((hover ?? target)?.tooltip?.title ?? '');

    const held = carriedByPlayer(this.player);
    if (held) {
      this.hud.setPrompt(`Carrying ${held.building?.type ?? held.tooltip?.title.toLowerCase() ?? 'it'} - [${keyLabel('use')}] to place`);
      return;
    }
    if (!target) {
      this.hud.setPrompt('');
      return;
    }

    if (target.shopItem) {
      const { kind, cost } = target.shopItem;
      this.hud.setPrompt(`${SHOP_DEFS[kind].label} - ${cost} coins - [${keyLabel('use')}] to buy`);
      return;
    }

    const title = target.tooltip?.title ?? 'Building';
    const cost = upgradeCostOf(target);
    const upgrade = cost === null ? '' : ` - [${keyLabel('upgrade')}] upgrade ${cost}`;
    this.hud.setPrompt(`${title} - [${keyLabel('build')}] pick up${upgrade}`);
  }

  private togglePause(): void {
    this.paused = !this.paused;
    this.overlay.removeChildren().forEach((c) => c.destroy({ children: true }));
    const canvas = this.app.canvas as HTMLCanvasElement;
    this.crosshair.graphics.visible = !this.paused;
    canvas.style.cursor = this.paused ? '' : 'none';
    resetInput();
    if (!this.paused) return;

    const dim = new Graphics();
    dim.rect(0, 0, GAME_WIDTH, GAME_HEIGHT).fill({ color: 0x000000, alpha: 0.6 });
    this.overlay.addChild(dim);

    const title = new Sprite(getTexture('pause_screen'));
    title.width = GAME_WIDTH;
    title.height = GAME_HEIGHT;
    this.overlay.addChild(title);

    const entries: Array<{ label: string; action: () => void }> = [
      { label: 'Resume', action: () => this.togglePause() },
      { label: 'Help', action: () => this.manager.pushOverlay('how_to_play') },
      { label: 'Options', action: () => this.manager.pushOverlay('options') },
      { label: 'Debug', action: () => this.enableDebug() },
      { label: 'Main', action: () => this.manager.goto('title') },
      { label: 'Exit Game', action: () => this.exitGame() },
    ];

    const BTN_W = 220;
    const BTN_H = 26;
    entries.forEach(({ label, action }, i) => {
      const button = new PixelButton(label, BTN_W, BTN_H);
      button.x = (GAME_WIDTH - BTN_W) / 2;
      button.y = 100 + i * (BTN_H + 4);
      button.onPress = action;
      this.overlay.addChild(button);
    });
  }

  /** Testing aid: fills the purse and stops the coin target from ending the run. */
  private enableDebug(): void {
    gameState.debug = true;
    this.player.playerStats!.score = DEBUG_COINS;
    this.togglePause();
  }

  /** Browsers only allow closing tabs a script opened, so fall back to the main menu. */
  private exitGame(): void {
    sound.stopBackgroundMusic();
    window.close();
    this.manager.goto('title');
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

    const ctx: FrameContext = {
      level: this.level,
      dt,
      gameLayer: this.gameLayer,
      rebuildTerrain: this.rebuildTerrain,
    };
    runSystems(SIMULATION, ctx);
    runSystems(PRESENTATION, ctx);

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
    this.weaponBar.update(this.player);
    this.tooltip.update();
    this.crosshair.update();
    this.updatePrompt();

    // The player entity is removed by DeathSystem once health hits zero.
    if (!health || health.current <= 0 || this.player.removed) {
      this.end(0);
    } else if (!gameState.debug && stats && stats.score >= this.level.targetScore) {
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
    this.crosshair.destroy();
    this.tooltip.destroy();
    this.weaponBar.destroy();
    (this.app.canvas as HTMLCanvasElement).style.cursor = '';
    clearSprites();
    this.container.destroy({ children: true });
  }
}
