import { Container, Sprite, Graphics, Texture } from 'pixi.js';
import type { Entity } from '../world';
import { world } from '../world';
import type { Level } from '../level/Level';
import { TILE_WIDTH, TILE_HEIGHT } from '../level/TileType';
import { getTexture } from '../assets/AssetLoader';
import { frameTexture } from '../render/Sheets';
import { makeText } from './PixelText';
import { PixelLabel } from './PixelText';
import { GAME_WIDTH, GAME_HEIGHT, camera } from '../render/Camera';
import { treasureShare } from '../game/MatchRules';
import { characterName, gameState, isVersus } from '../game/GameState';
import type { CharacterType } from '../entities/PlayerFactory';
import { forEachTile } from '../level/Grid';

const slotted = world.with('playerSlot');
const onMinimap = world.with('position', 'minimapColor');

const PANEL_TOP = GAME_HEIGHT - 80;
/** The bars are 101-frame strips, frame 0 full and frame 100 empty. */
const BAR_FRAMES = 100;
const MINIMAP_SIZE = 64;
const MINIMAP_X = 429;
const MINIMAP_Y = PANEL_TOP + 5;

/** Positions mirror the Java panel layout, offset from the bottom of the screen. */
export class HudPanel {
  readonly container = new Container();

  private healthBar = new Sprite();
  private xpBar = new Sprite();
  private healthText!: PixelLabel;
  private levelText!: PixelLabel;
  private coinText!: PixelLabel;
  private scoreText!: PixelLabel;
  /** Versus: the other side's name and progress (left), and this side's (right), with portraits. */
  private rivalText!: PixelLabel;
  private teamText!: PixelLabel;
  private rivalFace = new Sprite();
  private teamFace = new Sprite();
  private versusShown: boolean | null = null;
  private weaponText!: PixelLabel;
  private promptText!: PixelLabel;
  private hint = '';
  private weaponName = '';
  private noticeText!: PixelLabel;

  private minimap = new Sprite();
  private minimapCanvas: HTMLCanvasElement;
  private minimapCtx: CanvasRenderingContext2D;
  private minimapTexture!: Texture;
  private minimapDirty = 0;

  constructor() {
    const panel = new Sprite(getTexture('panel'));
    panel.x = 0;
    panel.y = PANEL_TOP;
    this.container.addChild(panel);

    // Original right-hand board: coin and count, star and level over the XP bar, heart and health over its bar.
    const icon = (key: string, y: number) => {
      const sprite = new Sprite(getTexture(key));
      sprite.x = 313;
      sprite.y = y;
      this.container.addChild(sprite);
    };
    icon('p_coin', GAME_HEIGHT - 71);
    icon('p_level', GAME_HEIGHT - 54);
    icon('p_heart', GAME_HEIGHT - 31);

    this.coinText = this.label(330, GAME_HEIGHT - 69);
    this.levelText = this.label(330, GAME_HEIGHT - 52);
    this.healthText = this.label(330, GAME_HEIGHT - 29);

    this.xpBar.x = 311;
    this.xpBar.y = GAME_HEIGHT - 39;
    this.healthBar.x = 311;
    this.healthBar.y = GAME_HEIGHT - 16;
    this.container.addChild(this.xpBar, this.healthBar);

    // Team progress toward the target score, bottom-left of the panel.
    this.scoreText = makeText('', 0xffdd44, 10);
    this.scoreText.x = 86;
    this.scoreText.y = GAME_HEIGHT - 24;
    this.container.addChild(this.scoreText);

    this.weaponText = makeText('', 0xdddddd, 8);
    this.weaponText.x = 86;
    this.weaponText.y = GAME_HEIGHT - 42;
    this.container.addChild(this.weaponText);

    // Original versus layout: the rival on the left, your side right-aligned beside your portrait.
    this.rivalFace.x = 19; this.rivalFace.y = GAME_HEIGHT - 42;
    this.teamFace.x = 262; this.teamFace.y = GAME_HEIGHT - 42;
    this.rivalText = makeText('', 0xffdd44, 10);
    this.rivalText.x = 56; this.rivalText.y = GAME_HEIGHT - 35;
    this.teamText = makeText('', 0xffdd44, 10, 'right');
    this.teamText.x = 258; this.teamText.y = GAME_HEIGHT - 21;
    this.container.addChild(this.rivalFace, this.teamFace, this.rivalText, this.teamText);

    // Context prompt sits just above the panel, in the world view.
    this.promptText = new PixelLabel('', { color: 0xffee88, align: 'center', outline: true });
    this.promptText.x = GAME_WIDTH / 2;
    this.promptText.y = PANEL_TOP - 16;
    this.container.addChild(this.promptText);

    this.noticeText = new PixelLabel('', { color: 0xffffff, align: 'center', outline: true });
    this.noticeText.x = GAME_WIDTH / 2;
    this.noticeText.y = 8;
    this.container.addChild(this.noticeText);

    this.minimapCanvas = document.createElement('canvas');
    this.minimapCanvas.width = MINIMAP_SIZE;
    this.minimapCanvas.height = MINIMAP_SIZE;
    this.minimapCtx = this.minimapCanvas.getContext('2d')!;
    this.minimapTexture = Texture.from(this.minimapCanvas);
    this.minimap.texture = this.minimapTexture;
    this.minimap.x = MINIMAP_X;
    this.minimap.y = MINIMAP_Y;
    this.container.addChild(this.minimap);
  }

  private label(x: number, y: number) {
    const t = makeText('', 0xffffff, 9);
    t.x = x;
    t.y = y;
    this.container.addChild(t);
    return t;
  }

  private barFrame(sheet: string, fraction: number): Texture {
    const f = Math.max(0, Math.min(1, fraction));
    // Frame 0 is a full bar, so the index counts *down* as the value drops.
    const index = Math.min(BAR_FRAMES, Math.max(0, BAR_FRAMES - Math.round(f * BAR_FRAMES)));
    return frameTexture(sheet, 0, index);
  }

  /** Name of the item being hovered or reached for; replaces the weapon name while set. */
  setHint(text: string): void {
    this.hint = text;
    this.renderWeaponLabel();
  }

  private renderWeaponLabel(): void {
    this.weaponText.text = (this.hint || this.weaponName).toUpperCase();
    this.weaponText.fill = this.hint ? 0xffd860 : 0xdddddd;
  }

  setPrompt(text: string): void {
    this.promptText.text = text;
  }

  setNotices(lines: string[]): void {
    this.noticeText.text = lines.join('\n');
  }

  update(player: Entity, level: Level): void {
    const health = player.health;
    const stats = player.playerStats;

    if (health) {
      this.healthBar.texture = this.barFrame('panel_healthbar', health.current / health.max);
      this.healthText.text = `${Math.ceil((health.current / health.max) * 100)}%`;
    }

    if (stats) {
      const needed = xpForLevel(stats.level);
      this.xpBar.texture = this.barFrame('panel_xpbar', stats.exp / needed);
      this.levelText.text = `${stats.level}`;
      this.coinText.text = `${stats.score}`;

      const versus = isVersus();
      if (versus !== this.versusShown) this.layoutScores(versus, player);
      if (versus) {
        const pct = (score: number) => treasureShare(score, level);
        const yours = player.team === 2 ? level.player2Score : level.player1Score;
        const rival = player.team === 2 ? level.player1Score : level.player2Score;
        // With company on your side the computers are a team too (one per person): "LORD LARD TEAM".
        const suffix = [...slotted].length > 1 ? ' TEAM' : '';
        this.rivalText.text = `${characterName(rivalCharacter())}${suffix}: ${pct(rival)}%`;
        this.teamText.text = `${characterName(gameState.selectedCharacter)}${suffix}: ${pct(yours)}%`;
      } else {
        const pct = Math.floor((stats.score * 100) / gameState.targetScore);
        this.scoreText.text = `${characterLabel()}${[...slotted].length > 1 ? ' TEAM' : ''}: ${pct}%`;
      }
      this.weaponName = player.weapon?.type ?? '';
      this.renderWeaponLabel();
    }

    // The minimap only changes as the map is explored, so redraw it sparingly.
    if (this.minimapDirty-- <= 0) {
      this.minimapDirty = 15;
      this.drawMinimap(level);
    }
  }

  /** Switches between the single team score line and the two versus lines with portraits. */
  private layoutScores(versus: boolean, player: Entity): void {
    this.versusShown = versus;
    this.scoreText.visible = !versus;
    for (const view of [this.rivalText, this.teamText, this.rivalFace, this.teamFace]) view.visible = versus;
    this.weaponText.x = versus ? 56 : 86;
    this.weaponText.y = versus ? GAME_HEIGHT - 48 : GAME_HEIGHT - 42;
    if (!versus) return;
    this.rivalFace.texture = frameTexture(`${rivalCharacter()}_sheet`, 0, 6);
    this.teamFace.texture = frameTexture(`${gameState.selectedCharacter}_sheet`, 0, 2);
    this.rivalFace.tint = 0xffffff;
    this.teamFace.tint = 0xffffff;
  }

  private drawMinimap(level: Level): void {
    const ctx = this.minimapCtx;
    ctx.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

    // Maps are 64x64, matching the minimap one pixel per tile.
    const sx = MINIMAP_SIZE / level.width;
    const sy = MINIMAP_SIZE / level.height;

    forEachTile(0, 0, level.width - 1, level.height - 1, (tx, ty) => {
      const tile = level.isSeen(tx, ty) ? level.getTile(tx, ty) : null;
      if (!tile) return;
      ctx.fillStyle = tile.passable ? '#c8a050' : '#5a4a38';
      ctx.fillRect(tx * sx, ty * sy, Math.ceil(sx), Math.ceil(sy));
    });

    for (const entity of onMinimap) {
      const p = entity.position!;
      const tx = Math.floor(p.x / TILE_WIDTH);
      const ty = Math.floor(p.y / TILE_HEIGHT);
      if (!level.isSeen(tx, ty)) continue;
      ctx.fillStyle = `#${entity.minimapColor!.toString(16).padStart(6, '0')}`;
      ctx.fillRect(tx * sx, ty * sy, Math.max(1, Math.ceil(sx)), Math.max(1, Math.ceil(sy)));
    }

    // Viewport outline.
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = 1;
    ctx.strokeRect(
      (camera.x / TILE_WIDTH) * sx,
      (camera.y / TILE_HEIGHT) * sy,
      (GAME_WIDTH / TILE_WIDTH) * sx,
      ((GAME_HEIGHT - 80) / TILE_HEIGHT) * sy,
    );

    this.minimapTexture.source.update();
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}

/** Mirrors the original's escalating per-level XP requirement. */
export function xpForLevel(level: number): number {
  return 50 * level;
}

/** Who plays the other side: the computer's character, or the enemy guest's (the same as the host's). */
function rivalCharacter(): CharacterType {
  return gameState.opponent === 'ai' ? gameState.aiCharacter : gameState.selectedCharacter;
}

function characterLabel(): string {
  return gameState.selectedCharacter.replace(/_/g, ' ').toUpperCase();
}
