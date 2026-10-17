import { TextureSource } from 'pixi.js';
import { ART_COUNT, loadAllAssets } from './assets/AssetLoader';
import { sound } from './audio/SoundPlayer';
import { settings } from './game/Settings';
import { Game } from './game/Game';

function showFatal(err: unknown): void {
  document.getElementById('loading')?.remove();
  const msg = err instanceof Error ? `${err.message}\n\n${err.stack ?? ''}` : String(err);
  const pre = document.createElement('pre');
  pre.style.cssText = 'color:#f88;font:12px monospace;padding:16px;white-space:pre-wrap';
  pre.textContent = `Catacomb Snatch failed to start:\n\n${msg}`;
  document.body.appendChild(pre);
}

/** Updates the static #loading overlay from index.html. */
function showProgress(fraction: number): void {
  const pct = Math.min(100, Math.floor(fraction * 100));
  const text = document.getElementById('loading-text');
  const fill = document.getElementById('loading-fill');
  if (text) text.textContent = `Loading ${pct}%`;
  if (fill) fill.style.width = `${pct}%`;
}

async function main(): Promise<void> {
  // Everything here is pixel art drawn at 2x; smoothing only blurs it.
  TextureSource.defaultOptions.scaleMode = 'nearest';

  sound.setSfxVolume(settings.sfxVolume);
  sound.setMusicVolume(settings.musicVolume);

  // The menu theme starts as soon as its clip is decoded, behind the loading
  // screen, or on the first gesture if the browser blocks autoplay.
  sound.autoStart();
  sound.startTitleMusic();

  const total = ART_COUNT + sound.clipCount;
  let artDone = 0;
  let clipsDone = 0;
  const report = () => showProgress((artDone + clipsDone) / total);
  report();

  await Promise.all([
    loadAllAssets((fraction) => {
      artDone = fraction * ART_COUNT;
      report();
    }),
    sound.load(() => {
      clipsDone++;
      report();
    }),
  ]);
  showProgress(1);

  const game = new Game();
  await game.init();
  document.getElementById('loading')?.remove();
}

main().catch((err) => {
  console.error(err);
  showFatal(err);
});
