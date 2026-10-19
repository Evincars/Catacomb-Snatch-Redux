import { Container, Graphics, Sprite } from 'pixi.js';
import { world, PLAYER_SLOTS } from '../world';
import type { Entity } from '../world';
import { GAME_WIDTH } from '../render/Camera';
import { getTexture } from '../assets/AssetLoader';
import { makeText, makeTitle } from './PixelText';

const ROW_H = 18;
const WIDTH = 250;
const TOP = 44;

/** The players' standings, shown while Tab is held in a multiplayer match: name, level (star) and coins. */
export class Scoreboard {
  readonly container = new Container();
  private shown = '';

  constructor() {
    this.container.visible = false;
  }

  private rows(): Entity[] {
    return [...world.with('playerSlot', 'playerStats')]
      .sort((a, b) => PLAYER_SLOTS.indexOf(a.playerSlot!) - PLAYER_SLOTS.indexOf(b.playerSlot!));
  }

  /** Whether there is anyone to list besides this player: it is only for matches with company. */
  get worthShowing(): boolean {
    return this.rows().length > 1;
  }

  update(visible: boolean, me: Entity | undefined): void {
    this.container.visible = visible && this.worthShowing;
    if (!this.container.visible) return;
    const rows = this.rows();
    const key = rows.map((e) => `${e.playerName}|${e.playerStats!.level}|${e.playerStats!.score}|${e === me}`).join(';');
    if (key === this.shown) return;
    this.shown = key;
    for (const child of this.container.removeChildren()) child.destroy({ children: true });

    const height = 30 + rows.length * ROW_H + 8;
    const left = (GAME_WIDTH - WIDTH) / 2;
    const panel = new Graphics();
    panel.roundRect(left, TOP, WIDTH, height, 4).fill({ color: 0x000000, alpha: 0.7 }).stroke({ color: 0x8b613d, width: 1 });
    this.container.addChild(panel);
    const title = makeTitle('Players');
    title.x = GAME_WIDTH / 2;
    title.y = TOP + 6;
    this.container.addChild(title);

    rows.forEach((e, i) => {
      const y = TOP + 30 + i * ROW_H;
      const color = e === me ? 0xffdd44 : 0xffffff;
      const name = makeText(e.playerName ?? e.playerSlot ?? '', color, 8);
      name.x = left + 12;
      name.y = y + 4;
      const star = new Sprite(getTexture('p_level'));
      star.x = left + 140;
      star.y = y;
      star.scale.set(0.9);
      const level = makeText(`${e.playerStats!.level}`, color, 8);
      level.x = left + 160;
      level.y = y + 4;
      const coin = new Sprite(getTexture('p_coin'));
      coin.x = left + 186;
      coin.y = y;
      coin.scale.set(0.9);
      const coins = makeText(`${e.playerStats!.score}`, color, 8);
      coins.x = left + 206;
      coins.y = y + 4;
      this.container.addChild(name, star, level, coin, coins);
    });
  }
}
