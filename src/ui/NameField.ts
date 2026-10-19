import { GAME_WIDTH, GAME_HEIGHT } from '../render/Camera';
import { NAME_MAX, cleanName, saveSettings, settings } from '../game/Settings';
import { coop } from '../network/CoopSession';

/**
 * A text box laid over the canvas for the player's name. Whatever is typed is
 * cleaned, saved to the settings and handed to the room, if there is one.
 */
export class NameField {
  readonly element = document.createElement('input');
  private readonly place: () => void;

  /** `x`, `y`, `width` and `height` are in game pixels (the 512x384 surface). */
  constructor(private canvas: HTMLCanvasElement, x: number, y: number, width: number, height: number) {
    const input = this.element;
    input.type = 'text';
    input.maxLength = NAME_MAX;
    input.value = settings.playerName;
    input.placeholder = 'Your name';
    input.autocomplete = 'off';
    input.spellcheck = false;
    input.setAttribute('aria-label', 'Your player name');
    input.style.cssText = 'position:fixed;box-sizing:border-box;padding:0 8px;background:#241b18;color:#fff;'
      + 'border:1px solid #d9a454;text-align:center;font-family:monospace;z-index:10';
    input.addEventListener('change', () => this.commit());
    input.addEventListener('keydown', event => {
      if (event.code !== 'Escape') event.stopPropagation();
      if (event.code === 'Enter') input.blur();
    });
    this.place = () => {
      const rect = this.canvas.getBoundingClientRect();
      const sx = rect.width / GAME_WIDTH;
      const sy = rect.height / GAME_HEIGHT;
      input.style.left = `${rect.left + x * sx}px`;
      input.style.top = `${rect.top + y * sy}px`;
      input.style.width = `${width * sx}px`;
      input.style.height = `${height * sy}px`;
      input.style.fontSize = `${Math.max(10, 11 * sy)}px`;
    };
    document.body.appendChild(input);
    window.addEventListener('resize', this.place);
    this.place();
  }

  set visible(on: boolean) {
    this.element.style.display = on ? '' : 'none';
    if (on) this.place();
  }

  /** Cleans, stores and shares the typed name. */
  commit(): void {
    const name = cleanName(this.element.value);
    this.element.value = name;
    if (name === settings.playerName) return;
    settings.playerName = name;
    saveSettings();
    coop.setName(name);
  }

  destroy(): void {
    this.commit();
    window.removeEventListener('resize', this.place);
    this.element.remove();
  }
}
