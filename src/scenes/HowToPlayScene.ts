import { Container, Sprite } from 'pixi.js';
import { GAME_WIDTH, GAME_HEIGHT } from '../render/Camera';
import type { Scene, SceneManager } from '../game/SceneManager';
import { PixelButton } from '../ui/PixelButton';
import { makeText, makeTitle } from '../ui/PixelText';
import { getTexture } from '../assets/AssetLoader';
import { keyLabel } from '../game/Settings';

export class HowToPlayScene implements Scene {
  container: Container;

  constructor(manager: SceneManager) {
    this.container = new Container();

    const bg = new Sprite(getTexture('background'));
    bg.width = GAME_WIDTH;
    bg.height = GAME_HEIGHT;
    this.container.addChild(bg);

    const title = makeTitle('How To Play');
    title.x = GAME_WIDTH / 2;
    title.y = 36;
    this.container.addChild(title);

    const lines = [
      `${keyLabel('up')}/${keyLabel('left')}/${keyLabel('down')}/${keyLabel('right')} — move`,
      `Hold ${keyLabel('sprint')} — sprint (drains the blue bar)`,
      'Mouse — aim    Left click — shoot',
      `${keyLabel('use')} — buy at your base, pick up and place buildings`,
      '',
      'Collect coins dropped by enemies.',
      'Spend them at your base on turrets, harvesters and bombs.',
      'Reach the target score to win.',
      '',
      'ESC — pause',
    ];

    const body = makeText(lines.join('\n'), 0xdddddd, 11, 'center');
    body.x = GAME_WIDTH / 2;
    body.y = 90;
    this.container.addChild(body);

    const back = new PixelButton('Back', 200, 26);
    back.x = (GAME_WIDTH - 200) / 2;
    back.y = GAME_HEIGHT - 60;
    back.onPress = () => manager.goto('title');
    this.container.addChild(back);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
