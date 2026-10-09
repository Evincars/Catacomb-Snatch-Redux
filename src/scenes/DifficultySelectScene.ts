import { Container, Sprite, Graphics } from 'pixi.js';
import type { Scene, SceneManager } from '../game/SceneManager';
import { PixelButton } from '../ui/PixelButton';
import { makeText, makeTitle } from '../ui/PixelText';
import { getTexture } from '../assets/AssetLoader';
import { DIFFICULTIES, gameState } from '../game/GameState';

const GW = 320;
const GH = 240;
const BTN_W = 130;
const BTN_H = 22;

const DESCRIPTIONS: Record<string, string> = {
  Easy:      'Relaxed — mobs are weak',
  Normal:    'Balanced experience',
  Hard:      'Tough — mobs regenerate',
  Nightmare: 'Brutal — good luck!',
};

export class DifficultySelectScene implements Scene {
  container: Container;
  private selected: number;
  private selBoxes: Graphics[] = [];

  constructor(manager: SceneManager) {
    this.container = new Container();
    this.selected = Math.max(0, DIFFICULTIES.indexOf(gameState.difficulty));

    const bg = new Sprite(getTexture('background'));
    bg.width = GW;
    bg.height = GH;
    this.container.addChild(bg);

    const title = makeTitle('Select Difficulty');
    title.x = GW / 2;
    title.y = 14;
    this.container.addChild(title);

    const startX = (GW - BTN_W * 2 - 10) / 2;
    const startY = 50;

    DIFFICULTIES.forEach((diff, i) => {
      const x = startX + (i % 2) * (BTN_W + 10);
      const y = startY + Math.floor(i / 2) * (BTN_H + 30);

      const btn = new PixelButton(diff.name, BTN_W, BTN_H);
      btn.x = x;
      btn.y = y;
      btn.onPress = () => {
        this.selected = i;
        gameState.difficulty = DIFFICULTIES[i];
        this.updateSelection();
      };
      this.container.addChild(btn);

      const desc = makeText(DESCRIPTIONS[diff.name] ?? '', 0xaaaaaa, 8, 'center');
      desc.x = x + BTN_W / 2;
      desc.y = y + BTN_H + 2;
      this.container.addChild(desc);

      const box = new Graphics();
      box.x = x;
      box.y = y;
      this.container.addChild(box);
      this.selBoxes.push(box);
    });

    this.updateSelection();

    const startBtn = new PixelButton('Next >', 100, 20);
    startBtn.x = GW - 108;
    startBtn.y = GH - 40;
    startBtn.onPress = () => {
      gameState.difficulty = DIFFICULTIES[this.selected];
      manager.goto('character_select');
    };
    this.container.addChild(startBtn);

    const backBtn = new PixelButton('< Back', 80, 20);
    backBtn.x = GW - 108 - 88;
    backBtn.y = GH - 40;
    backBtn.onPress = () => manager.goto('level_select');
    this.container.addChild(backBtn);
  }

  private updateSelection(): void {
    this.selBoxes.forEach((box, i) => {
      box.clear();
      if (i === this.selected) {
        box.rect(-2, -2, BTN_W + 4, BTN_H + 4).stroke({ color: 0xffcc44, width: 1 });
      }
    });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
