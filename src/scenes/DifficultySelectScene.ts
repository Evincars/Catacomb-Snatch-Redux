import { Container, Sprite, Graphics } from 'pixi.js';
import { GAME_WIDTH, GAME_HEIGHT } from '../render/Camera';
import type { Scene, SceneManager } from '../game/SceneManager';
import { PixelButton } from '../ui/PixelButton';
import { makeText, makeTitle } from '../ui/PixelText';
import { getTexture } from '../assets/AssetLoader';
import { AI_DIFFICULTIES, DIFFICULTIES, gameState } from '../game/GameState';
import { saveSettings, settings } from '../game/Settings';

const GW = GAME_WIDTH;
const GH = GAME_HEIGHT;
const BTN_W = 200;
const BTN_H = 30;

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
    title.y = 34;
    this.container.addChild(title);

    const startX = (GW - BTN_W * 2 - 20) / 2;
    const startY = 96;

    DIFFICULTIES.forEach((diff, i) => {
      const x = startX + (i % 2) * (BTN_W + 20);
      const y = startY + Math.floor(i / 2) * (BTN_H + 48);

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
      desc.y = y + BTN_H + 6;
      this.container.addChild(desc);

      const box = new Graphics();
      box.x = x;
      box.y = y;
      this.container.addChild(box);
      this.selBoxes.push(box);
    });

    this.updateSelection();
    this.addOpponentChoice(startX, startY + 2 * (BTN_H + 48));

    const startBtn = new PixelButton('Next >', 140, 28);
    startBtn.x = GW - 160;
    startBtn.y = GH - 56;
    startBtn.onPress = () => {
      gameState.difficulty = DIFFICULTIES[this.selected];
      manager.goto('character_select');
    };
    this.container.addChild(startBtn);

    const backBtn = new PixelButton('< Back', 120, 28);
    backBtn.x = GW - 160 - 130;
    backBtn.y = GH - 56;
    backBtn.onPress = () => manager.goto('level_select');
    this.container.addChild(backBtn);
  }

  /** Whether a computer opponent takes the second base, and how well it plays. */
  private addOpponentChoice(x: number, y: number): void {
    // An enemy guest already holds the second base.
    const allowed = gameState.multiplayerMode !== 'enemy';

    const opponent = new PixelButton('', BTN_W, BTN_H);
    opponent.x = x;
    opponent.y = y;
    const level = new PixelButton('', BTN_W, BTN_H);
    level.x = x + BTN_W + 20;
    level.y = y;
    const desc = makeText('', 0xaaaaaa, 8, 'center');
    desc.x = GW / 2;
    desc.y = y + BTN_H + 6;

    const refresh = () => {
      settings.opponent = gameState.opponentChoice;
      settings.aiDifficulty = gameState.aiDifficulty.name;
      saveSettings();
      const ai = allowed && gameState.opponentChoice === 'ai';
      opponent.setText(`Opponent: ${ai ? 'AI' : 'None'}`);
      level.setText(`AI: ${gameState.aiDifficulty.name}`);
      level.setEnabled(allowed);
      level.alpha = ai ? 1 : 0.6;
      desc.text = !allowed ? 'The enemy guest is your opponent'
        : ai ? 'The computer races you to fill its treasury first' : 'Collect coins with no rival base';
    };
    opponent.onPress = () => {
      gameState.opponentChoice = gameState.opponentChoice === 'ai' ? 'none' : 'ai';
      refresh();
    };
    level.onPress = () => {
      // Pressing the AI level while no opponent is chosen means "play the AI".
      if (gameState.opponentChoice !== 'ai') {
        gameState.opponentChoice = 'ai';
      } else {
        const i = AI_DIFFICULTIES.indexOf(gameState.aiDifficulty);
        gameState.aiDifficulty = AI_DIFFICULTIES[(i + 1) % AI_DIFFICULTIES.length];
      }
      refresh();
    };
    opponent.setEnabled(allowed);
    refresh();
    this.container.addChild(opponent, level, desc);
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
