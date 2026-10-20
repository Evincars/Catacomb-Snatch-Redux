import { assetUrl } from '../assets/assetUrl';
import type { Level } from './Level';
import { createTile, TileType } from './TileType';
import { forEachTile } from './Grid';
import { LoadError, ensure } from '../core/errors';

export async function loadLevelBitmap(path: string): Promise<ImageData> {
  const response = await fetch(encodeURI(assetUrl(path)));
  if (!response.ok) throw new LoadError(`HTTP ${response.status} loading level bitmap ${path}`, { context: { path, status: response.status } });
  const url = URL.createObjectURL(await response.blob());
  try {
    const image = new Image();
    image.src = url;
    await image.decode();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new LoadError(`Cannot decode level bitmap ${path}: canvas unavailable`, { context: { path } });
    ctx.drawImage(image, 0, 0);
    return ctx.getImageData(0, 0, canvas.width, canvas.height);
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** The original marks cracked floor with pure #0000cc. */
function isCrackedFloor(bitmap: ImageData, x: number, y: number): boolean {
  const i = (x + y * bitmap.width) * 4;
  return bitmap.data[i] === 0 && bitmap.data[i + 1] === 0 && bitmap.data[i + 2] === 0xcc;
}

/** Original bitmaps occupy the centred interior of the larger TMX map. */
export function restoreCrackedFloors(level: Level, bitmap: ImageData): void {
  const offsetX = (level.width - bitmap.width) / 2;
  const offsetY = (level.height - bitmap.height) / 2;
  ensure(Number.isInteger(offsetX) && Number.isInteger(offsetY) && offsetX >= 0 && offsetY >= 0,
    'Level bitmap does not fit the TMX map', { offsetX, offsetY });
  forEachTile(0, 0, bitmap.width - 1, bitmap.height - 1, (x, y) => {
    if (!isCrackedFloor(bitmap, x, y)) return;
    const tx = x + offsetX;
    const ty = y + offsetY;
    if (level.getTile(tx, ty)?.type !== TileType.DropTrap) level.setTile(tx, ty, createTile(TileType.DropTrap));
  });
}
