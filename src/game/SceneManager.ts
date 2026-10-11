import type { Application, Container } from 'pixi.js';

export type SceneName =
  | 'title'
  | 'level_select'
  | 'difficulty_select'
  | 'character_select'
  | 'in_game'
  | 'game_over'
  | 'options'
  | 'key_bindings'
  | 'how_to_play';

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
  /** Scenes stacked above the current one, such as settings opened from the pause menu. */
  private overlays: Scene[] = [];

  constructor(app: Application) {
    this.app = app;
  }

  register(name: SceneName, factory: SceneFactory): this {
    this.factories.set(name, factory);
    return this;
  }

  goto(name: SceneName): void {
    const factory = this.factories.get(name);
    if (!factory) throw new Error(`Scene not registered: ${name}`);

    // Build the next scene first: if its constructor throws, the current one
    // stays on screen instead of leaving the stage blank.
    const next = factory(this);

    while (this.hasOverlay) this.popOverlay();

    if (this.current) {
      this.app.stage.removeChild(this.current.container);
      this.current.destroy();
    }

    this.current = next;
    this.currentName = name;
    this.app.stage.addChild(next.container);
  }

  /** Shows a scene on top of the current one without tearing the current one down. */
  pushOverlay(name: SceneName): void {
    const factory = this.factories.get(name);
    if (!factory) throw new Error(`Scene not registered: ${name}`);
    const scene = factory(this);
    this.overlays.push(scene);
    this.app.stage.addChild(scene.container);
  }

  popOverlay(): void {
    const scene = this.overlays.pop();
    if (!scene) return;
    this.app.stage.removeChild(scene.container);
    scene.destroy();
  }

  get hasOverlay(): boolean {
    return this.overlays.length > 0;
  }

  /** Opens a sub-screen: stacked on top while an overlay is open, otherwise a normal scene change. */
  open(name: SceneName): void {
    if (this.hasOverlay) this.pushOverlay(name);
    else this.goto(name);
  }

  /** Leaves a sub-screen, returning to what is underneath or to `fallback` outside an overlay. */
  back(fallback: SceneName): void {
    if (this.hasOverlay) this.popOverlay();
    else this.goto(fallback);
  }

  get currentScene(): SceneName | null {
    return this.currentName;
  }

  get application(): Application {
    return this.app;
  }
}
