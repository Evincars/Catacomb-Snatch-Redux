import { Container, Sprite, Graphics, Texture } from 'pixi.js';
import type { Text } from 'pixi.js';
import type { Entity } from '../world';
import { world } from '../world';
import type { Level } from '../level/Level';
import { TILE_WIDTH, TILE_HEIGHT } from '../level/TileType';
import { getTexture } from '../assets/AssetLoader';
import { frameTexture } from '../render/Sheets';
import { makeText } from './PixelText';
import { GAME_WIDTH, GAME_HEIGHT, camera } from '../render/Camera';
import { gameState } from '../game/GameState';

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
  private healthText!: Text;
  private levelText!: Text;
  private expText!: Text;
  private nextText!: Text;
  private coinText!: Text;
  private scoreText!: Text;
  private weaponText!: Text;
  private promptText!: Text;
  private noticeText!: Text;

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

    this.healthBar.x = 311;
    this.healthBar.y = GAME_HEIGHT - 11;
    this.container.addChild(this.healthBar);

    this.xpBar.x = 311;
    this.xpBar.y = GAME_HEIGHT - 29;
    this.container.addChild(this.xpBar);

    const heart = new Sprite(getTexture('p_heart'));
    heart.x = 314; heart.y = GAME_HEIGHT - 25;
    this.container.addChild(heart);

    const coin = new Sprite(getTexture('p_coin'));
    coin.x = 314; coin.y = GAME_HEIGHT - 43;
    this.container.addChild(coin);

    // LVL / EXP / NEXT stack, in the green of the original panel.
    this.addCaption('LVL', GAME_HEIGHT - 74);
    this.addCaption('EXP', GAME_HEIGHT - 64);
    this.addCaption('NEXT', GAME_HEIGHT - 54);

    this.levelText = this.label(360, GAME_HEIGHT - 74);
    this.expText = this.label(360, GAME_HEIGHT - 64);
    this.nextText = this.label(360, GAME_HEIGHT - 54);
    this.coinText = this.label(332, GAME_HEIGHT - 42);
    this.healthText = this.label(332, GAME_HEIGHT - 24);

    // Team progress toward the target score, bottom-left of the panel.
    this.scoreText = makeText('', 0xffdd44, 10);
    this.scoreText.x = 86;
    this.scoreText.y = GAME_HEIGHT - 24;
    this.container.addChild(this.scoreText);

    this.weaponText = makeText('', 0xdddddd, 8);
    this.weaponText.x = 86;
    this.weaponText.y = GAME_HEIGHT - 42;
    this.container.addChild(this.weaponText);

    // Context prompt sits just above the panel, in the world view.
    this.promptText = makeText('', 0xffee88, 9, 'center');
    this.promptText.x = GAME_WIDTH / 2;
    this.promptText.y = PANEL_TOP - 16;
    this.container.addChild(this.promptText);

    this.noticeText = makeText('', 0xffffff, 9, 'center');
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

  private addCaption(text: string, y: number): void {
    const t = makeText(text, 0x66dd44, 9);
    t.x = 314;
    t.y = y;
    this.container.addChild(t);
  }

  private barFrame(sheet: string, fraction: number): Texture {
    const f = Math.max(0, Math.min(1, fraction));
    // Frame 0 is a full bar, so the index counts *down* as the value drops.
    const index = Math.min(BAR_FRAMES, Math.max(0, BAR_FRAMES - Math.round(f * BAR_FRAMES)));
    return frameTexture(sheet, 0, index);
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
      this.expText.text = `${stats.exp}`;
      this.nextText.text = `${Math.max(0, needed - stats.exp)}`;
      this.coinText.text = `${stats.score}`;

      const pct = Math.floor((stats.score * 100) / gameState.targetScore);
      this.scoreText.text = `${characterLabel()}: ${pct}%`;
      this.weaponText.text = (player.weapon?.type ?? '').toUpperCase();
    }

    // The minimap only changes as the map is explored, so redraw it sparingly.
    if (this.minimapDirty-- <= 0) {
      this.minimapDirty = 15;
      this.drawMinimap(level);
    }
  }

  private drawMinimap(level: Level): void {
    const ctx = this.minimapCtx;
    ctx.clearRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, MINIMAP_SIZE, MINIMAP_SIZE);

    // Maps are 64x64, matching the minimap one pixel per tile.
    const sx = MINIMAP_SIZE / level.width;
    const sy = MINIMAP_SIZE / level.height;

    for (let ty = 0; ty < level.height; ty++) {
      for (let tx = 0; tx < level.width; tx++) {
        if (!level.isSeen(tx, ty)) continue;
        const tile = level.getTile(tx, ty);
        if (!tile) continue;
        ctx.fillStyle = tile.passable ? '#c8a050' : '#5a4a38';
        ctx.fillRect(tx * sx, ty * sy, Math.ceil(sx), Math.ceil(sy));
      }
    }

    for (const entity of world.with('position', 'minimapColor')) {
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

function characterLabel(): string {
  return gameState.selectedCharacter.replace(/_/g, ' ').toUpperCase();
}
