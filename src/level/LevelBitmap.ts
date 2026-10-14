import { assetUrl } from '../assets/assetUrl';
import type { Level } from './Level';
import { createTile, TileType } from './TileType';

export async function loadLevelBitmap(path: string): Promise<ImageData> {
  const response = await fetch(encodeURI(assetUrl(path)));
  if (!response.ok) throw new Error(`HTTP ${response.status} loading level bitmap ${path}`);
  const url = URL.createObjectURL(await response.blob());
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error(`Cannot decode level bitmap ${path}: canvas unavailable`);
    ctx.drawImage(image, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Original bitmaps occupy the centred interior of the larger TMX map. */
export function restoreCrackedFloors(level: Level, bitmap: ImageData): void {
  const offsetX = (level.width - bitmap.width) / 2;
  const offsetY = (level.height - bitmap.height) / 2;
  if (!Number.isInteger(offsetX) || !Number.isInteger(offsetY) || offsetX < 0 || offsetY < 0) {
    throw new Error('Level bitmap does not fit the TMX map');
  }
  for (let y = 0; y < bitmap.height; y++) {
    for (let x = 0; x < bitmap.width; x++) {
      const i = (x + y * bitmap.width) * 4;
      if (bitmap.data[i] === 0 && bitmap.data[i + 1] === 0 && bitmap.data[i + 2] === 0xcc) {
        const tx = x + offsetX;
        const ty = y + offsetY;
        if (level.getTile(tx, ty)?.type !== TileType.DropTrap) {
          level.setTile(tx, ty, createTile(TileType.DropTrap));
        }
      }
    }
  }
}
