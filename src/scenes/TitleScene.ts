import { Container, Sprite } from 'pixi.js';
import { GAME_WIDTH, GAME_HEIGHT } from '../render/Camera';
import type { Scene } from '../game/SceneManager';
import type { SceneManager } from '../game/SceneManager';
import { PixelButton } from '../ui/PixelButton';
import { makeText } from '../ui/PixelText';
import { getTexture } from '../assets/AssetLoader';
import { gameState } from '../game/GameState';
import { sound } from '../audio/SoundPlayer';
import { coop } from '../network/CoopSession';
import { savedRun } from '../game/SaveStore';

const GW = GAME_WIDTH;
const GH = GAME_HEIGHT;

export class TitleScene implements Scene {
  container: Container;
  private buttons: PixelButton[] = [];

  constructor(manager: SceneManager) {
    coop.close();
    gameState.multiplayerMode = 'companion';
    savedRun.pending = null;
    const url = new URL(location.href);
    if (url.searchParams.has('join')) {
      url.searchParams.delete('join');
      history.replaceState(null, '', url.href);
    }
    this.container = new Container();

    // Title screen background
    const bg = new Sprite(getTexture('titlescreen'));
    bg.width = GW;
    bg.height = GH;
    this.container.addChild(bg);

    sound.startTitleMusic();

    const menuItems: { label: string; action: () => void }[] = [
      { label: 'Start',       action: () => manager.goto('level_select') },
      { label: 'Host multiplayer', action: () => manager.goto('coop_host') },
      { label: 'Join multiplayer', action: () => manager.goto('coop_join') },
      { label: 'Saved games', action: () => manager.goto('saves') },
      { label: 'How To Play', action: () => manager.goto('how_to_play') },
      { label: 'Options',     action: () => manager.goto('options') },
    ];

    const BTN_W = 248;
    const debugLabel = () => `Debug: ${gameState.debug ? 'On' : 'Off'}`;
    const startY = 174;
    menuItems.forEach(({ label, action }, i) => {
      const btn = new PixelButton(label, BTN_W, 24);
      btn.x = (GW - BTN_W) / 2;
      btn.y = startY + i * 27;
      btn.onPress = action;
      this.buttons.push(btn);
      this.container.addChild(btn);
    });

    // Testing aid: start every game with a pile of coins.
    const debug = new PixelButton(debugLabel(), BTN_W, 24);
    debug.x = (GW - BTN_W) / 2;
    debug.y = startY + menuItems.length * 27;
    debug.onPress = () => {
      gameState.debug = !gameState.debug;
      debug.setText(debugLabel());
    };
    this.buttons.push(debug);
    this.container.addChild(debug);

    // Version label
    const ver = makeText('v0.1.0', 0xaaaaaa, 8, 'right');
    ver.x = GW - 4;
    ver.y = GH - 12;
    this.container.addChild(ver);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
