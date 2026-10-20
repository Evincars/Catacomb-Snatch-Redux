import { Container, Sprite, Texture } from 'pixi.js';
import { GAME_WIDTH, GAME_HEIGHT } from '../render/Camera';
import type { Scene, SceneManager } from '../game/SceneManager';
import { PixelButton } from '../ui/PixelButton';
import { makeText } from '../ui/PixelText';
import { getTexture } from '../assets/AssetLoader';
import { frameTexture } from '../render/Sheets';
import { loadLevelBitmap } from '../level/LevelBitmap';
import { LEVELS, gameState } from '../game/GameState';
import type { LevelInfo } from '../game/GameState';
import { report } from '../core/errors';

const GW = GAME_WIDTH;
const GH = GAME_HEIGHT;

const COLS = 3;
const CELL_W = 140;
const CELL_H = 84;
const CELL_GAP_X = 8;
const CELL_GAP_Y = 8;
const GRID_X = 39;
const GRID_Y = 50;

/** Level bitmaps are 48x48; the picker draws each inside a sand frame. */
const MAP_SIZE = 48;
const FRAME_PAD = 8;
const PREVIEW_SIZE = MAP_SIZE + FRAME_PAD * 2;

const FRAME_COLOR = '#e0a54f';
const FRAME_TAB_COLOR = '#f1c070';
const FRAME_TAB_EDGE = '#8a6330';

type Rgb = [number, number, number];

const FLOOR_COLOR: Rgb = [0x6e, 0x5c, 0x50];
const WALL_COLOR: Rgb = [0xb5, 0x85, 0x45];
const SAND_COLOR: Rgb = [0x8d, 0x6c, 0x4f];
const HOLE_COLOR: Rgb = [0x1b, 0x15, 0x11];

/** Cell frames in back_level_button.png. */
const CELL_NORMAL = 0;
const CELL_HOVER = 1;
const CELL_SELECTED = 2;

/** Colours of the level bitmaps: white floor, red walls, black holes, pink in-between. */
function previewColor(r: number, g: number, b: number): Rgb {
  if (r > 200 && g > 200 && b > 200) return FLOOR_COLOR;
  if (r < 60 && g < 60 && b < 60) return HOLE_COLOR;
  if (r > 200 && g < 90 && b < 90) return WALL_COLOR;
  if (r > 200 && g > 90 && b > 90) return SAND_COLOR;
  return [(r + FLOOR_COLOR[0]) >> 1, (g + FLOOR_COLOR[1]) >> 1, (b + FLOOR_COLOR[2]) >> 1];
}

/** Redraws a level bitmap as the picker's miniature: recoloured, in a sand frame with the two base marks. */
async function loadPreview(level: LevelInfo): Promise<Texture> {
  const bitmap = await loadLevelBitmap(level.preview);
  const source = document.createElement('canvas');
  source.width = MAP_SIZE;
  source.height = MAP_SIZE;
  const sctx = source.getContext('2d')!;
  const original = document.createElement('canvas');
  original.width = bitmap.width;
  original.height = bitmap.height;
  original.getContext('2d')!.putImageData(bitmap, 0, 0);
  sctx.imageSmoothingEnabled = false;
  sctx.drawImage(original, 0, 0, MAP_SIZE, MAP_SIZE);
  const pixels = sctx.getImageData(0, 0, MAP_SIZE, MAP_SIZE);
  for (let i = 0; i < pixels.data.length; i += 4) {
    const [r, g, b] = previewColor(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]);
    pixels.data[i] = r;
    pixels.data[i + 1] = g;
    pixels.data[i + 2] = b;
    pixels.data[i + 3] = 255;
  }

  const canvas = document.createElement('canvas');
  canvas.width = PREVIEW_SIZE;
  canvas.height = PREVIEW_SIZE;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = FRAME_COLOR;
  ctx.fillRect(0, 0, PREVIEW_SIZE, PREVIEW_SIZE);
  ctx.putImageData(pixels, FRAME_PAD, FRAME_PAD);

  // The two small tabs are the teams' bases, north and south.
  const tabX = PREVIEW_SIZE / 2 - 4;
  for (const tabY of [0, PREVIEW_SIZE - 6]) {
    ctx.fillStyle = FRAME_TAB_EDGE;
    ctx.fillRect(tabX, tabY, 8, 6);
    ctx.fillStyle = FRAME_TAB_COLOR;
    ctx.fillRect(tabX + 1, tabY + 1, 6, 4);
  }
  return Texture.from(canvas);
}

/** The level picker: a grid of map miniatures with the chosen one highlighted. */
export class LevelSelectScene implements Scene {
  container: Container;
  private selected: number;
  private frames: Sprite[] = [];
  private previewTextures: Texture[] = [];
  private startBtn: PixelButton;
  private destroyed = false;

  constructor(manager: SceneManager) {
    this.container = new Container();

    const panel = new Sprite(getTexture('level_panel'));
    panel.width = GW;
    panel.height = GH;
    this.container.addChild(panel);

    const title = makeText('CHOOSE A LEVEL', 0xfff0d0);
    title.x = 20;
    title.y = 20;
    this.container.addChild(title);

    this.selected = Math.max(0, LEVELS.indexOf(gameState.selectedLevel));

    LEVELS.forEach((level, i) => {
      const holder = new Container();
      holder.x = GRID_X + (i % COLS) * (CELL_W + CELL_GAP_X);
      holder.y = GRID_Y + Math.floor(i / COLS) * (CELL_H + CELL_GAP_Y);
      holder.eventMode = 'static';
      holder.cursor = 'pointer';

      const frame = new Sprite(frameTexture('level_cell', 0, CELL_NORMAL));
      holder.addChild(frame);
      this.frames.push(frame);

      const label = makeText(level.name, 0xfff0d0, 10, 'center');
      label.x = CELL_W / 2;
      label.y = 71;
      holder.addChild(label);

      holder.on('pointerover', () => this.showFrame(i, true));
      holder.on('pointerout', () => this.showFrame(i, false));
      holder.on('pointertap', () => {
        this.selected = i;
        this.refresh();
      });
      this.container.addChild(holder);

      loadPreview(level)
        .then((texture) => {
          if (this.destroyed) {
            texture.destroy(true);
            return;
          }
          const thumb = new Sprite(texture);
          this.previewTextures.push(texture);
          thumb.x = (CELL_W - PREVIEW_SIZE) / 2;
          thumb.y = 4;
          // A level without a map file can be looked at but not played.
          if (!level.path) thumb.alpha = 0.45;
          holder.addChildAt(thumb, 1);
        })
        .catch((err: unknown) => {
          report(err, `No preview for ${level.name}`, 'level');
          if (this.destroyed) return;
          const error = makeText('Preview unavailable', 0xff8888, 8, 'center');
          error.x = CELL_W / 2;
          error.y = 32;
          holder.addChild(error);
        });
    });

    this.startBtn = new PixelButton('Start', 126, 22);
    this.startBtn.x = 365;
    this.startBtn.y = 336;
    this.startBtn.onPress = () => {
      gameState.selectedLevel = LEVELS[this.selected];
      manager.goto('difficulty_select');
    };
    this.container.addChild(this.startBtn);

    const cancelBtn = new PixelButton('Cancel', 127, 22);
    cancelBtn.x = 228;
    cancelBtn.y = 336;
    cancelBtn.onPress = () => manager.goto('title');
    this.container.addChild(cancelBtn);

    this.refresh();
  }

  private showFrame(index: number, hovered: boolean): void {
    const state = index === this.selected ? CELL_SELECTED : hovered ? CELL_HOVER : CELL_NORMAL;
    this.frames[index].texture = frameTexture('level_cell', 0, state);
  }

  private refresh(): void {
    this.frames.forEach((_, i) => this.showFrame(i, false));
    this.startBtn.setEnabled(LEVELS[this.selected].path !== null);
  }

  destroy(): void {
    this.destroyed = true;
    this.container.destroy({ children: true });
    for (const texture of this.previewTextures) texture.destroy(true);
  }
}
