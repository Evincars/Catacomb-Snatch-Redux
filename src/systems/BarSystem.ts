import { Container, Sprite } from 'pixi.js';
import { world } from '../world';
import type { Entity } from '../world';
import { frameTexture, whiteFrameTexture } from '../render/Sheets';

/** Fill strips hold 21 steps (0-20) of a 32px-wide bar. */
const BAR_STEPS = 20;
const BAR_HALF_WIDTH = 16;
const SPRINT_BAR_OFFSET = 8;

/** Fill colour by fraction of health left, from Java's Mob.addHealthBar. */
function fillColor(value: number, max: number): number {
  const tenth = max / 10;
  if (value < tenth * 3) return 0xf62800;
  if (value < tenth * 6) return 0xfe7700;
  if (value < tenth * 8) return 0xfef115;
  return 0x8af116;
}

function createHealthBar(gameLayer: Container): { container: Container; fill: Sprite } {
  const container = new Container();
  const fill = new Sprite();
  container.addChild(
    new Sprite(frameTexture('bar_green_underlay', 0, 0)),
    fill,
    new Sprite(frameTexture('bar_outline', 0, 0)),
  );
  gameLayer.addChild(container);
  return { container, fill };
}

/**
 * Health bars under damaged mobs/nests, and the stamina bar under a sprinting
 * player. Positions follow Java: bars are 32px wide, centred on the entity.
 */
export function updateBars(gameLayer: Container): void {
  for (const entity of world.with('position', 'health', 'healthBarOffset')) {
    const { current, max } = entity.health!;
    const maxValue = Math.trunc(max);
    const visible = !entity.removed && current < max && maxValue > 0;

    let bar = entity.healthBar;
    if (!visible) {
      if (bar) bar.container.visible = false;
      continue;
    }
    if (!bar) {
      bar = createHealthBar(gameLayer);
      world.addComponent(entity, 'healthBar', bar);
    }

    const pos = entity.position!;
    const value = Math.max(0, Math.trunc(current));
    bar.fill.texture = whiteFrameTexture('bar_green', Math.trunc((value * BAR_STEPS) / maxValue), 0);
    bar.fill.tint = fillColor(value, maxValue);
    bar.container.x = Math.round(pos.x) - BAR_HALF_WIDTH;
    bar.container.y = Math.round(pos.y) + entity.healthBarOffset!;
    bar.container.zIndex = pos.y + 0.5;
    bar.container.visible = true;
  }

  // A harvester's bar fills with the coins it has stored and turns orange when nearly full.
  for (const entity of world.with('position', 'harvester', 'coinBarOffset')) {
    const { collected, capacity } = entity.harvester!;
    let bar = entity.coinBar;
    if (entity.removed) {
      if (bar) bar.container.visible = false;
      continue;
    }
    if (!bar) {
      bar = createHealthBar(gameLayer);
      world.addComponent(entity, 'coinBar', bar);
    }

    const pos = entity.position!;
    bar.fill.texture = whiteFrameTexture('bar_green', Math.min(BAR_STEPS, Math.trunc((collected * BAR_STEPS) / capacity)), 0);
    bar.fill.tint = capacity - collected < 500 ? 0xff7200 : 0xffd800;
    bar.container.x = Math.round(pos.x) - BAR_HALF_WIDTH;
    bar.container.y = Math.round(pos.y) + entity.coinBarOffset!;
    bar.container.zIndex = pos.y + 0.5;
    bar.container.visible = true;
  }

  for (const player of world.with('position', 'playerStats')) {
    const stats = player.playerStats!;
    let bar = player.sprintBar;

    if (stats.sprint <= 0 || player.removed) {
      if (bar) bar.visible = false;
      continue;
    }
    if (!bar) {
      bar = new Sprite();
      gameLayer.addChild(bar);
      world.addComponent(player, 'sprintBar', bar);
    }

    const pos = player.position!;
    bar.texture = frameTexture('sprint_bar', Math.trunc((stats.sprint * BAR_STEPS) / stats.maxSprint), 0);
    bar.x = Math.round(pos.x) - BAR_HALF_WIDTH;
    bar.y = Math.round(pos.y) + SPRINT_BAR_OFFSET;
    bar.zIndex = pos.y + 0.5;
    bar.visible = true;
  }
}

/** Frees the display objects a removed entity owned besides its main sprite. */
export function destroyAttachments(entity: Entity): void {
  entity.healthBar?.container.destroy({ children: true });
  entity.coinBar?.container.destroy({ children: true });
  entity.sprintBar?.destroy();
  entity.hurtOverlay?.destroy();
  entity.priceLabel?.destroy();
  entity.marker?.destroy();
  entity.rangeView?.gfx.destroy();
  entity.cargoSprite?.destroy();
}
