import { Container, Sprite, Graphics } from 'pixi.js';
import type { Scene, SceneManager } from '../game/SceneManager';
import { PixelButton } from '../ui/PixelButton';
import { makeText, makeTitle } from '../ui/PixelText';
import { getTexture } from '../assets/AssetLoader';
import { gameState } from '../game/GameState';

const GW = 320;
const GH = 240;

export class GameOverScene implements Scene {
  container: Container;

  constructor(manager: SceneManager) {
    this.container = new Container();

    // Background — use game_over texture if available, else black
    try {
      const bg = new Sprite(getTexture('game_over'));
      bg.width = GW;
      bg.height = GH;
      this.container.addChild(bg);
    } catch {
      const bg = new Graphics();
      bg.rect(0, 0, GW, GH).fill(0x0a0a0a);
      this.container.addChild(bg);
    }

    const title = makeTitle('Game Over');
    title.x = GW / 2;
    title.y = 60;
    this.container.addChild(title);

    const winnerLabel = gameState.winningTeam === 1
      ? 'Player 1 Wins!'
      : gameState.winningTeam === 2
        ? 'Player 2 Wins!'
        : 'No Winner';

    const winner = makeText(winnerLabel, 0xffdd44, 12, 'center');
    winner.x = GW / 2;
    winner.y = 100;
    this.container.addChild(winner);

    const okBtn = new PixelButton('Main Menu', 120, 22);
    okBtn.x = (GW - 120) / 2;
    okBtn.y = GH - 60;
    okBtn.onPress = () => manager.goto('title');
    this.container.addChild(okBtn);

    const retryBtn = new PixelButton('Play Again', 120, 22);
    retryBtn.x = (GW - 120) / 2;
    retryBtn.y = GH - 88;
    retryBtn.onPress = () => manager.goto('in_game');
    this.container.addChild(retryBtn);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
