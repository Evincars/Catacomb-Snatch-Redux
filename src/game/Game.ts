import { Application } from 'pixi.js';
import { SceneManager } from './SceneManager';
import { TitleScene } from '../scenes/TitleScene';
import { LevelSelectScene } from '../scenes/LevelSelectScene';
import { DifficultySelectScene } from '../scenes/DifficultySelectScene';
import { CharacterSelectScene } from '../scenes/CharacterSelectScene';
import { InGameScene } from '../scenes/InGameScene';
import { GameOverScene } from '../scenes/GameOverScene';
import { OptionsScene } from '../scenes/OptionsScene';
import { KeyBindingsScene } from '../scenes/KeyBindingsScene';
import { HowToPlayScene } from '../scenes/HowToPlayScene';
import { GAME_WIDTH, GAME_HEIGHT, SCALE } from '../render/Camera';
import { sound } from '../audio/SoundPlayer';

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
      roundPixels: true,
    });

    document.body.appendChild(this.app.canvas);
    this.app.stage.scale.set(SCALE);

    // Browsers only allow audio to start from a user gesture.
    const unlock = () => sound.unlock();
    this.app.canvas.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);

    this.manager = new SceneManager(this.app);
    this.manager
      .register('title',             (m) => new TitleScene(m))
      .register('level_select',      (m) => new LevelSelectScene(m))
      .register('difficulty_select', (m) => new DifficultySelectScene(m))
      .register('character_select',  (m) => new CharacterSelectScene(m))
      .register('in_game',           (m) => new InGameScene(m))
      .register('game_over',         (m) => new GameOverScene(m))
      .register('options',           (m) => new OptionsScene(m))
      .register('key_bindings',      (m) => new KeyBindingsScene(m))
      .register('how_to_play',       (m) => new HowToPlayScene(m));

    this.manager.goto('title');
  }
}
