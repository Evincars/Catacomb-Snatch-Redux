import { world } from '../world';
import type { Entity } from '../world';

type FxLayer = { sheet: string; frames: number; duration: [number, number]; scale: number };

/**
 * Blast played where something dies. The original reuses one animation for every
 * mob; here each kind gets its own mix so a bat pops, a pharaoh goes up in flames.
 */
const DEATH_FX: Record<string, FxLayer[]> = {
  bat:     [{ sheet: 'fx_enemydie_tiny_32', frames: 9, duration: [20, 26], scale: 1 }],
  snake:   [{ sheet: 'fx_enemydie_64', frames: 17, duration: [34, 40], scale: 0.75 }],
  scarab:  [{ sheet: 'fx_enemydie_64', frames: 17, duration: [40, 49], scale: 1 }],
  mummy:   [
    { sheet: 'fx_enemydie_64', frames: 17, duration: [40, 49], scale: 1 },
    { sheet: 'fx_dust1_24', frames: 10, duration: [40, 50], scale: 1.5 },
  ],
  pharao:  [
    { sheet: 'fx_enemydie_64', frames: 17, duration: [40, 49], scale: 1.5 },
    { sheet: 'fx_bombsplosion_big_32', frames: 10, duration: [28, 32], scale: 2 },
  ],
  spawner: [
    { sheet: 'fx_bombsplosion_big_32', frames: 10, duration: [28, 32], scale: 1.5 },
    { sheet: 'fx_enemydie_64', frames: 17, duration: [40, 49], scale: 1.25 },
  ],
};

export function spawnFx(
  x: number,
  y: number,
  sheet: string,
  frames: number,
  duration: number,
  opts: { scale?: number; cycle?: boolean; yOffset?: number; orderId?: number; orderBias?: number } = {},
): Entity {
  return world.add({
    position: { x, y },
    yOffset: opts.yOffset ?? 0,
    visual: { sheet, col: 0 },
    fx: {
      age: 0,
      duration,
      frames,
      cycle: opts.cycle,
      scale: opts.scale,
      orderId: opts.orderId,
      orderBias: opts.orderBias,
    },
  });
}

export function spawnDeathFx(entity: Entity): void {
  const pos = entity.position;
  if (!pos) return;

  const key = entity.spawner ? 'spawner' : (entity.mobType ?? 'scarab');
  const layers = DEATH_FX[key] ?? DEATH_FX.scarab;

  for (const layer of layers) {
    const [min, max] = layer.duration;
    const duration = min + Math.floor(Math.random() * (max - min + 1));
    // The 64px blast is drawn 4px above the feet in the original.
    spawnFx(pos.x, pos.y, layer.sheet, layer.frames, duration, { scale: layer.scale, yOffset: 4 });
  }
}

/**
 * Muzzle flash at the gun barrel. Mirrors Java's Weapon.primaryFire: the flash
 * sits just ahead of where the bullet spawns, and is tucked behind the player
 * when they face away from the camera.
 */
export function spawnMuzzleFlash(owner: Entity, dirX: number, dirY: number): void {
  const pos = owner.position;
  if (!pos) return;

  const facing = owner.facing ?? 0;
  const bulletX = pos.x + dirX * 4;
  const bulletY = pos.y + dirY * 4;

  let x = bulletX + 7 * dirX;
  let y = bulletY + 5 * dirY + 1;
  if (facing === 0) {
    x += 4;
    y -= 4;
  }

  const behind = facing >= 3 && facing <= 5;
  spawnFx(x, y, 'muzzle', 4, 3, {
    cycle: true,
    orderId: world.id(owner),
    orderBias: behind ? -0.5 : 0.5,
  });
}
