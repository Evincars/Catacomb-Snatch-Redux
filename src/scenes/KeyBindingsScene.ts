import { Container, Sprite } from 'pixi.js';
import { GAME_WIDTH, GAME_HEIGHT } from '../render/Camera';
import type { Scene, SceneManager } from '../game/SceneManager';
import { PixelButton } from '../ui/PixelButton';
import { makeText, makeTitle } from '../ui/PixelText';
import { getTexture } from '../assets/AssetLoader';
import { settings, saveSettings, resetBindings, codeLabel, ACTION_LABELS } from '../game/Settings';
import type { ActionName } from '../game/Settings';

/** Laid out in two columns like the original's key bindings screen. */
const LEFT: ActionName[] = ['up', 'down', 'left', 'right', 'sprint'];
const RIGHT: ActionName[] = ['fire', 'build', 'use', 'upgrade'];

const ROW_H = 32;
const BTN_W = 130;
const BTN_H = 24;
const TOP = 90;

export class KeyBindingsScene implements Scene {
  container: Container;

  /** Set while waiting for the next key press to assign. */
  private capturing: ActionName | null = null;
  private buttons = new Map<ActionName, PixelButton>();
  private onKeyDown: (e: KeyboardEvent) => void;

  constructor(manager: SceneManager) {
    this.container = new Container();

    const bg = new Sprite(getTexture('background'));
    bg.width = GAME_WIDTH;
    bg.height = GAME_HEIGHT;
    this.container.addChild(bg);

    const title = makeTitle('Key Bindings');
    title.x = GAME_WIDTH / 2;
    title.y = 36;
    this.container.addChild(title);

    this.buildColumn(LEFT, 40);
    this.buildColumn(RIGHT, GAME_WIDTH / 2 + 18);

    const hint = makeText('Click a binding, then press a key', 0xaaaaaa, 9, 'center');
    hint.x = GAME_WIDTH / 2;
    hint.y = GAME_HEIGHT - 96;
    this.container.addChild(hint);

    const reset = new PixelButton('Reset', 110, 24);
    reset.x = GAME_WIDTH / 2 - 120;
    reset.y = GAME_HEIGHT - 66;
    reset.onPress = () => {
      resetBindings();
      this.capturing = null;
      this.refresh();
    };
    this.container.addChild(reset);

    const back = new PixelButton('Back', 110, 24);
    back.x = GAME_WIDTH / 2 + 10;
    back.y = GAME_HEIGHT - 66;
    back.onPress = () => manager.goto('options');
    this.container.addChild(back);

    this.onKeyDown = (e: KeyboardEvent) => {
      if (!this.capturing) return;
      e.preventDefault();
      if (e.code !== 'Escape') {
        // Clear the key from any other action so bindings stay unique.
        for (const action of Object.keys(settings.bindings) as ActionName[]) {
          if (action !== this.capturing && settings.bindings[action] === e.code) {
            settings.bindings[action] = '';
          }
        }
        settings.bindings[this.capturing] = e.code;
        saveSettings();
      }
      this.capturing = null;
      this.refresh();
    };
    window.addEventListener('keydown', this.onKeyDown);

    this.refresh();
  }

  private buildColumn(actions: ActionName[], x: number): void {
    actions.forEach((action, i) => {
      const y = TOP + i * ROW_H;

      const label = makeText(`${ACTION_LABELS[action]}:`, 0xffffff, 11, 'right');
      label.x = x + 80;
      label.y = y + 6;
      this.container.addChild(label);

      const btn = new PixelButton('', BTN_W, BTN_H);
      btn.x = x + 92;
      btn.y = y;
      btn.onPress = () => {
        this.capturing = action;
        this.refresh();
      };
      this.container.addChild(btn);
      this.buttons.set(action, btn);
    });
  }

  private refresh(): void {
    for (const [action, btn] of this.buttons) {
      btn.setText(this.capturing === action ? '...' : codeLabel(settings.bindings[action]));
    }
  }

  destroy(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    this.container.destroy({ children: true });
  }
}
