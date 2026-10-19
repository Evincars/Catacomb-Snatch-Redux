import { Container, Sprite } from 'pixi.js';
import { GAME_WIDTH, GAME_HEIGHT } from '../render/Camera';
import type { Scene, SceneManager } from '../game/SceneManager';
import { PixelButton } from '../ui/PixelButton';
import { PixelCheckbox } from '../ui/PixelCheckbox';
import { PixelSlider } from '../ui/PixelSlider';
import { makeText, makeTitle } from '../ui/PixelText';
import { NameField } from '../ui/NameField';
import { getTexture } from '../assets/AssetLoader';
import { settings, saveSettings } from '../game/Settings';
import { sound } from '../audio/SoundPlayer';

const COL_X = 146;
const ROW_H = 38;

export class OptionsScene implements Scene {
  container: Container;
  private nameField: NameField;

  constructor(manager: SceneManager) {
    this.container = new Container();

    const bg = new Sprite(getTexture('background'));
    bg.width = GAME_WIDTH;
    bg.height = GAME_HEIGHT;
    this.container.addChild(bg);

    const title = makeTitle('Options');
    title.x = GAME_WIDTH / 2;
    title.y = 40;
    this.container.addChild(title);

    let y = 86;

    const bindings = new PixelButton('Key Bindings', 240, 26);
    bindings.x = COL_X;
    bindings.y = y;
    bindings.onPress = () => manager.open('key_bindings');
    this.container.addChild(bindings);
    y += ROW_H;

    const fullscreen = new PixelCheckbox('Fullscreen', settings.fullscreen);
    fullscreen.x = COL_X;
    fullscreen.y = y;
    fullscreen.onToggle = (on) => {
      settings.fullscreen = on;
      saveSettings();
      // Fullscreen requests are only honoured from a user gesture, which this is.
      if (on) void document.documentElement.requestFullscreen?.().catch(() => {});
      else void document.exitFullscreen?.().catch(() => {});
    };
    this.container.addChild(fullscreen);
    y += ROW_H;

    const showFps = new PixelCheckbox('Show FPS', settings.showFps);
    showFps.x = COL_X;
    showFps.y = y;
    showFps.onToggle = (on) => {
      settings.showFps = on;
      saveSettings();
    };
    this.container.addChild(showFps);
    y += ROW_H;

    const volume = new PixelSlider('Volume', settings.sfxVolume);
    volume.x = COL_X;
    volume.y = y;
    volume.onChange = (v) => {
      settings.sfxVolume = v;
      sound.setSfxVolume(v);
      saveSettings();
    };
    this.container.addChild(volume);
    y += ROW_H;

    const music = new PixelSlider('Music', settings.musicVolume);
    music.x = COL_X;
    music.y = y;
    music.onChange = (v) => {
      settings.musicVolume = v;
      sound.setMusicVolume(v);
      saveSettings();
    };
    this.container.addChild(music);
    y += ROW_H - 4;

    // The name other players see above this character in multiplayer.
    const nameLabel = makeText('Multiplayer name', 0xffdd88, 8, 'center');
    nameLabel.x = GAME_WIDTH / 2;
    nameLabel.y = y;
    this.container.addChild(nameLabel);
    this.nameField = new NameField(manager.application.canvas as HTMLCanvasElement, COL_X, y + 12, 240, 22);

    const back = new PixelButton('Back', 240, 26);
    back.x = COL_X;
    back.y = GAME_HEIGHT - 60;
    back.onPress = () => manager.back('title');
    this.container.addChild(back);
  }

  destroy(): void {
    this.nameField.destroy();
    this.container.destroy({ children: true });
  }
}
