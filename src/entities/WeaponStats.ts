import type { BulletType } from './BulletFactory';

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
export const WEAPON_STATS: Record<string, WeaponStats> = {
  rifle:   { bullet: 'rifle',   cooldown: 5,  accuracy: 0.15, pellets: 1, recoil: 1 },
  shotgun: { bullet: 'shotgun', cooldown: 35, accuracy: 0.06, pellets: 7, recoil: 7 },
  raygun:  { bullet: 'ray',     cooldown: 10, accuracy: 0.05, pellets: 1, recoil: 1 },
};
