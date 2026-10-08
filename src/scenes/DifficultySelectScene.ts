import { Container, Sprite, Graphics } from 'pixi.js';
import type { Scene, SceneManager } from '../game/SceneManager';
import { PixelButton } from '../ui/PixelButton';
import { makeText, makeTitle } from '../ui/PixelText';
import { getTexture } from '../assets/AssetLoader';
import { DIFFICULTIES, gameState } from '../game/GameState';

const GW = 320;
const GH = 240;

export class DifficultySelectScene implements Scene {
  container: Container;
  private selected: number;

  constructor(manager: SceneManager) {
    this.container = new Container();
    this.selected = DIFFICULTIES.indexOf(gameState.difficulty);
    if (this.selected < 0) this.selected = 1;

    const bg = new Sprite(getTexture('background'));
    bg.width = GW;
    bg.height = GH;
    this.container.addChild(bg);

    const title = makeTitle('Select Difficulty');
    title.x = GW / 2;
    title.y = 14;
    this.container.addChild(title);

    const descs: Record<string, string> = {
      Easy:      'Relaxed — mobs are weak',
      Normal:    'Balanced experience',
      Hard:      'Tough — mobs regenerate',
      Nightmare: 'Brutal — good luck!',
    };

    const btnW = 130;
    const btnH = 22;
    const startX = (GW - btnW * 2 - 10) / 2;
    const startY = 50;

    DIFFICULTIES.forEach((diff, i) => {
      const col = i % 2;
      const row = Math.floor(i / 2);
      const x = startX + col * (btnW + 10);
      const y = startY + row * (btnH + 30);

      const btn = new PixelButton(diff.name, btnW, btnH);
      btn.x = x;
      btn.y = y;
      btn.onPress = () => {
        this.selected = i;
        gameState.difficulty = DIFFICULTIES[i];
        this.rebuildSelection(selBoxes);
      };
      this.container.addChild(btn);

      const desc = makeText(descs[diff.name] ?? '', 0xaaaaaa, 8, 'center');
      desc.x = x + btnW / 2;
      desc.y = y + btnH + 2;
      this.container.addChild(desc);

      // Selection highlight box placeholder — we'll update them
      const box = new Graphics();
      box.x = x;
      box.y = y;
      this.container.addChild(box);
      selBoxes.push(box);
    });

    const selBoxes: Graphics[] = [];
    this.rebuildSelection(selBoxes);

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

  private rebuildSelection(boxes: Graphics[]): void {
    boxes.forEach((box, i) => {
      box.clear();
      if (i === this.selected) {
        const btnW = 130;
        const btnH = 22;
        box.rect(-2, -2, btnW + 4, btnH + 4).stroke({ color: 0xffcc44, width: 1 });
      }
    });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
