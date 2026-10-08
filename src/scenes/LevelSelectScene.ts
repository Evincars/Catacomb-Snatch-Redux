import { Container, Sprite, Graphics } from 'pixi.js';
import type { Scene, SceneManager } from '../game/SceneManager';
import { PixelButton } from '../ui/PixelButton';
import { makeText, makeTitle } from '../ui/PixelText';
import { getTexture } from '../assets/AssetLoader';
import { LEVELS, gameState } from '../game/GameState';

const GW = 320;
const GH = 240;
const BTN_W = 88;
const BTN_H = 20;
const COLS = 3;
const ROWS = 3;
const LEVELS_PER_PAGE = COLS * ROWS;

export class LevelSelectScene implements Scene {
  container: Container;
  private page = 0;
  private selected = 0;
  private levelButtons: PixelButton[] = [];
  private prevBtn!: PixelButton;
  private nextBtn!: PixelButton;
  private listContainer!: Container;

  constructor(private manager: SceneManager) {
    this.container = new Container();

    // Background
    const bg = new Sprite(getTexture('background'));
    bg.width = GW;
    bg.height = GH;
    this.container.addChild(bg);

    // Title
    const title = makeTitle('Select Level');
    title.x = GW / 2;
    title.y = 14;
    this.container.addChild(title);

    // Level button list area
    this.listContainer = new Container();
    this.listContainer.x = 0;
    this.listContainer.y = 34;
    this.container.addChild(this.listContainer);

    // Bottom nav
    this.prevBtn = new PixelButton('<', 30, 18);
    this.prevBtn.x = 8;
    this.prevBtn.y = GH - 50;
    this.prevBtn.onPress = () => { this.page--; this.rebuild(); };
    this.container.addChild(this.prevBtn);

    this.nextBtn = new PixelButton('>', 30, 18);
    this.nextBtn.x = 46;
    this.nextBtn.y = GH - 50;
    this.nextBtn.onPress = () => { this.page++; this.rebuild(); };
    this.container.addChild(this.nextBtn);

    const startBtn = new PixelButton('Next >', 100, 20);
    startBtn.x = GW - 108;
    startBtn.y = GH - 50;
    startBtn.onPress = () => {
      gameState.selectedLevel = LEVELS[this.selected];
      manager.goto('difficulty_select');
    };
    this.container.addChild(startBtn);

    const backBtn = new PixelButton('< Back', 80, 20);
    backBtn.x = GW - 108 - 88;
    backBtn.y = GH - 50;
    backBtn.onPress = () => manager.goto('title');
    this.container.addChild(backBtn);

    this.selected = LEVELS.indexOf(gameState.selectedLevel);
    if (this.selected < 0) this.selected = 0;
    this.page = Math.floor(this.selected / LEVELS_PER_PAGE);

    this.rebuild();
  }

  private rebuild(): void {
    this.listContainer.removeChildren();
    this.levelButtons = [];

    const startIdx = this.page * LEVELS_PER_PAGE;
    const endIdx = Math.min(startIdx + LEVELS_PER_PAGE, LEVELS.length);

    const xPad = (GW - COLS * (BTN_W + 6)) / 2 + 3;

    for (let i = startIdx; i < endIdx; i++) {
      const levelInfo = LEVELS[i];
      const slot = i - startIdx;
      const col = slot % COLS;
      const row = Math.floor(slot / COLS);

      const btn = new PixelButton(levelInfo.name, BTN_W, BTN_H);
      btn.x = xPad + col * (BTN_W + 6);
      btn.y = row * (BTN_H + 6);

      if (i === this.selected) btn.alpha = 1;

      const capturedI = i;
      btn.onPress = () => {
        this.selected = capturedI;
        this.rebuild();
      };

      // Highlight selected
      if (i === this.selected) {
        const sel = new Graphics();
        sel.rect(-2, -2, BTN_W + 4, BTN_H + 4).stroke({ color: 0xffcc44, width: 1 });
        sel.x = btn.x;
        sel.y = btn.y;
        this.listContainer.addChild(sel);
      }

      this.levelButtons.push(btn);
      this.listContainer.addChild(btn);
    }

    this.prevBtn.setEnabled(this.page > 0);
    this.nextBtn.setEnabled((this.page + 1) * LEVELS_PER_PAGE < LEVELS.length);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
