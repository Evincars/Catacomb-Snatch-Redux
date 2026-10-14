import { Container, NineSliceSprite, Sprite } from 'pixi.js';
import { world } from '../world';
import type { Entity } from '../world';
import { getTexture } from '../assets/AssetLoader';
import { camera, GAME_WIDTH, VIEW_HEIGHT } from '../render/Camera';
import { upgradeCostOf } from '../entities/BuildingFactory';
import { keyLabel } from '../game/Settings';
import { PixelLabel } from './PixelText';
import { targetOf } from '../systems/TargetingSystem';

const TITLE_COLOR = 0xffd860;
const LINE_COLOR = 0xffffff;
const UPGRADE_COLOR = 0x7fe05a;
const PAD_X = 6;
const PAD_Y = 5;
const LINE_H = 9;
/** Gap between the tooltip and the thing it describes. */
const GAP = 22;

type Content = { title: string; lines: Array<{ text: string; color: number }>; image?: string };

/** Builds the tooltip text for an entity from whichever components describe it. */
function describe(entity: Entity): Content | null {
  const tip = entity.tooltip;
  if (!tip) return null;

  const up = entity.upgradable;
  const title = up ? `${tip.title} LV ${up.level}` : tip.title;
  const lines = (tip.lines ?? []).map((text) => ({ text, color: LINE_COLOR }));

  const stash = entity.harvester;
  if (stash) {
    lines.push({ text: `Coins: ${stash.collected}/${stash.capacity}`, color: LINE_COLOR });
    if (entity.targeted && stash.collected > 0) {
      lines.push({ text: `[${keyLabel('use')}] Take coins`, color: UPGRADE_COLOR });
    }
  }

  // The upgrade key only works on what the player is actually reaching for.
  if (up && entity.targeted) {
    const cost = upgradeCostOf(entity);
    lines.push(
      cost === null
        ? { text: 'Fully upgraded', color: UPGRADE_COLOR }
        : { text: `[${keyLabel('upgrade')}] Upgrade: ${cost}`, color: UPGRADE_COLOR },
    );
  }
  return { title, lines, image: tip.image };
}

/** A framed description box floating beside the entity a player hovers over or stands next to. */
export class TooltipView {
  readonly container = new Container();
  private shown: Entity | null = null;
  private revision = '';

  constructor() {
    this.container.visible = false;
  }

  update(player?: Entity): void {
    const entity = world.with('position', 'hovered').first
      ?? (player ? targetOf(player) : world.with('position', 'targeted').first) ?? null;
    const content = entity ? describe(entity) : null;
    if (!entity || !content) {
      this.container.visible = false;
      this.shown = null;
      return;
    }

    const key = `${content.title}|${content.lines.map((l) => l.text).join('|')}|${content.image ?? ''}`;
    if (entity !== this.shown || key !== this.revision) {
      this.shown = entity;
      this.revision = key;
      this.rebuild(content);
    }

    this.place(entity);
    this.container.visible = true;
  }

  private rebuild(content: Content): void {
    for (const child of this.container.removeChildren()) child.destroy({ children: true });

    if (content.image) {
      this.container.addChild(new Sprite(getTexture(content.image)));
      return;
    }

    const title = new PixelLabel(content.title.toUpperCase(), { color: TITLE_COLOR });
    const labels = content.lines.map((l) => new PixelLabel(l.text, { color: l.color }));
    const width = Math.ceil(Math.max(title.textWidth, ...labels.map((l) => l.textWidth))) + PAD_X * 2;
    const height = PAD_Y * 2 + LINE_H * (1 + labels.length);

    const bg = new NineSliceSprite({
      texture: getTexture('tooltip_background'),
      leftWidth: 3,
      topHeight: 3,
      rightWidth: 3,
      bottomHeight: 3,
      width,
      height,
    });
    this.container.addChild(bg, title);
    title.x = PAD_X;
    title.y = PAD_Y;
    labels.forEach((label, i) => {
      label.x = PAD_X;
      label.y = PAD_Y + LINE_H * (i + 1) + 1;
      this.container.addChild(label);
    });
  }

  /** Floats above the entity, flipping below it or sliding sideways to stay on screen. */
  private place(entity: Entity): void {
    const w = this.container.width;
    const h = this.container.height;
    const cx = entity.position!.x - Math.round(camera.x);
    const cy = entity.position!.y - (entity.yOffset ?? 0) - Math.round(camera.y);

    let y = cy - GAP - h;
    if (y < 2) y = cy + GAP;
    y = Math.min(y, VIEW_HEIGHT - h - 2);

    this.container.x = Math.round(Math.min(Math.max(cx - w / 2, 2), GAME_WIDTH - w - 2));
    this.container.y = Math.round(y);
  }

  destroy(): void {
    this.container.destroy({ children: true });
  }
}
