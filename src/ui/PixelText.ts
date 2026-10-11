import { Container, Sprite } from 'pixi.js';
import type { Texture } from 'pixi.js';
import { frameTexture } from '../render/Sheets';
import { getTexture } from '../assets/AssetLoader';

export type PixelTextAlign = 'left' | 'center' | 'right';

const FONT = 'font_default';
const GLYPH = 8;
const SPACE_WIDTH = 4;
const GLYPH_GAP = 1;
const LINE_HEIGHT = 9;

type Ink = { left: number; width: number };
let inkCache: Ink[] | null = null;

/** Measures the painted columns of every glyph so text can be set proportionally. */
function glyphInk(): Ink[] {
  if (inkCache) return inkCache;

  const tex = getTexture(FONT);
  const resource = tex.source?.resource as CanvasImageSource | undefined;
  if (!resource || tex.width === 0) return new Array<Ink>(256).fill({ left: 0, width: 5 });

  const canvas = document.createElement('canvas');
  canvas.width = tex.source.pixelWidth;
  canvas.height = tex.source.pixelHeight;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  ctx.drawImage(resource, 0, 0);
  const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;

  const ink: Ink[] = [];
  for (let code = 0; code < 256; code++) {
    const cx = (code % 16) * GLYPH;
    const cy = Math.floor(code / 16) * GLYPH;
    let min = GLYPH;
    let max = -1;
    for (let y = 0; y < GLYPH; y++) {
      for (let x = 0; x < GLYPH; x++) {
        if (data[((cy + y) * canvas.width + cx + x) * 4 + 3] > 0) {
          if (x < min) min = x;
          if (x > max) max = x;
        }
      }
    }
    ink.push(max < 0 ? { left: 0, width: SPACE_WIDTH - GLYPH_GAP } : { left: min, width: max - min + 1 });
  }
  inkCache = ink;
  return ink;
}

/** Punctuation outside the font sheet, drawn as its closest plain equivalent. */
const SUBSTITUTES: Record<string, string> = { '\u2014': '-', '\u2013': '-', '\u2019': "'", '\u2018': "'", '\u2026': '.' };

function codeOf(ch: string): number {
  const code = (SUBSTITUTES[ch] ?? ch).charCodeAt(0);
  return code >= 32 && code < 256 ? code : 63;
}

export type PixelLabelOptions = {
  color?: number;
  scale?: number;
  align?: PixelTextAlign;
  /** Dark offset copy behind each glyph, so text stays legible over busy art. */
  shadow?: boolean;
  /** Dark halo on all four sides, for text drawn over the game world. */
  outline?: boolean;
};

/** Bitmap text drawn from the original's 8x8 font sheet, always on whole pixels. */
export class PixelLabel extends Container {
  private content = '';
  private color: number;
  private readonly scaleFactor: number;
  private readonly align: PixelTextAlign;
  private readonly shadow: boolean;
  private readonly outline: boolean;
  private widthPx = 0;
  private heightPx = 0;
  private built = false;

  constructor(text: string, opts: PixelLabelOptions = {}) {
    super();
    this.color = opts.color ?? 0xffffff;
    this.scaleFactor = opts.scale ?? 1;
    this.align = opts.align ?? 'left';
    this.shadow = opts.shadow ?? false;
    this.outline = opts.outline ?? false;
    this.text = text;
  }

  get text(): string {
    return this.content;
  }

  set text(value: string) {
    if (this.built && value === this.content) return;
    this.content = value;
    this.rebuild();
  }

  get fill(): number {
    return this.color;
  }

  set fill(color: number) {
    if (color === this.color) return;
    this.color = color;
    this.rebuild();
  }

  /** Pixel size of the laid-out text. */
  get textWidth(): number {
    return this.widthPx;
  }

  get textHeight(): number {
    return this.heightPx;
  }

  private lineWidth(line: string, ink: Ink[]): number {
    let w = 0;
    for (const ch of line) {
      w += ch === ' ' ? SPACE_WIDTH : ink[codeOf(ch)].width + GLYPH_GAP;
    }
    return Math.max(0, w - GLYPH_GAP) * this.scaleFactor;
  }

  private rebuild(): void {
    this.built = true;
    for (const child of this.removeChildren()) child.destroy();

    const ink = glyphInk();
    const s = this.scaleFactor;
    const lines = this.content.split('\n');
    const widths = lines.map((l) => this.lineWidth(l, ink));
    this.widthPx = Math.max(0, ...widths);
    this.heightPx = lines.length * LINE_HEIGHT * s;

    const passes: Array<{ dx: number; dy: number; tint: number }> = [];
    if (this.outline) {
      for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
        passes.push({ dx: dx * s, dy: dy * s, tint: 0x000000 });
      }
    } else if (this.shadow) {
      passes.push({ dx: s, dy: s, tint: 0x000000 });
    }
    passes.push({ dx: 0, dy: 0, tint: this.color });

    lines.forEach((line, row) => {
      let x =
        this.align === 'center' ? -Math.floor(widths[row] / 2)
        : this.align === 'right' ? -widths[row]
        : 0;
      const y = row * LINE_HEIGHT * s;

      for (const ch of line) {
        if (ch === ' ') {
          x += SPACE_WIDTH * s;
          continue;
        }
        const code = codeOf(ch);
        const g = ink[code];
        const tex: Texture = frameTexture(FONT, code % 16, Math.floor(code / 16));
        for (const pass of passes) {
          const sprite = new Sprite(tex);
          sprite.tint = pass.tint;
          sprite.scale.set(s);
          sprite.x = x - g.left * s + pass.dx;
          sprite.y = y + pass.dy;
          this.addChild(sprite);
        }
        x += (g.width + GLYPH_GAP) * s;
      }
    });
  }
}

/** Menu and HUD text. Sizes up to 11 use the native 8px font; larger sizes double it. */
export function makeText(
  content: string,
  color = 0xffffff,
  size = 10,
  align: PixelTextAlign = 'left',
): PixelLabel {
  return new PixelLabel(content, { color, scale: size >= 12 ? 2 : 1, align, shadow: true });
}

export function makeTitle(content: string): PixelLabel {
  return new PixelLabel(content, { color: 0xffcc44, scale: 2, align: 'center', shadow: true });
}
