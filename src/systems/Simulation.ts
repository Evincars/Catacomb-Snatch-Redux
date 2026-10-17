import type { Container } from 'pixi.js';
import type { Level } from '../level/Level';
import { updateInput } from './InputSystem';
import { updateTargeting } from './TargetingSystem';
import { updateAIPlayers } from './AIPlayerSystem';
import { updateInteraction, updateCarried } from './InteractionSystem';
import { updateAI } from './AISystem';
import { updateMobWeapons } from './MobWeaponSystem';
import { updateWeapons } from './WeaponSystem';
import { updateTurrets, updateHarvesters, updateBombs, updateChests } from './BuildingSystem';
import { updateSpikeTraps } from './SpikeTrapSystem';
import { updateMovement, updateSlides } from './MovementSystem';
import { updateBullets } from './BulletSystem';
import { updateCombatTimers, updateBulletCollision, updateContactDamage } from './CombatSystem';
import { updateBuffs } from './BuffSystem';
import { updateLoot } from './LootSystem';
import { updateSpawners } from './SpawnerSystem';
import { updateRandomSpawner } from './RandomSpawnerSystem';
import { updateDeath } from './DeathSystem';
import { updateHoles } from './HoleSystem';
import { updateDropTraps } from './DropTrapSystem';
import { updateRespawns, updateSpawnProtection } from './RespawnSystem';
import { updateSprites } from './SpriteSystem';
import { updateFx, updateExplosions } from './FxSystem';
import { updateRailDroids, updateRailDroidCargo } from './RailDroidSystem';
import { updateAnimation } from './AnimationSystem';
import { updateRender } from './RenderSystem';
import { updateBars } from './BarSystem';
import { updateMarkers } from './MarkerSystem';
import { updateRanges } from './RangeSystem';
import { updateFootsteps } from './FootstepSystem';
import { updateFalling } from './FallSystem';
import { updateDust } from './DustSystem';
import { updateEphemerals } from './EphemeralSystem';

/** Everything a system may need to know about the running game. */
export type FrameContext = {
  level: Level;
  dt: number;
  gameLayer: Container;
  /** Redraws terrain and wall entities after the level changed shape. */
  rebuildTerrain: () => void;
};

export type System = (ctx: FrameContext) => void;

/** Game rules, run in this order every tick: input, intent, movement, combat, then cleanup. */
export const SIMULATION: readonly System[] = [
  ({ level, dt }) => updateRespawns(level, dt),
  ({ dt }) => updateInput(dt),
  // The computer opponent presses its keys where a person's would be read.
  ({ level }) => updateAIPlayers(level),
  () => updateTargeting(),
  ({ level }) => updateInteraction(level),
  ({ level, dt }) => updateAI(level, dt),
  ({ dt }) => updateWeapons(dt),
  ({ level }) => updateMobWeapons(level),
  ({ level, dt }) => updateTurrets(level, dt),
  ({ level, dt }) => updateMovement(level, dt),
  ({ level }) => updateSlides(level),
  ({ level }) => updateRailDroids(level),
  ({ level }) => updateSpawnProtection(level),
  () => updateDust(),
  () => updateFootsteps(),
  () => updateEphemerals(),
  ({ level, dt }) => updateBullets(level, dt),
  ({ dt }) => updateCombatTimers(dt),
  ({ dt }) => updateBulletCollision(dt),
  ({ dt }) => updateContactDamage(dt),
  () => updateSpikeTraps(),
  () => updateChests(),
  ({ dt }) => updateBuffs(dt),
  ({ dt }) => updateLoot(dt),
  ({ dt }) => updateHarvesters(dt),
  ({ level, dt }) => updateSpawners(level, dt),
  ({ level }) => updateRandomSpawner(level),
  // Bombs must detonate before DeathSystem clears the destroyed entity.
  ({ level, dt }) => updateBombs(level, dt),
  () => updateExplosions(),
  ({ level, dt }) => updateDeath(level, dt),
  ({ level }) => updateDropTraps(level),
  ({ level }) => updateHoles(level),
  ({ level }) => updateFalling(level),
  () => updateCarried(),
  (ctx) => {
    if (ctx.level.tilesDirty) ctx.rebuildTerrain();
  },
];

/** Turns entity state into pixels: sprites, animation, effects, markers and bars. */
export const PRESENTATION: readonly System[] = [
  ({ gameLayer }) => updateSprites(gameLayer),
  () => updateFx(),
  ({ dt }) => updateAnimation(dt),
  ({ dt, level }) => updateRender(dt, level),
  ({ gameLayer }) => updateRailDroidCargo(gameLayer),
  ({ gameLayer }) => updateBars(gameLayer),
  ({ gameLayer }) => updateRanges(gameLayer),
  ({ gameLayer }) => updateMarkers(gameLayer),
];

export function runSystems(systems: readonly System[], ctx: FrameContext): void {
  for (const system of systems) system(ctx);
}
