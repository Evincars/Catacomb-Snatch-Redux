import { Container, Graphics } from 'pixi.js';
import type { Scene, SceneManager } from '../game/SceneManager';
import { PixelButton } from '../ui/PixelButton';
import { makeTitle, makeText } from '../ui/PixelText';

const GW = 320;
const GH = 240;

export class PauseScene implements Scene {
  container: Container;

  constructor(manager: SceneManager) {
    this.container = new Container();

    // Semi-transparent dark overlay
    const overlay = new Graphics();
    overlay.rect(0, 0, GW, GH).fill({ color: 0x000000, alpha: 0.65 });
    this.container.addChild(overlay);

    // Panel
    const panelW = 160;
    const panelH = 120;
    const panelX = (GW - panelW) / 2;
    const panelY = (GH - panelH) / 2;
    const panel = new Graphics();
    panel.rect(panelX, panelY, panelW, panelH).fill(0x2a1a0a);
    panel.rect(panelX, panelY, panelW, panelH).stroke({ color: 0x8b6230, width: 2 });
    this.container.addChild(panel);

    const title = makeTitle('Paused');
    title.x = GW / 2;
    title.y = panelY + 14;
    this.container.addChild(title);

    const resumeBtn = new PixelButton('Resume', 120, 22);
    resumeBtn.x = (GW - 120) / 2;
    resumeBtn.y = panelY + 44;
    resumeBtn.onPress = () => manager.goto('in_game');
    this.container.addChild(resumeBtn);

    const quitBtn = new PixelButton('Quit to Menu', 120, 22);
    quitBtn.x = (GW - 120) / 2;
    quitBtn.y = panelY + 74;
    quitBtn.onPress = () => manager.goto('title');
    this.container.addChild(quitBtn);

    // ESC also resumes
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Escape') manager.goto('in_game');
    };
    window.addEventListener('keydown', onKeyDown);
    this.container.on('destroyed', () => window.removeEventListener('keydown', onKeyDown));
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
