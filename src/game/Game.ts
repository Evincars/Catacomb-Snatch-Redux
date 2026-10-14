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
import { CoopScene } from '../scenes/CoopScene';
import { SavesScene } from '../scenes/SavesScene';
import { saveMenu } from './SaveStore';

export class Game {
  private app: Application;
  private manager!: SceneManager;

  constructor() {
    this.app = new Application();
  }

  async init(): Promise<void> {
    await this.app.init({
      width: GAME_WIDTH,
      height: GAME_HEIGHT,
      // Keep world transforms in logical pixels; tilemap must not scale the stage again.
      resolution: SCALE,
      backgroundColor: 0x000000,
      antialias: false,
      roundPixels: true,
    });

    document.body.appendChild(this.app.canvas);

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
    this.manager
      .register('coop_host', m => new CoopScene(m, 'host'))
      .register('coop_join', m => new CoopScene(m, 'guest', new URL(location.href).searchParams.get('join') ?? undefined))
      .register('saves', m => new SavesScene(m))
      .register('save_game', m => new SavesScene(m, saveMenu.state ?? undefined));

    this.manager.goto(new URL(location.href).searchParams.has('join') ? 'coop_join' : 'title');
  }
}
