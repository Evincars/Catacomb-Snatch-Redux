import { Container, Graphics } from 'pixi.js';
import { world } from '../world';
import type { Entity } from '../world';
import { PixelLabel } from '../ui/PixelText';

/** Pixels from the character's feet to the bottom of the tag: the sprite stands about 24px tall. */
const TAG_LIFT = 28;
const PADDING_X = 3;
const PADDING_Y = 1;

type Tag = { container: Container; name: string };
const tags = new Map<Entity, Tag>();

function createTag(gameLayer: Container, name: string): Tag {
  const label = new PixelLabel(name, { color: 0xffffff, align: 'center' });
  const width = Math.max(8, label.textWidth) + PADDING_X * 2;
  const height = label.textHeight + PADDING_Y * 2;
  const box = new Graphics();
  box.roundRect(-width / 2, -height, width, height, 2).fill({ color: 0x000000, alpha: 0.55 });
  label.y = -height + PADDING_Y;
  const container = new Container();
  container.addChild(box, label);
  gameLayer.addChild(container);
  return { container, name };
}

/** Forgets every tag; the display objects go with their scene. */
export function resetNameTags(): void {
  for (const tag of tags.values()) if (!tag.container.destroyed) tag.container.destroy({ children: true });
  tags.clear();
}

/** Small translucent name plates above every other player; nobody sees their own. */
export function updateNameTags(gameLayer: Container, local: Entity | undefined): void {
  for (const [entity, tag] of tags) {
    if (world.has(entity) && !entity.removed && entity !== local && entity.playerName === tag.name) continue;
    if (!tag.container.destroyed) tag.container.destroy({ children: true });
    tags.delete(entity);
  }
  for (const entity of world.with('playerName', 'position', 'playerSlot')) {
    if (entity === local || entity.removed || tags.has(entity)) continue;
    tags.set(entity, createTag(gameLayer, entity.playerName!));
  }
  for (const [entity, tag] of tags) {
    const pos = entity.position!;
    const hidden = entity.respawnTicks !== undefined || entity.carriedBy !== undefined || !!entity.falling;
    tag.container.visible = !hidden;
    tag.container.x = Math.round(pos.x);
    tag.container.y = Math.round(pos.y - TAG_LIFT);
    tag.container.zIndex = pos.y + 1;
  }
}
