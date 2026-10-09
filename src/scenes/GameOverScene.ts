import { Container, Sprite, Graphics } from 'pixi.js';
import { GAME_WIDTH, GAME_HEIGHT } from '../render/Camera';
import type { Scene, SceneManager } from '../game/SceneManager';
import { PixelButton } from '../ui/PixelButton';
import { makeText, makeTitle } from '../ui/PixelText';
import { getTexture } from '../assets/AssetLoader';
import { gameState } from '../game/GameState';
import { sound } from '../audio/SoundPlayer';

const GW = GAME_WIDTH;
const GH = GAME_HEIGHT;

export class GameOverScene implements Scene {
  container: Container;

  constructor(manager: SceneManager) {
    this.container = new Container();

    const backdrop = new Graphics();
    backdrop.rect(0, 0, GW, GH).fill(0x0a0a0a);
    this.container.addChild(backdrop);

    const bg = new Sprite(getTexture('game_over'));
    bg.width = GW;
    bg.height = GH;
    this.container.addChild(bg);

    sound.startEndMusic();

    const title = makeTitle('Game Over');
    title.x = GW / 2;
    title.y = 100;
    this.container.addChild(title);

    const winnerLabel = gameState.winningTeam === 1
      ? 'Player 1 Wins!'
      : gameState.winningTeam === 2
        ? 'Player 2 Wins!'
        : 'No Winner';

    const winner = makeText(winnerLabel, 0xffdd44, 12, 'center');
    winner.x = GW / 2;
    winner.y = 150;
    this.container.addChild(winner);

    const okBtn = new PixelButton('Main Menu', 200, 28);
    okBtn.x = (GW - 200) / 2;
    okBtn.y = GH - 70;
    okBtn.onPress = () => manager.goto('title');
    this.container.addChild(okBtn);

    const retryBtn = new PixelButton('Play Again', 200, 28);
    retryBtn.x = (GW - 200) / 2;
    retryBtn.y = GH - 112;
    retryBtn.onPress = () => manager.goto('in_game');
    this.container.addChild(retryBtn);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
