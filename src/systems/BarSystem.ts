import { Container, Sprite } from 'pixi.js';
import { world } from '../world';
import type { Entity } from '../world';
import { frameTexture, whiteFrameTexture } from '../render/Sheets';

/** Fill strips hold 21 steps (0-20) of a 32px-wide bar. */
const BAR_STEPS = 20;
const BAR_HALF_WIDTH = 16;
const SPRINT_BAR_OFFSET = 8;
/** Room left, in coins, below which a harvester's bar turns orange. */
const NEARLY_FULL = 500;

/** Fill colour by fraction of health left, from Java's Mob.addHealthBar. */
function fillColor(value: number, max: number): number {
  const tenth = max / 10;
  if (value < tenth * 3) return 0xf62800;
  if (value < tenth * 6) return 0xfe7700;
  if (value < tenth * 8) return 0xfef115;
  return 0x8af116;
}

type Bar = { container: Container; fill: Sprite };

const damaged = world.with('position', 'health', 'healthBarOffset');
const storing = world.with('position', 'harvester', 'coinBarOffset');
const sprinters = world.with('position', 'playerStats');

function createHealthBar(gameLayer: Container): Bar {
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

/** Places a bar centred under the entity, `offset` pixels below its feet. */
function placeBar(bar: Bar, pos: { x: number; y: number }, offset: number): void {
  bar.container.x = Math.round(pos.x) - BAR_HALF_WIDTH;
  bar.container.y = Math.round(pos.y) + offset;
  bar.container.zIndex = pos.y + 0.5;
  bar.container.visible = true;
}

function healthBarOf(entity: Entity, gameLayer: Container): Bar {
  if (entity.healthBar) return entity.healthBar;
  const bar = createHealthBar(gameLayer);
  world.addComponent(entity, 'healthBar', bar);
  return bar;
}

function coinBarOf(entity: Entity, gameLayer: Container): Bar {
  if (entity.coinBar) return entity.coinBar;
  const bar = createHealthBar(gameLayer);
  world.addComponent(entity, 'coinBar', bar);
  return bar;
}

function sprintBarOf(player: Entity, gameLayer: Container): Sprite {
  if (player.sprintBar) return player.sprintBar;
  const bar = new Sprite();
  gameLayer.addChild(bar);
  world.addComponent(player, 'sprintBar', bar);
  return bar;
}

/** A depleting bar under a damaged mob, nest or machine, coloured by how much health is left. */
function updateHealthBar(entity: Entity, gameLayer: Container): void {
  const { current, max } = entity.health!;
  const maxValue = Math.trunc(max);
  const visible = !entity.removed && entity.respawnTicks === undefined && current < max && maxValue > 0;
  if (!visible) {
    if (entity.healthBar) entity.healthBar.container.visible = false;
    return;
  }
  const bar = healthBarOf(entity, gameLayer);
  const value = Math.max(0, Math.trunc(current));
  bar.fill.texture = whiteFrameTexture('bar_green', Math.trunc((value * BAR_STEPS) / maxValue), 0);
  bar.fill.tint = fillColor(value, maxValue);
  placeBar(bar, entity.position!, entity.healthBarOffset!);
}

/** A harvester's bar fills with the coins it has stored and turns orange when nearly full. */
function updateCoinBar(entity: Entity, gameLayer: Container): void {
  if (entity.removed) {
    if (entity.coinBar) entity.coinBar.container.visible = false;
    return;
  }
  const { collected, capacity } = entity.harvester!;
  const bar = coinBarOf(entity, gameLayer);
  bar.fill.texture = whiteFrameTexture('bar_green', Math.min(BAR_STEPS, Math.trunc((collected * BAR_STEPS) / capacity)), 0);
  bar.fill.tint = capacity - collected < NEARLY_FULL ? 0xff7200 : 0xffd800;
  placeBar(bar, entity.position!, entity.coinBarOffset!);
}

/** The stamina bar under a sprinting player. */
function updateSprintBar(player: Entity, gameLayer: Container): void {
  const stats = player.playerStats!;
  if (stats.sprint <= 0 || player.removed || player.respawnTicks !== undefined) {
    if (player.sprintBar) player.sprintBar.visible = false;
    return;
  }
  const bar = sprintBarOf(player, gameLayer);
  const pos = player.position!;
  bar.texture = frameTexture('sprint_bar', Math.trunc((stats.sprint * BAR_STEPS) / stats.maxSprint), 0);
  bar.x = Math.round(pos.x) - BAR_HALF_WIDTH;
  bar.y = Math.round(pos.y) + SPRINT_BAR_OFFSET;
  bar.zIndex = pos.y + 0.5;
  bar.visible = true;
}

/**
 * Health bars under damaged mobs/nests, and the stamina bar under a sprinting
 * player. Positions follow Java: bars are 32px wide, centred on the entity.
 */
export function updateBars(gameLayer: Container): void {
  for (const entity of damaged) updateHealthBar(entity, gameLayer);
  for (const entity of storing) updateCoinBar(entity, gameLayer);
  for (const player of sprinters) updateSprintBar(player, gameLayer);
}

/** Frees the display objects a removed entity owned besides its main sprite. */
export function destroyAttachments(entity: Entity): void {
  entity.healthBar?.container.destroy({ children: true });
  entity.coinBar?.container.destroy({ children: true });
  entity.sprintBar?.destroy();
  entity.hurtOverlay?.destroy();
  entity.fallMask?.destroy();
  entity.priceLabel?.destroy();
  entity.marker?.destroy();
  entity.rangeView?.gfx.destroy();
  entity.cargoSprite?.destroy();
}
