import { loadAllAssets } from './assets/AssetLoader';
import { sound } from './audio/SoundPlayer';
import { Game } from './game/Game';

function showFatal(err: unknown): void {
  const msg = err instanceof Error ? `${err.message}\n\n${err.stack ?? ''}` : String(err);
  const pre = document.createElement('pre');
  pre.style.cssText = 'color:#f88;font:12px monospace;padding:16px;white-space:pre-wrap';
  pre.textContent = `Catacomb Snatch failed to start:\n\n${msg}`;
  document.body.appendChild(pre);
}

async function main(): Promise<void> {
  // Art must be ready before the first scene draws; audio can finish in the
  // background since playback is gated on a user gesture anyway.
  await loadAllAssets();
  void sound.load();

  const game = new Game();
  await game.init();
}

main().catch((err) => {
  console.error(err);
  showFatal(err);
});
