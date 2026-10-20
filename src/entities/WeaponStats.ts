import type { BulletType } from './BulletFactory';

export const WEAPON_KINDS = ['rifle', 'shotgun', 'raygun'] as const;

export type WeaponKind = (typeof WEAPON_KINDS)[number];

export type WeaponStats = {
  bullet: BulletType;
  /** Ticks between shots (Java shootDelay). */
  cooldown: number;
  /** Max random aim error in radians (Java accuracy). */
  accuracy: number;
  pellets: number;
  /** Velocity kick opposite the shot. */
  recoil: number;
};

/** Values from the original's constants.txt and the weapon classes. */
export const WEAPON_STATS = {
  rifle:   { bullet: 'rifle',   cooldown: 5,  accuracy: 0.15, pellets: 1, recoil: 1 },
  shotgun: { bullet: 'shotgun', cooldown: 35, accuracy: 0.06, pellets: 7, recoil: 7 },
  raygun:  { bullet: 'ray',     cooldown: 10, accuracy: 0.05, pellets: 1, recoil: 1 },
} as const satisfies Record<WeaponKind, WeaponStats>;

export function isWeaponKind(value: unknown): value is WeaponKind {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(WEAPON_STATS, value);
}
