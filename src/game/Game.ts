import { Application } from 'pixi.js';
import { SceneManager } from './SceneManager';
import { TitleScene } from '../scenes/TitleScene';
import { LevelSelectScene } from '../scenes/LevelSelectScene';
import { DifficultySelectScene } from '../scenes/DifficultySelectScene';
import { CharacterSelectScene } from '../scenes/CharacterSelectScene';
import { InGameScene } from '../scenes/InGameScene';
import { PauseScene } from '../scenes/PauseScene';
import { GameOverScene } from '../scenes/GameOverScene';

const GAME_WIDTH = 320;
const GAME_HEIGHT = 240;
const SCALE = 3;

export class Game {
  private app: Application;
  private manager!: SceneManager;

  constructor() {
    this.app = new Application();
  }

  async init(): Promise<void> {
    await this.app.init({
      width: GAME_WIDTH * SCALE,
      height: GAME_HEIGHT * SCALE,
      backgroundColor: 0x000000,
      antialias: false,
    });

    document.body.appendChild(this.app.canvas);

    // Scale stage for pixel-art look
    this.app.stage.scale.set(SCALE);

    this.manager = new SceneManager(this.app);

    this.manager
      .register('title',            (m) => new TitleScene(m))
      .register('level_select',     (m) => new LevelSelectScene(m))
      .register('difficulty_select',(m) => new DifficultySelectScene(m))
      .register('character_select', (m) => new CharacterSelectScene(m))
      .register('in_game',          (m) => new InGameScene(m))
      .register('pause',            (m) => new PauseScene(m))
      .register('game_over',        (m) => new GameOverScene(m));

    this.manager.goto('title');
  }
}
