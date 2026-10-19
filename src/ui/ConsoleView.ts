import { Container, Graphics } from 'pixi.js';
import { GAME_WIDTH } from '../render/Camera';
import { makeText } from './PixelText';
import type { PixelLabel } from './PixelText';

const HEADER = [
  'Catacomb Snatch Console v1.1',
  'Type commands with a slash in front, like /this',
  'If in doubt, type /help',
];
const VISIBLE_LINES = 10;
const MAX_INPUT = 80;
const PANEL_HEIGHT = 150;

/** The ~ console: a text box over the top of the game that reads one command line at a time. */
export class ConsoleView {
  readonly container = new Container();
  private output: string[] = [];
  private history: string[] = [];
  private recall = -1;
  private input = '';
  private blink = 0;
  private readonly outputLabel: PixelLabel;
  private readonly inputLabel: PixelLabel;

  constructor(private readonly run: (line: string) => string[]) {
    const panel = new Graphics();
    panel.rect(0, 0, GAME_WIDTH, PANEL_HEIGHT).fill({ color: 0x000000, alpha: 0.6 });
    this.container.addChild(panel);
    this.container.addChild(this.dashedBox(6, 6, GAME_WIDTH - 12, 34));

    const header = makeText(HEADER.join('\n'), 0xffffff, 8);
    header.x = 10;
    header.y = 9;
    this.container.addChild(header);

    this.outputLabel = makeText('', 0xffffff, 8);
    this.outputLabel.x = 8;
    this.outputLabel.y = 46;
    this.container.addChild(this.outputLabel);

    this.inputLabel = makeText('/', 0xffffff, 8);
    this.inputLabel.x = 8;
    this.inputLabel.y = PANEL_HEIGHT - 14;
    this.container.addChild(this.inputLabel);

    this.container.visible = false;
  }

  get visible(): boolean {
    return this.container.visible;
  }

  open(): void {
    this.container.visible = true;
    this.input = '/';
    this.recall = -1;
    this.redraw();
  }

  close(): void {
    this.container.visible = false;
  }

  /** Reads one key press while the console is open. */
  handleKey(e: KeyboardEvent): void {
    e.preventDefault();
    if (e.key === 'Enter') {
      this.submit();
    } else if (e.key === 'Backspace') {
      this.input = this.input.slice(0, -1);
    } else if (e.key === 'ArrowUp') {
      this.step(1);
    } else if (e.key === 'ArrowDown') {
      this.step(-1);
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && this.input.length < MAX_INPUT) {
      // The line opens with its slash already typed.
      if (!(e.key === '/' && this.input === '/')) this.input += e.key;
    }
    this.redraw();
  }

  /** Blinks the text cursor. */
  update(): void {
    if (!this.visible) return;
    this.blink = (this.blink + 1) % 40;
    if (this.blink === 0 || this.blink === 20) this.redraw();
  }

  private submit(): void {
    const line = this.input;
    if (line.trim() && line.trim() !== '/') {
      this.history.unshift(line);
      this.print([`>${line}`, ...this.run(line)]);
    }
    this.recall = -1;
    this.input = '/';
  }

  private step(direction: number): void {
    const next = Math.max(-1, Math.min(this.history.length - 1, this.recall + direction));
    this.recall = next;
    this.input = next < 0 ? '/' : this.history[next];
  }

  private print(lines: string[]): void {
    this.output.push(...lines);
    if (this.output.length > VISIBLE_LINES) this.output = this.output.slice(-VISIBLE_LINES);
  }

  private redraw(): void {
    this.outputLabel.text = this.output.join('\n');
    this.inputLabel.text = this.input + (this.blink < 20 ? '_' : ' ');
  }

  private dashedBox(x: number, y: number, w: number, h: number): Graphics {
    const g = new Graphics();
    const dash = 5;
    const edges: Array<[number, number, number, number]> = [
      [x, y, x + w, y], [x, y + h, x + w, y + h], [x, y, x, y + h], [x + w, y, x + w, y + h],
    ];
    for (const [x0, y0, x1, y1] of edges) {
      const length = Math.hypot(x1 - x0, y1 - y0);
      for (let d = 0; d < length; d += dash * 2) {
        const end = Math.min(d + dash, length);
        g.moveTo(x0 + ((x1 - x0) * d) / length, y0 + ((y1 - y0) * d) / length);
        g.lineTo(x0 + ((x1 - x0) * end) / length, y0 + ((y1 - y0) * end) / length);
      }
    }
    return g.stroke({ color: 0xffffff, width: 1 });
  }
}
