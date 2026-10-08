import type { Application, Container } from 'pixi.js';

export type SceneName =
  | 'title'
  | 'level_select'
  | 'difficulty_select'
  | 'character_select'
  | 'in_game'
  | 'pause'
  | 'game_over';

export type SceneFactory = (manager: SceneManager) => Scene;

export interface Scene {
  container: Container;
  destroy(): void;
}

export class SceneManager {
  private app: Application;
  private factories = new Map<SceneName, SceneFactory>();
  private current: Scene | null = null;
  private currentName: SceneName | null = null;

  constructor(app: Application) {
    this.app = app;
  }

  register(name: SceneName, factory: SceneFactory): this {
    this.factories.set(name, factory);
    return this;
  }

  goto(name: SceneName): void {
    if (this.current) {
      this.app.stage.removeChild(this.current.container);
      this.current.destroy();
    }

    const factory = this.factories.get(name);
    if (!factory) throw new Error(`Scene not registered: ${name}`);

    this.current = factory(this);
    this.currentName = name;
    this.app.stage.addChild(this.current.container);
  }

  get currentScene(): SceneName | null {
    return this.currentName;
  }

  get application(): Application {
    return this.app;
  }
}
