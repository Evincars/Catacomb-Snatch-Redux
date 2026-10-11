import { world } from '../world';

/** Ticks of the fall, and how long before the end the prop starts to blink. */
const BLINK_TICKS = 36;
const BLINK_PERIOD = 4;

/** Drops short-lived props to the floor, blinks them toward the end, then removes them. */
export function updateEphemerals(): void {
  for (const entity of world.with('position', 'ephemeral')) {
    if (entity.removed) continue;
    const e = entity.ephemeral!;
    e.age++;

    // Gravity: the prop lands once it has fallen its full starting height.
    entity.yOffset = Math.max(0, e.drop - e.age * e.age * 0.07);

    if (entity.sprite) {
      const left = e.life - e.age;
      entity.sprite.visible = left > BLINK_TICKS || Math.floor(left / BLINK_PERIOD) % 2 === 0;
    }
    if (e.age >= e.life) world.addComponent(entity, 'removed', true);
  }
}
