import { Container, Graphics, Sprite } from 'pixi.js';
import type { Entity, ShopKind } from '../world';
import { frameTexture } from '../render/Sheets';
import { SHOP_DEFS } from '../entities/ShopItemFactory';
import { codeLabel, bindingFor } from '../game/Settings';
import type { ActionName } from '../game/Settings';
import { PixelLabel } from './PixelText';

const SLOT_ACTIONS: ActionName[] = ['weapon_slot_1', 'weapon_slot_2', 'weapon_slot_3'];
const SLOT_W = 34;
const SLOT_H = 44;
const ICON_SCALE = 0.75;
const LABEL_COLOR = 0xffd860;

/** The owned weapons along the top-left of the screen, each labelled with its number key. */
export class WeaponBar {
  readonly container = new Container();
  private shown = '';

  constructor() {
    this.container.x = 6;
    this.container.y = 4;
  }

  update(player: Entity): void {
    const inv = player.weaponInventory;
    if (!inv) return;

    const keys = SLOT_ACTIONS.map((a) => bindingFor(a)).join(',');
    const key = `${inv.weapons.join(',')}|${inv.current}|${keys}`;
    if (key === this.shown) return;
    this.shown = key;

    for (const child of this.container.removeChildren()) child.destroy({ children: true });

    inv.weapons.forEach((kind, i) => {
      const slot = new Container();
      slot.x = i * SLOT_W;

      if (i === inv.current) {
        const bg = new Graphics();
        bg.rect(0, 0, SLOT_W - 2, SLOT_H).fill({ color: 0x000000, alpha: 0.45 });
        slot.addChild(bg);
      }

      const def = SHOP_DEFS[kind as ShopKind];
      const icon = new Sprite(frameTexture(def.sheet, def.col, 0));
      icon.scale.set(ICON_SCALE);
      icon.x = Math.round(((SLOT_W - 2) - 32 * ICON_SCALE) / 2);
      slot.addChild(icon);

      const action = SLOT_ACTIONS[i];
      const label = new PixelLabel(action ? codeLabel(bindingFor(action)) : String(i + 1), {
        color: LABEL_COLOR,
        align: 'center',
        shadow: true,
      });
      label.x = Math.round((SLOT_W - 2) / 2);
      label.y = SLOT_H - 12;
      slot.addChild(label);

      this.container.addChild(slot);
    });
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
