import { Container, Sprite, Graphics } from 'pixi.js';
import { GAME_WIDTH, GAME_HEIGHT } from '../render/Camera';
import type { Scene, SceneManager } from '../game/SceneManager';
import { PixelButton } from '../ui/PixelButton';
import { makeText } from '../ui/PixelText';
import { getTexture } from '../assets/AssetLoader';
import { frameTexture } from '../render/Sheets';
import { keyLabel } from '../game/Settings';
import { SHOP_DEFS } from '../entities/ShopItemFactory';
import { gameState } from '../game/GameState';

type HelpRow = {
  name: string;
  cost: string;
  description: string;
  sheet: string;
  /** Sheet columns to show side by side, mirroring the original's upgrade icons. */
  cols: number[];
  iconScale?: number;
};

const PANEL = 0x5a3214;
const BORDER = 0xc08040;
const GOLD = 0xffcc44;

export class HowToPlayScene implements Scene {
  container: Container;

  constructor(manager: SceneManager) {
    this.container = new Container();

    const bg = new Sprite(getTexture('background'));
    bg.width = GAME_WIDTH;
    bg.height = GAME_HEIGHT;
    this.container.addChild(bg);

    const rows: HelpRow[] = [
      {
        name: 'TURRET',
        cost: `${SHOP_DEFS.turret.cost}`,
        description: 'Shoots enemies around it.',
        sheet: 'turret',
        cols: [0, 2, 4],
      },
      {
        name: 'COLLECTOR',
        cost: `${SHOP_DEFS.harvester.cost}`,
        description: 'Sucks up coins around it. Pick it up\nto receive the collected coins.',
        sheet: 'harvester',
        cols: [0, 3, 6],
      },
      {
        name: 'BOMB',
        cost: `${SHOP_DEFS.bomb.cost}`,
        description: 'Used to destroy cracked walls.\nShoot to detonate.',
        sheet: 'bomb',
        cols: [0],
      },
      {
        name: 'SHOTGUN',
        cost: `${SHOP_DEFS.shotgun.cost}`,
        description: 'Fires a spread of pellets.\nRaygun costs ' + SHOP_DEFS.raygun.cost + ' and hits harder.',
        sheet: 'weapon_list',
        cols: [1, 2],
      },
    ];

    this.goalPanel();
    this.itemPanels(rows);

    const back = new PixelButton('Back', 200, 28);
    back.x = GAME_WIDTH - 220;
    back.y = GAME_HEIGHT - 38;
    back.onPress = () => manager.back('title');
    this.container.addChild(back);
  }

  private panelBox(x: number, y: number, w: number, h: number): Graphics {
    const g = new Graphics();
    g.rect(x, y, w, h).fill(PANEL);
    g.rect(x, y, w, h).stroke({ color: BORDER, width: 2 });
    this.container.addChild(g);
    return g;
  }

  private goalPanel(): void {
    const x = 196;
    const w = GAME_WIDTH - x - 10;
    this.panelBox(x, 8, w, 62);

    const goal = makeText(
      `GOAL:\nCollect ${gameState.targetScore} coins of treasure\nand bring the catacomb to heel.\n` +
        `Spend coins at your base. [${keyLabel('use')}] to buy.`,
      GOLD,
      9,
      'center',
    );
    goal.x = x + w / 2;
    goal.y = 14;
    this.container.addChild(goal);
  }

  private itemPanels(rows: HelpRow[]): void {
    const top = 78;
    const rowH = 61;
    const leftW = 182;
    const rightX = 196;
    const rightW = GAME_WIDTH - rightX - 10;

    this.panelBox(10, top, leftW, rowH * rows.length);
    this.panelBox(rightX, top, rightW, rowH * rows.length);

    rows.forEach((row, i) => {
      const y = top + i * rowH;

      if (i > 0) {
        const divider = new Graphics();
        divider.rect(10, y, leftW, 1).fill(BORDER);
        divider.rect(rightX, y, rightW, 1).fill(BORDER);
        this.container.addChild(divider);
      }

      row.cols.forEach((col, k) => {
        const icon = new Sprite(frameTexture(row.sheet, col, 0));
        icon.anchor.set(0.5, 0.5);
        icon.scale.set(row.iconScale ?? 1);
        icon.x = 32 + k * 30;
        icon.y = y + rowH / 2;
        this.container.addChild(icon);
      });

      const name = makeText(row.name, GOLD, 11);
      name.x = 122;
      name.y = y + 16;
      this.container.addChild(name);

      const coin = new Sprite(getTexture('p_coin'));
      coin.x = 122;
      coin.y = y + 34;
      this.container.addChild(coin);

      const cost = makeText(row.cost, 0xffffff, 10);
      cost.x = 140;
      cost.y = y + 35;
      this.container.addChild(cost);

      const desc = makeText(row.description, 0xffffff, 9);
      desc.x = rightX + 12;
      desc.y = y + 16;
      this.container.addChild(desc);
    });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
