import { Container, Graphics, Sprite, Ticker } from 'pixi.js';
import type { Application } from 'pixi.js';
import type { Scene, SceneManager } from '../game/SceneManager';
import { world, q, Team, playerInSlot, slottedCount } from '../world';
import type { Entity, PlayerSlot, AIRole } from '../world';
import type { Level, SpawnPoint } from '../level/Level';
import { TILE_WIDTH, TILE_HEIGHT } from '../level/TileType';
import { loadTmxLevel } from '../level/TmxLoader';
import { buildLevelView } from '../level/TileRenderer';
import { createPlayer } from '../entities/PlayerFactory';
import { initInput, resetInput, setInputCaptured } from '../systems/InputSystem';
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
import { gameState, isVersus } from '../game/GameState';
import { openingCoins } from '../ai';
import { cheats, resetCheats, runCommand } from '../game/Console';
import { ConsoleView } from '../ui/ConsoleView';
import type { CharacterType } from '../entities/PlayerFactory';
import { sound } from '../audio/SoundPlayer';
import { camera, GAME_WIDTH, GAME_HEIGHT, VIEW_HEIGHT } from '../render/Camera';
import { getTexture } from '../assets/AssetLoader';
import { HudPanel } from '../ui/HudPanel';
import { TooltipView } from '../ui/Tooltip';
import { WeaponBar } from '../ui/WeaponBar';
import { DarknessRenderer } from '../level/DarknessRenderer';
import { Crosshair } from '../ui/Crosshair';
import { bindingFor, keyLabel } from '../game/Settings';
import { Scoreboard } from '../ui/Scoreboard';
import { coop } from '../network/CoopSession';
import { captureWorld, WorldReplica, restoreSettings } from '../game/WorldState';
import type { WorldState } from '../game/WorldState';
import { LoadError, NetworkError, StateError, ValidationError, attempt, report } from '../core/errors';
import type { GameError } from '../core/errors';
import { savedRun, saveMenu } from '../game/SaveStore';
import { Level as RestorableLevel } from '../level/Level';
import { updateInput } from '../systems/InputSystem';
import { screenToWorld } from '../render/Camera';
import { flushRemoved } from '../systems/DeathSystem';
import { resetNameTags, updateNameTags } from '../systems/NameTagSystem';
import { aimToFacing8 } from '../render/Facing';
import { exposeForDebugging } from '../core/debugHooks';

/** Tiles of sight around the player, as in Java's Player.tick(). */
const REVEAL_RADIUS = 5;

const CHARACTERS: readonly CharacterType[] = ['lord_lard', 'countess_cruller', 'herr_von_speck', 'duchess_donut'];
/** The original versus treasury target, two points per delivered pot. */
const VERSUS_TARGET = 100;
/** Where guests start relative to the host, by join order, so nobody stands inside anyone else. */
const GUEST_OFFSETS: ReadonlyArray<readonly [number, number]> = [[0, 0], [16, 0], [-16, 0], [0, 16]];
const GUEST_MINIMAP_COLOR = 0x80dfff;
/** A guest's controls older than this are treated as let go. */
const STALE_INPUT_MS = 500;

const pricedStalls = world.with('shopItem', 'priceLabel');
const upgradedHarvesters = world.with('harvester', 'upgradable');
const hovered = world.with('hovered');

/** Someone in the party is dead and not coming back, or gone. */
function partyMemberLost(): boolean {
  for (const e of q.slotted) {
    if (e.removed || ((e.health?.current ?? 0) <= 0 && e.respawnTicks === undefined)) return true;
  }
  return false;
}

type Controls = NonNullable<Entity['playerInput']>;

function noIntents(): Controls['intents'] {
  return { use: false, build: false, upgrade: false, weaponSlot: -1, weaponStep: 0 };
}

/** Lets go of every key and button. */
function releaseControls(input: Controls): void {
  input.up = input.down = input.left = input.right = false;
  input.shoot = input.use = input.sprint = false;
  input.keyAim = null;
  input.intents = noIntents();
}

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
  private slot: PlayerSlot = 'host';
  /** Guests whose connection ended since the last tick. */
  private departed: PlayerSlot[] = [];
  private disposed = false;
  private finished = false;
  private respawnLabel = makeText('', 0xffdd88, 18, 'center');
  private console = new ConsoleView((line) => runCommand(line, { player: this.player }));
  /** Fraction of a simulation step carried over while the game runs slower than normal. */
  private stepBank = 0;
  private manager: SceneManager;
  private app: Application;
  private onKeyDown: (e: KeyboardEvent) => void;
  private onKeyUp: (e: KeyboardEvent) => void;
  private onBlur = () => { this.scoreboardHeld = false; };
  private scoreboard = new Scoreboard();
  private scoreboardHeld = false;

  constructor(manager: SceneManager) {
    this.manager = manager;
    this.app = manager.application;
    this.container = new Container();

    const loading = makeText('Loading level...', 0xffffff, 12, 'center');
    loading.x = GAME_WIDTH / 2;
    loading.y = GAME_HEIGHT / 2;
    this.container.addChild(loading);

    initInput(this.app.canvas);

    this.onKeyDown = (e: KeyboardEvent) => {
      if (this.finished) return;
      if (e.code === bindingFor('console')) {
        e.preventDefault();
        this.toggleConsole();
        return;
      }
      // Holding Tab lists the players' levels and coins.
      if (e.code === 'Tab') {
        e.preventDefault();
        this.scoreboardHeld = true;
        return;
      }
      if (this.console.visible) {
        if (e.code === 'Escape') this.toggleConsole();
        else this.console.handleKey(e);
        return;
      }
      if (e.code !== 'Escape') return;
      // Escape backs out of a sub-screen first, and only then closes the pause menu.
      if (this.mainConfirmation) this.closeMainConfirmation();
      else if (this.manager.hasOverlay) this.manager.escapeOverlay();
      else this.togglePause();
    };
    window.addEventListener('keydown', this.onKeyDown);
    this.onKeyUp = (e: KeyboardEvent) => { if (e.code === 'Tab') this.scoreboardHeld = false; };
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);

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
        const error = report(err, 'Failed to start level', 'level');
        loading.destroy();
        this.container.removeChildren();
        this.showLoadError(error);
      });
  }

  private async load(): Promise<void> {
    // Drop everything from any previous session before building this one.
    clearSprites();
    resetWalls();
    clearNotices();
    resetCheats();
    for (const entity of world.entities.slice()) world.remove(entity);

    resetNameTags();
    const pending = savedRun.pending;
    const snapshot = coop.role === 'guest' ? coop.latest?.state : pending?.state;
    this.slot = coop.role === 'guest' ? coop.slot ?? 'guest' : 'host';
    this.replica.localSlot = coop.role ? this.slot : null;
    // Nobody else can join once the match is under way.
    if (coop.role === 'host') coop.lock();
    if (snapshot) this.restore(snapshot);
    else this.level = await this.openFreshLevel();
    if (this.disposed) return;
    exposeForDebugging({ __level: this.level });

    this.gameLayer.sortableChildren = true;
    this.container.addChild(this.gameLayer);
    this.container.addChild(this.hudLayer);
    this.container.addChild(this.overlay);
    this.respawnLabel.x = GAME_WIDTH / 2;
    this.respawnLabel.y = VIEW_HEIGHT / 2 - 18;
    // Not on the overlay: pausing destroys everything there, which used to take the label with it.
    this.hudLayer.addChild(this.respawnLabel);

    this.levelView = buildLevelView(this.level);
    this.levelView.zIndex = -Number.MAX_SAFE_INTEGER;
    this.gameLayer.addChild(this.levelView);

    // Fog sits above every world sprite but below the HUD.
    this.darkness.container.zIndex = Number.MAX_SAFE_INTEGER;
    this.gameLayer.addChild(this.darkness.container);

    const spawn =
      this.level.getRandomSpawnPoint(Team.One) ??
      { x: 2 * TILE_WIDTH, y: 2 * TILE_HEIGHT };
    this.player = playerInSlot(this.slot) ?? createPlayer(spawn.x, spawn.y, Team.One, gameState.selectedCharacter);
    world.addComponent(this.player, 'playerSlot', this.slot);
    world.removeComponent(this.player, 'remoteInput');
    if (coop.role === 'host') {
      this.setName(this.player, coop.nameOf('host') ?? coop.hostName);
      this.addGuests(spawn);
    } else if (!coop.role) {
      this.markOthersRemote();
    }
    if (!snapshot && coop.role !== 'guest' && gameState.opponent === 'ai') this.addComputerOpponents();
    // Placed after the player so no nest lands within sight of the start.
    if (!snapshot) spawnInitialSpawners(this.level);

    coop.onState = () => {
      if (coop.role !== 'guest' || !coop.latest || this.disposed) return;
      const applied = attempt(() => this.applyHostState(), 'network');
      if (applied.ok) return;
      this.finished = true;
      this.showLoadError(report(applied.error, 'Applying co-op state failed', 'network'));
    };
    coop.onEnd = winner => this.end(winner);
    if (coop.role === 'host') {
      coop.onLeave = slot => this.departed.push(slot);
      sound.onEffect = (name, x, y) => coop.sendSound(name, x, y);
      noticeEvents.onNotice = text => coop.sendNotice(text);
    }

    syncWalls(this.level);
    updateSprites(this.gameLayer);
    this.buildHud();
    // The crosshair stands in for the OS pointer while playing.
    this.container.addChild(this.crosshair.graphics);
    this.app.canvas.style.cursor = 'none';
    this.centerCameraOn(this.player.position!.x, this.player.position!.y);
    if (coop.role === 'host') this.sendWorld(false, true);
  }

  /** Picks up a saved run, or the world the host sent. */
  private restore(snapshot: WorldState): void {
    restoreSettings(snapshot);
    this.hostPaused = coop.role === 'guest' && !!coop.latest?.paused;
    this.lastTerrain = JSON.stringify(snapshot.level.tiles);
    this.level = RestorableLevel.restore(snapshot.level);
    this.replica.apply(snapshot);
    savedRun.pending = null;
    if (coop.role === 'guest') return;
    for (const harvester of upgradedHarvesters) applyUpgradeLevel(harvester);
  }

  /** The computer joins unless this is an enemy match; it never plays the same character as the people. */
  private chooseOpponent(): void {
    if (gameState.opponentChoice !== 'ai' || gameState.multiplayerMode === 'enemy') {
      gameState.opponent = 'none';
      return;
    }
    gameState.opponent = 'ai';
    const others = CHARACTERS.filter(c => c !== gameState.selectedCharacter);
    gameState.aiCharacter = others[Math.floor(Math.random() * others.length)];
  }

  /** Loads the chosen map for a new run. */
  private async openFreshLevel(): Promise<Level> {
    if (coop.role === 'guest') throw new StateError('Waiting for the host world');
    const { path } = gameState.selectedLevel;
    if (!path) throw new LoadError('This level has no map file.', { context: { level: gameState.selectedLevel.name } });
    this.chooseOpponent();
    const level = await loadTmxLevel(path, gameState.difficulty.shopCostMod);
    if (gameState.opponent === 'ai' && !level.getRandomSpawnPoint(Team.Two)) {
      gameState.opponent = 'none';
      notify('This map has no second base - playing without the computer');
    }
    level.targetScore = isVersus() ? VERSUS_TARGET : gameState.targetScore;
    return level;
  }

  /** Every guest who joined gets a character: at the host's side, or at the other base in an enemy match. */
  private addGuests(spawn: SpawnPoint): void {
    const guestTeam = gameState.multiplayerMode === 'enemy' ? Team.Two : Team.One;
    coop.guestSlots().forEach((guestSlot, index) => {
      const base = guestTeam === Team.One ? spawn : this.level.getRandomSpawnPoint(guestTeam);
      if (!base) throw new ValidationError('This map has no second-player spawn point');
      // Teammates start side by side rather than inside each other.
      const [dx, dy] = GUEST_OFFSETS[index + 1] ?? [0, 0];
      const guest = playerInSlot(guestSlot) ?? createPlayer(base.x + dx, base.y + dy, guestTeam, gameState.selectedCharacter);
      world.addComponent(guest, 'playerSlot', guestSlot);
      world.addComponent(guest, 'remoteInput', true);
      this.setName(guest, coop.nameOf(guestSlot) ?? guestSlot);
      guest.minimapColor = GUEST_MINIMAP_COLOR;
    });
  }

  /** A restored single-player run only has a local host character. */
  private markOthersRemote(): void {
    for (const entity of q.slotted) {
      if (entity !== this.player && entity.playerInput) world.addComponent(entity, 'remoteInput', true);
    }
  }

  /** A guest takes the host's latest world: settings, terrain when it changed, scores and entities. */
  private applyHostState(): void {
    const { state, paused, scores, levelChanged } = coop.latest!;
    restoreSettings(state);
    let dirty = false;
    if (levelChanged) {
      const terrain = JSON.stringify(state.level.tiles);
      dirty = terrain !== this.lastTerrain;
      this.lastTerrain = terrain;
      this.level = RestorableLevel.restore(state.level);
    }
    if (scores) [this.level.player1Score, this.level.player2Score] = scores;
    this.hostPaused = paused;
    this.replica.apply(state);
    const mine = playerInSlot(this.slot);
    if (!mine) throw new NetworkError('Host state has no character for this player');
    this.player = mine;
    if (dirty) this.rebuildTerrain();
  }

  private sendWorld(paused: boolean, withLevel: boolean): void {
    if (!coop.canSendState()) return;
    if (withLevel) coop.sendLevel(this.level.snapshot());
    coop.sendState(captureWorld(this.level, false), paused, [this.level.player1Score, this.level.player2Score]);
  }

  /** Names a player's character in a multiplayer match; the others see the plate above its head. */
  private setName(entity: Entity, name: string): void {
    if (entity.playerName === undefined) world.addComponent(entity, 'playerName', name);
    else entity.playerName = name;
  }

  /**
   * Puts the computer opponents at the second base, one for each person playing. A lone
   * computer does everything; with several, they split the work between building track and
   * sabotaging the people's.
   */
  private addComputerOpponents(): void {
    const count = 1 + (coop.role === 'host' ? coop.guestSlots().length : 0);
    for (let i = 0; i < count; i++) {
      const spawn = this.level.getRandomSpawnPoint(Team.Two);
      if (!spawn) break;
      const role: AIRole = count === 1 ? 'all' : i % 2 === 0 ? 'builder' : 'saboteur';
      const ai = createPlayer(spawn.x + (i % 2 ? 12 : 0), spawn.y + (i > 1 ? 12 : 0), Team.Two, gameState.aiCharacter);
      world.addComponent(ai, 'aiPlayer', { character: gameState.aiCharacter, difficulty: gameState.aiDifficulty.name, role });
      world.addComponent(ai, 'remoteInput', true);
      ai.minimapColor = 0xff5040;
      // A quiet head start, so the computer can afford a good gun from the first minute.
      ai.playerStats!.score += openingCoins(gameState.aiDifficulty);
    }
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

  private showLoadError(err: GameError): void {
    const title = makeTitle('Could not load level');
    title.x = GAME_WIDTH / 2;
    title.y = 70;
    this.container.addChild(title);

    const detail = makeText(
      `${gameState.selectedLevel.name}\n${err.message}`,
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
    this.hudLayer.addChild(this.scoreboard.container);
    this.hudLayer.addChild(this.console.container);
  }

  /** Shows what the player is standing next to, or what they are carrying. */
  private updatePrompt(): void {
    this.hud.setNotices(takeNotices().map((n) => n.text));

    const hover = hovered.first ?? null;
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
    if (this.console.visible) this.toggleConsole();
    this.paused = !this.paused;
    this.mainConfirmation = null;
    this.overlay.removeChildren().forEach((c) => c.destroy({ children: true }));
    const canvas = this.app.canvas;
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

  private toggleConsole(): void {
    if (this.paused || !this.player) return;
    if (coop.role) {
      notify('The console is not available in multiplayer');
      return;
    }
    const open = !this.console.visible;
    if (open) this.console.open();
    else this.console.close();
    setInputCaptured(open);
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
    if (coop.role === 'host') this.removeDeparted();
    if (coop.role === 'host' && this.wasConnected && !coop.connected && !this.paused) this.togglePause();
    this.wasConnected = coop.connected;
    // 20 updates a second; the heavy terrain and fog snapshot only once a second.
    if (coop.role === 'host' && ++this.networkTick % 3 === 0 && coop.connected) {
      this.sendWorld(this.paused, this.networkTick % 60 === 0);
    }
    if (this.paused) {
      if (coop.role === 'guest') this.sendGuestInput(true);
      if (coop.role === 'host') coop.clearInputs();
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
      this.replica.glide(performance.now());
    } else {
      // The console can run the game faster or slower; each step is a normal tick.
      this.stepBank += cheats.speed;
      const steps = Math.floor(this.stepBank);
      this.stepBank -= steps;
      for (let i = 0; i < steps && !this.finished; i++) {
        this.applyGuestInput();
        runSystems(SIMULATION, ctx);
      }
    }
    runSystems(PRESENTATION, ctx);
    if (coop.role) updateNameTags(this.gameLayer, this.player);
    if (coop.role === 'guest') flushRemoved();

    const pos = this.player.position;

    if (pos) {
      this.centerCameraOn(pos.x, pos.y);
      sound.setListener(pos.x, pos.y);
      this.level.reveal(
        Math.floor(pos.x / TILE_WIDTH),
        Math.floor(pos.y / TILE_HEIGHT),
        REVEAL_RADIUS,
      );
    }
    if (coop.role === 'host') this.revealAroundTeam();
    this.darkness.update(this.level);

    this.hud.update(this.player, this.level);
    this.scoreboard.update(this.scoreboardHeld && !this.console.visible, this.player);
    // The other side's stalls are not for sale to this player, so their prices stay hidden.
    for (const stall of pricedStalls) stall.priceLabel!.visible = stall.team === this.player.team;
    this.respawnLabel.text = this.player.respawnTicks !== undefined
      ? `Respawning in ${Math.ceil(this.player.respawnTicks / 60)}...` : '';
    this.weaponBar.update(this.player);
    this.tooltip.update(this.player);
    this.crosshair.update();
    this.console.update();
    this.updatePrompt();
    if (coop.role && (!coop.connected || this.hostPaused)) {
      this.hud.setPrompt(this.hostPaused ? 'Host paused the game' : coop.status);
    }

    // The guest's screen follows the host's verdict.
    if (coop.role === 'guest') return;
    const winner = this.outcome();
    if (winner !== null) this.end(winner);
  }

  private revealAroundTeam(): void {
    for (const teammate of q.slotted) {
      const p = teammate.position;
      if (p) this.level.reveal(Math.floor(p.x / TILE_WIDTH), Math.floor(p.y / TILE_HEIGHT), REVEAL_RADIUS);
    }
  }

  /**
   * Whether the match is over, and who won (0 for nobody): a co-op party falls apart when anyone dies for
   * good or leaves; versus play goes on through deaths until one side fills its treasury; a lone run ends
   * when the player dies (DeathSystem removes them) or the party's purse reaches the target.
   */
  private outcome(): number | null {
    if (coop.role === 'host') {
      if (slottedCount() < 2 || partyMemberLost()) return 0;
    }
    if (isVersus()) {
      if (this.level.player1Score >= this.level.targetScore) return Team.One;
      return this.level.player2Score >= this.level.targetScore ? Team.Two : null;
    }
    const health = this.player.health;
    if (!health || health.current <= 0 || this.player.removed) return 0;
    let purse = 0;
    for (const p of q.slotted) purse += p.playerStats?.score ?? 0;
    return this.player.playerStats && purse >= this.level.targetScore ? Team.One : null;
  }

  private sendGuestInput(idle: boolean): void {
    updateInput(1);
    const input = structuredClone(this.player.playerInput!);
    if (idle || this.player.respawnTicks !== undefined) releaseControls(input);
    const aim = screenToWorld(input.mouseX, input.mouseY);
    const pos = this.player.position!;
    const dx = aim.x - pos.x, dy = aim.y - pos.y;
    const length = Math.hypot(dx, dy) || 1;
    this.player.aimVector = input.keyAim ?? { x: dx / length, y: dy / length };
    this.player.facing = aimToFacing8(this.player.aimVector.x, this.player.aimVector.y);
    coop.sendInput({ input, aim, sequence: this.inputSequence++ });
  }

  private applyGuestInput(): void {
    for (const slot of coop.guestSlots()) {
      const guest = playerInSlot(slot);
      if (!guest?.playerInput) continue;
      const { frame, at } = coop.inputOf(slot);
      // Controls that stopped arriving are let go of, rather than held down for ever.
      if (!frame || performance.now() - at > STALE_INPUT_MS) {
        releaseControls(guest.playerInput);
        continue;
      }
      guest.playerInput = structuredClone(frame.input);
      guest.aimWorld = frame.aim;
      // Button presses count once; the next stale tick must not repeat them.
      frame.input.intents = noIntents();
    }
  }

  /** A guest who left takes their character with them; what they carried is left on the floor. */
  private removeDeparted(): void {
    for (const slot of this.departed.splice(0)) {
      const leaver = playerInSlot(slot);
      if (!leaver) continue;
      notify(`${leaver.playerName ?? 'A player'} left the game`);
      const held = leaver.carryingId !== undefined ? world.entity(leaver.carryingId) : undefined;
      if (held) world.removeComponent(held, 'carriedBy');
      world.addComponent(leaver, 'removed', true);
    }
    flushRemoved();
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
    coop.onState = null; coop.onEnd = null; coop.onLeave = null;
    sound.onEffect = null; noticeEvents.onNotice = null;
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
    setInputCaptured(false);
    this.ticker.stop();
    this.ticker.destroy();
    this.darkness.destroy();
    this.crosshair.destroy();
    this.tooltip.destroy();
    this.weaponBar.destroy();
    this.app.canvas.style.cursor = '';
    clearSprites();
    this.container.destroy({ children: true });
  }
}
