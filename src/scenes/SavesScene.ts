import { Container, Graphics } from 'pixi.js';
import type { Scene, SceneManager } from '../game/SceneManager';
import { deleteSave, readSaves, savedRun, saveMenu, writeSave } from '../game/SaveStore';
import type { SavedGame } from '../game/SaveStore';
import type { WorldState } from '../game/WorldState';
import { makeText, makeTitle } from '../ui/PixelText';
import { PixelButton } from '../ui/PixelButton';
import { coop } from '../network/CoopSession';

export class SavesScene implements Scene {
  container = new Container();
  private page = 0;
  private error = '';
  private disposed = false;
  constructor(private manager: SceneManager, private state?: WorldState) { this.draw(); }
  private attempt(action: () => void): void {
    try { action(); this.error = ''; }
    catch (error) { console.error('Saved games:', error); this.error = error instanceof Error ? error.message : String(error); }
    if (!this.disposed) this.draw();
  }
  private button(label: string, x: number, y: number, width: number, action: () => void): void {
    const b = new PixelButton(label, width, 24);
    b.x = x; b.y = y; b.onPress = action; this.container.addChild(b);
  }
  private draw(): void {
    this.container.removeChildren().forEach(c => c.destroy({ children: true }));
    const background = new Graphics().rect(0, 0, 512, 384).fill(0x241b18);
    background.eventMode = 'static';
    this.container.addChild(background);
    const title = makeTitle(this.state ? 'Save game' : 'Saved games');
    title.x = 256; title.y = 24; this.container.addChild(title);
    let saves: SavedGame[] = [];
    try { saves = readSaves(); }
    catch (error) { console.error('Reading saves:', error); this.error = error instanceof Error ? error.message : String(error); }
    this.page = Math.min(this.page, Math.max(0, Math.ceil(saves.length / 4) - 1));
    saves.slice(this.page * 4, this.page * 4 + 4).forEach((save, i) => {
      const y = 78 + i * 57;
      const label = `${save.name} ${save.coop ? save.state.settings.multiplayerMode === 'enemy' ? '(ENEMY)' : '(CO-OP)' : ''}`;
      const text = makeText(`${label.length > 32 ? label.slice(0, 29) + '...' : label}\n${save.updatedAt.slice(0, 16).replace('T', ' ')}`, 0xffdd88);
      text.x = 24; text.y = y; this.container.addChild(text);
      this.button(this.state ? 'Replace' : 'Load', 305, y, 86, () => this.attempt(() => {
        if (this.state) {
          if (window.confirm(`Overwrite "${save.name}"?`)) writeSave(save.name, this.state, coop.role === 'host', save.id);
        } else {
          savedRun.pending = save;
          if (save.coop) this.manager.goto('coop_host');
          else { coop.close(); this.manager.goto('in_game'); }
        }
      }));
      this.button('Delete', 402, y, 86, () => this.attempt(() => {
        if (window.confirm(`Delete "${save.name}"?`)) deleteSave(save.id);
      }));
    });
    if (!saves.length && !this.error) {
      const empty = makeText('No saves yet.', 0xffdd88); empty.x = 24; empty.y = 80; this.container.addChild(empty);
    }
    if (this.state) this.button('New save', 24, 310, 128, () => this.attempt(() => {
      const name = window.prompt('Save name', 'Catacomb save');
      if (name !== null) writeSave(name, this.state!, coop.role === 'host');
    }));
    this.button('<', 220, 310, 40, () => { this.page = Math.max(0, this.page - 1); this.draw(); });
    this.button('>', 272, 310, 40, () => { if ((this.page + 1) * 4 < saves.length) this.page++; this.draw(); });
    this.button('Back', 360, 310, 128, () => this.manager.back('title'));
    const error = makeText(this.error.slice(0, 58), 0xff8888); error.x = 24; error.y = 354; this.container.addChild(error);
  }
  destroy(): void {
    this.disposed = true;
    if (this.state) saveMenu.state = null;
    this.container.destroy({ children: true });
  }
}
