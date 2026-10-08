import { Text, TextStyle } from 'pixi.js';

export type PixelTextAlign = 'left' | 'center' | 'right';

export function makeText(
  content: string,
  color = 0xffffff,
  size = 10,
  align: PixelTextAlign = 'left',
): Text {
  const t = new Text({
    text: content,
    style: new TextStyle({
      fontFamily: 'monospace',
      fontSize: size,
      fill: color,
      align,
    }),
  });
  if (align === 'center') t.anchor.x = 0.5;
  else if (align === 'right') t.anchor.x = 1;
  return t;
}

export function makeTitle(content: string): Text {
  return makeText(content, 0xffcc44, 16, 'center');
}
