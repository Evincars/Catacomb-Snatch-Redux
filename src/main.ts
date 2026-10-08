import { loadAllAssets } from './assets/AssetLoader';
import { Game } from './game/Game';

async function main(): Promise<void> {
  await loadAllAssets();
  const game = new Game();
  await game.init();
}

main().catch(console.error);
