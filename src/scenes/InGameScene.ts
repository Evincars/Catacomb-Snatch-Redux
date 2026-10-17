import { Container, Graphics, Sprite, Ticker } from 'pixi.js';
import type { Application } from 'pixi.js';
import type { Scene, SceneManager } from '../game/SceneManager';
import { world, Team } from '../world';
import type { Entity } from '../world';
import type { Level } from '../level/Level';
import { TILE_WIDTH, TILE_HEIGHT } from '../level/TileType';
import { loadTmxLevel } from '../level/TmxLoader';
import { buildLevelView } from '../level/TileRenderer';
import { createPlayer } from '../entities/PlayerFactory';
import { initInput, resetInput } from '../systems/InputSystem';
import { runSystems, SIMULATION, PRESENTATION } from '../systems/Simulation';
import type { FrameContext } from '../systems/Simulation';
import { clearSprites, updateSprites } from '../systems/SpriteSystem';
import { spawnInitialSpawners } from '../systems/RandomSpawnerSystem';
import { carriedByPlayer } from '../systems/InteractionSystem';
import { targetOf, updateTargeting } from '../systems/TargetingSystem';
import { syncWalls, resetWalls } from '../systems/WallSystem';
import { applyUpgradeLevel, upgradeCostOf } from '../entities/BuildingFactory';
import { SHOP_DEFS } from '../entities/ShopItemFactory';
import { takeNotices, clearNotices, updateNotices, noticeEvents, notify } from '../game/Notices';
import { makeText, makeTitle } from '../ui/PixelText';
import { PixelButton } from '../ui/PixelButton';
import { gameState, DEBUG_COINS, isVersus } from '../game/GameState';
import type { CharacterType } from '../entities/PlayerFactory';
import { sound } from '../audio/SoundPlayer';
import { camera, GAME_WIDTH, GAME_HEIGHT, VIEW_HEIGHT } from '../render/Camera';
import { getTexture } from '../assets/AssetLoader';
import { HudPanel } from '../ui/HudPanel';
import { TooltipView } from '../ui/Tooltip';
import { WeaponBar } from '../ui/WeaponBar';
import { DarknessRenderer } from '../level/DarknessRenderer';
import { Crosshair } from '../ui/Crosshair';
import { keyLabel } from '../game/Settings';
import { coop } from '../network/CoopSession';
import { captureWorld, WorldReplica, restoreSettings } from '../game/WorldState';
import { savedRun, saveMenu } from '../game/SaveStore';
import { Level as RestorableLevel } from '../level/Level';
import { updateInput } from '../systems/InputSystem';
import { screenToWorld } from '../render/Camera';
import { flushRemoved } from '../systems/DeathSystem';
import { Mth } from '../math/Mth';

/** Tiles of sight around the player, as in Java's Player.tick(). */
const REVEAL_RADIUS = 5;

const CHARACTERS: CharacterType[] = ['lord_lard', 'countess_cruller', 'herr_von_speck', 'duchess_donut'];

export class InGameScene implements Scene {
  container: Container;
  private gameLayer = new Container();
  private hudLayer = new Container();
  private overlay = new Container();

  private level!: Level;
  private player!: Entity;
  private ticker = new Ticker();

  private levelView?: Container;
  private hud!: HudPanel;
  private darkness = new DarknessRenderer();
  private crosshair = new Crosshair();
  private tooltip = new TooltipView();
  private weaponBar = new WeaponBar();

  private paused = false;
  private mainConfirmation: Container | null = null;
  private hostPaused = false;
  private wasConnected = false;
  private replica = new WorldReplica();
  private networkTick = 0;
  private inputSequence = 0;
  private lastTerrain = '';
  private disposed = false;
  private finished = false;
  private respawnLabel = makeText('', 0xffdd88, 18, 'center');
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
      if (this.mainConfirmation) this.closeMainConfirmation();
      else if (this.manager.hasOverlay) this.manager.escapeOverlay();
      else this.togglePause();
    };
    window.addEventListener('keydown', this.onKeyDown);

    this.load()
      .then(() => {
        if (this.disposed) return;
        this.container.removeChild(loading);
        loading.destroy();
        this.ticker.add((t) => this.tick(t.deltaTime));
        this.ticker.start();
        sound.startBackgroundMusic();
      })
      .catch((err: unknown) => {
        if (this.disposed) return;
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

    const pending = savedRun.pending;
    const snapshot = coop.role === 'guest' ? coop.latest?.state : pending?.state;
    if (snapshot) {
      restoreSettings(snapshot);
      this.hostPaused = coop.role === 'guest' && !!coop.latest?.paused;
      this.lastTerrain = JSON.stringify(snapshot.level.tiles);
      this.level = RestorableLevel.restore(snapshot.level);
      this.replica.apply(snapshot);
      if (coop.role !== 'guest') {
        for (const harvester of world.with('harvester', 'upgradable')) applyUpgradeLevel(harvester);
      }
      savedRun.pending = null;
    } else {
      if (coop.role === 'guest') throw new Error('Waiting for the host world');
      const { path } = gameState.selectedLevel;
      if (!path) throw new Error('This level has no map file.');
      if (gameState.opponentChoice === 'ai' && gameState.multiplayerMode !== 'enemy') {
        gameState.opponent = 'ai';
        // The computer never plays the same character as the people.
        const others = CHARACTERS.filter(c => c !== gameState.selectedCharacter);
        gameState.aiCharacter = others[Math.floor(Math.random() * others.length)];
      } else {
        gameState.opponent = 'none';
      }
      this.level = await loadTmxLevel(path, gameState.difficulty.shopCostMod);
      if (this.disposed) return;
      if (gameState.opponent === 'ai' && !this.level.getRandomSpawnPoint(Team.Two)) {
        gameState.opponent = 'none';
        notify('This map has no second base - playing without the computer');
      }
      this.level.targetScore = isVersus() ? 100 : gameState.targetScore;
    }
    if (import.meta.env.DEV) (window as unknown as { __level: Level }).__level = this.level;

    this.gameLayer.sortableChildren = true;
    this.container.addChild(this.gameLayer);
    this.container.addChild(this.hudLayer);
    this.container.addChild(this.overlay);
    this.respawnLabel.x = GAME_WIDTH / 2;
    this.respawnLabel.y = VIEW_HEIGHT / 2 - 18;
    this.overlay.addChild(this.respawnLabel);

    this.levelView = buildLevelView(this.level);
    this.levelView.zIndex = -Number.MAX_SAFE_INTEGER;
    this.gameLayer.addChild(this.levelView);

    // Fog sits above every world sprite but below the HUD.
    this.darkness.container.zIndex = Number.MAX_SAFE_INTEGER;
    this.gameLayer.addChild(this.darkness.container);

    const spawn =
      this.level.getRandomSpawnPoint(Team.One) ??
      { x: 2 * TILE_WIDTH, y: 2 * TILE_HEIGHT };
    const slot = coop.role === 'guest' ? 'guest' : 'host';
    const existing = [...world.with('playerSlot')].find(e => e.playerSlot === slot);
    this.player = existing ?? createPlayer(spawn.x, spawn.y, Team.One, gameState.selectedCharacter);
    world.addComponent(this.player, 'playerSlot', slot);
    world.removeComponent(this.player, 'remoteInput');
    if (!snapshot && gameState.debug) this.player.playerStats!.score = DEBUG_COINS;
    if (coop.role === 'host') {
      const guestTeam = gameState.multiplayerMode === 'enemy' ? Team.Two : Team.One;
      const guestSpawn = guestTeam === Team.One ? spawn : this.level.getRandomSpawnPoint(guestTeam);
      if (!guestSpawn) throw new Error('This map has no second-player spawn point');
      const guest = [...world.with('playerSlot')].find(e => e.playerSlot === 'guest')
        ?? createPlayer(guestSpawn.x, guestSpawn.y, guestTeam, gameState.selectedCharacter);
      world.addComponent(guest, 'playerSlot', 'guest');
      world.addComponent(guest, 'remoteInput', true);
      guest.minimapColor = 0x80dfff;
      if (!snapshot && gameState.debug) guest.playerStats!.score = DEBUG_COINS;
    } else if (!coop.role) {
      // A restored single-player run only has a local host character.
      for (const entity of world.with('playerSlot')) {
        if (entity !== this.player && entity.playerInput) world.addComponent(entity, 'remoteInput', true);
      }
    }
    if (!snapshot && coop.role !== 'guest' && gameState.opponent === 'ai') this.addComputerOpponent();
    // Placed after the player so no nest lands within sight of the start.
    if (!snapshot) spawnInitialSpawners(this.level);

    coop.onState = () => {
      if (coop.role !== 'guest' || !coop.latest || this.disposed) return;
      try {
        const { state, paused } = coop.latest;
        restoreSettings(state);
        const terrain = JSON.stringify(state.level.tiles);
        const dirty = terrain !== this.lastTerrain;
        this.lastTerrain = terrain;
        this.level = RestorableLevel.restore(state.level);
        this.hostPaused = paused;
        this.replica.apply(state);
        const guest = [...world.with('playerSlot')].find(e => e.playerSlot === 'guest');
        if (!guest) throw new Error('Host state has no guest character');
        this.player = guest;
        world.removeComponent(guest, 'remoteInput');
        for (const host of world.with('playerSlot')) {
          if (host !== guest) world.addComponent(host, 'remoteInput', true);
        }
        if (dirty) this.rebuildTerrain();
      } catch (error) {
        console.error('Applying co-op state:', error);
        this.finished = true;
        this.showLoadError(error);
      }
    };
    coop.onEnd = winner => this.end(winner);
    if (coop.role === 'host') {
      sound.onEffect = (name, x, y) => coop.sendSound(name, x, y);
      noticeEvents.onNotice = text => coop.sendNotice(text);
    }

    syncWalls(this.level);
    updateSprites(this.gameLayer);
    this.buildHud();
    // The crosshair stands in for the OS pointer while playing.
    this.container.addChild(this.crosshair.graphics);
    (this.app.canvas as HTMLCanvasElement).style.cursor = 'none';
    this.centerCameraOn(this.player.position!.x, this.player.position!.y);
    if (coop.role === 'host') coop.sendState(captureWorld(this.level), false);
  }

  /** Puts the computer opponent at the second base. */
  private addComputerOpponent(): void {
    const spawn = this.level.getRandomSpawnPoint(Team.Two);
    if (!spawn) return;
    const ai = createPlayer(spawn.x, spawn.y, Team.Two, gameState.aiCharacter);
    world.addComponent(ai, 'aiPlayer', { character: gameState.aiCharacter, difficulty: gameState.aiDifficulty.name });
    world.addComponent(ai, 'remoteInput', true);
    ai.minimapColor = 0xff5040;
  }

  /** Redraws the floor texture and wall entities after bombs change the terrain. */
  private rebuildTerrain = (): void => {
    this.level.tilesDirty = false;
    this.levelView?.destroy({ children: true });
    this.levelView = buildLevelView(this.level);
    this.levelView.zIndex = -Number.MAX_SAFE_INTEGER;
    this.gameLayer.addChild(this.levelView);
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
    if (target.chest) {
      this.hud.setPrompt(`Treasure chest - [${keyLabel('use')}] open`);
      return;
    }

    const title = target.tooltip?.title ?? 'Building';
    const cost = upgradeCostOf(target);
    const upgrade = cost === null ? '' : ` - [${keyLabel('upgrade')}] upgrade ${cost}`;
    this.hud.setPrompt(`${title} - [${keyLabel('build')}] pick up${upgrade}`);
  }

  private togglePause(): void {
    this.paused = !this.paused;
    this.mainConfirmation = null;
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
    if (coop.role && !coop.connected) {
      const status = makeText(coop.status.slice(0, 58), 0xff8888, 8, 'center');
      status.x = GAME_WIDTH / 2; status.y = 40;
      this.overlay.addChild(status);
    }

    const entries: Array<{ label: string; action: () => void }> = [
      { label: 'Resume', action: () => this.togglePause() },
      { label: 'Help', action: () => this.manager.pushOverlay('how_to_play') },
      { label: 'Options', action: () => this.manager.pushOverlay('options') },
      ... (coop.role !== 'guest' ? [{
        label: 'Save game', action: () => {
          saveMenu.state = captureWorld(this.level);
          this.manager.pushOverlay('save_game');
        },
      }] : []),
      ...(coop.role !== 'guest' ? [{ label: 'Debug', action: () => this.enableDebug() }] : []),
      { label: 'Main', action: () => this.confirmMainMenu() },
      { label: 'Exit Game', action: () => this.exitGame() },
    ];

    const BTN_W = 220;
    const BTN_H = 26;
    entries.forEach(({ label, action }, i) => {
      const button = new PixelButton(label, BTN_W, BTN_H);
      button.x = (GAME_WIDTH - BTN_W) / 2;
      button.y = 80 + i * (BTN_H + 4);
      button.onPress = action;
      this.overlay.addChild(button);
    });
  }

  private closeMainConfirmation(): void {
    this.mainConfirmation?.destroy({ children: true });
    this.mainConfirmation = null;
  }

  private confirmMainMenu(): void {
    if (this.mainConfirmation) return;
    const dialog = new Container();
    this.mainConfirmation = dialog;
    const dim = new Graphics();
    dim.rect(0, 0, GAME_WIDTH, GAME_HEIGHT).fill({ color: 0x000000, alpha: 0.85 });
    dim.eventMode = 'static';
    dialog.addChild(dim);
    const panel = new Graphics();
    panel.rect(90, 112, GAME_WIDTH - 180, 148).fill(0x241a13).stroke({ color: 0x8b613d, width: 2 });
    dialog.addChild(panel);
    const title = makeText('RETURN TO MAIN MENU?', 0xffdd88, 16, 'center');
    title.x = GAME_WIDTH / 2;
    title.y = 130;
    dialog.addChild(title);
    const warning = makeText(coop.role === 'guest'
      ? 'You will disconnect from the match.\nUnsaved progress may be lost.'
      : 'Unsaved progress will be lost.\nCancel to return and save your game.', 0xffffff, 10, 'center');
    warning.x = GAME_WIDTH / 2;
    warning.y = 163;
    dialog.addChild(warning);
    const cancel = new PixelButton('Cancel', 126, 26);
    cancel.x = GAME_WIDTH / 2 - 136;
    cancel.y = 215;
    cancel.onPress = () => this.closeMainConfirmation();
    dialog.addChild(cancel);
    const leave = new PixelButton('Main Menu', 126, 26);
    leave.x = GAME_WIDTH / 2 + 10;
    leave.y = 215;
    leave.onPress = () => this.manager.goto('title');
    dialog.addChild(leave);
    this.overlay.addChild(dialog);
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
    if (this.finished) return;
    if (coop.role === 'host' && this.wasConnected && !coop.connected && !this.paused) this.togglePause();
    this.wasConnected = coop.connected;
    if (coop.role === 'host' && ++this.networkTick % 6 === 0 && coop.connected) {
      coop.sendState(captureWorld(this.level), this.paused);
    }
    if (this.paused) {
      if (coop.role === 'guest') this.sendGuestInput(true);
      if (coop.role === 'host') coop.input = null;
      return;
    }

    const ctx: FrameContext = {
      level: this.level,
      dt,
      gameLayer: this.gameLayer,
      rebuildTerrain: this.rebuildTerrain,
    };
    if (coop.role === 'guest') {
      this.sendGuestInput(this.hostPaused || !coop.connected);
      updateTargeting();
      updateNotices();
    } else {
      this.applyGuestInput();
      runSystems(SIMULATION, ctx);
    }
    runSystems(PRESENTATION, ctx);
    if (coop.role === 'guest') flushRemoved();

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
    if (coop.role === 'host') {
      for (const teammate of world.with('playerSlot', 'position')) {
        this.level.reveal(Math.floor(teammate.position!.x / TILE_WIDTH),
          Math.floor(teammate.position!.y / TILE_HEIGHT), REVEAL_RADIUS);
      }
    }
    this.darkness.update(this.level);

    this.hud.update(this.player, this.level);
    // The other side's stalls are not for sale to this player, so their prices stay hidden.
    for (const stall of world.with('shopItem', 'priceLabel')) stall.priceLabel!.visible = stall.team === this.player.team;
    this.respawnLabel.text = this.player.respawnTicks !== undefined
      ? `Respawning in ${Math.ceil(this.player.respawnTicks / 60)}...` : '';
    this.weaponBar.update(this.player);
    this.tooltip.update(this.player);
    this.crosshair.update();
    this.updatePrompt();
    if (coop.role && (!coop.connected || this.hostPaused)) {
      this.hud.setPrompt(this.hostPaused ? 'Host paused the game' : coop.status);
    }

    // The player entity is removed by DeathSystem once health hits zero.
    if (coop.role === 'guest') return;
    if (coop.role === 'host' && ([...world.with('playerSlot')].some(e =>
      ((e.health?.current ?? 0) <= 0 && e.respawnTicks === undefined) || e.removed)
      || [...world.with('playerSlot')].length < 2)) {
      this.end(0);
    } else if (isVersus()) {
      // Versus play goes on through deaths; the first side to fill its treasury wins.
      if (!gameState.debug) {
        if (this.level.player1Score >= this.level.targetScore) this.end(Team.One);
        else if (this.level.player2Score >= this.level.targetScore) this.end(Team.Two);
      }
    } else if (!health || health.current <= 0 || this.player.removed) {
      this.end(0);
    } else if (!gameState.debug && stats
      && [...world.with('playerSlot', 'playerStats')].reduce((sum, p) => sum + p.playerStats!.score, 0) >= this.level.targetScore) {
      this.end(Team.One);
    }
  }

  private sendGuestInput(idle: boolean): void {
    updateInput(1);
    const input = structuredClone(this.player.playerInput!);
    if (idle || this.player.respawnTicks !== undefined) {
      input.up = input.down = input.left = input.right = input.shoot = input.use = input.sprint = false;
      input.keyAim = null;
      input.intents = { use: false, build: false, upgrade: false, weaponSlot: -1, weaponStep: 0 };
    }
    const aim = screenToWorld(input.mouseX, input.mouseY);
    const pos = this.player.position!;
    const dx = aim.x - pos.x, dy = aim.y - pos.y;
    const length = Math.hypot(dx, dy) || 1;
    this.player.aimVector = input.keyAim ?? { x: dx / length, y: dy / length };
    this.player.facing = Mth.aimToFacing8(this.player.aimVector.x, this.player.aimVector.y);
    coop.sendInput({ input, aim, sequence: this.inputSequence++ });
  }

  private applyGuestInput(): void {
    const guest = [...world.with('playerSlot')].find(e => e.playerSlot === 'guest');
    if (!guest?.playerInput) return;
    const frame = coop.input;
    if (!coop.connected || performance.now() - coop.lastInputAt > 500 || !frame) {
      guest.playerInput.up = guest.playerInput.down = guest.playerInput.left = guest.playerInput.right = false;
      guest.playerInput.shoot = guest.playerInput.use = guest.playerInput.sprint = false;
      guest.playerInput.keyAim = null;
      guest.playerInput.intents = { use: false, build: false, upgrade: false, weaponSlot: -1, weaponStep: 0 };
      return;
    }
    guest.playerInput = structuredClone(frame.input);
    guest.aimWorld = frame.aim;
    frame.input.intents = { use: false, build: false, upgrade: false, weaponSlot: -1, weaponStep: 0 };
  }

  private end(winner: number): void {
    if (coop.role === 'host') coop.end(winner);
    this.finished = true;
    gameState.winningTeam = winner;
    sound.stopBackgroundMusic();
    this.manager.goto('game_over');
  }

  destroy(): void {
    this.disposed = true;
    coop.onState = null; coop.onEnd = null;
    sound.onEffect = null; noticeEvents.onNotice = null;
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
