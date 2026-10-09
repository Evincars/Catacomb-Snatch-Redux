import { world } from '../world';

/** Sync Pixi sprite transforms and tints from ECS state. */
export function updateRender(_dt: number): void {
  for (const entity of world.with('position', 'sprite')) {
    const pos = entity.position!;
    const sprite = entity.sprite!;
    const yOff = entity.yOffset ?? 0;

    sprite.x = Math.round(pos.x);
    sprite.y = Math.round(pos.y - yOff);

    // Entities overlap back-to-front by feet position.
    sprite.zIndex = pos.y;

    if ((entity.hurtTime ?? 0) > 0) {
      const t = entity.hurtTime!;
      sprite.tint = t > 34 && Math.floor(t / 2) % 2 === 0 ? 0xffffff : 0xff4040;
    } else if ((entity.flashTime ?? 0) > 0) {
      sprite.tint = 0x80ffff;
    } else {
      sprite.tint = 0xffffff;
    }
  }
}
