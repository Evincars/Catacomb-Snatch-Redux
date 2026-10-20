import { Container, Graphics } from 'pixi.js';
import { world } from '../world';
import { centreOf } from './TargetingSystem';

const markedOut = world.with('marker');
const targets = world.with('position', 'targeted');

const BASE_HALF = 17;
/** How far the brackets swing in and out, and how many ticks a full cycle takes. */
const SWING = 2;
const CYCLE_TICKS = 36;
const ARM = 6;
const COLOR = 0xffffff;
/** Above every actor, below the fog. */
const MARKER_Z = 1_000_000;

let clock = 0;
const drawnHalf = new WeakMap<Graphics, number>();

function drawMarker(g: Graphics, half: number): void {
  g.clear();
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const cx = sx * half;
      const cy = sy * half;
      g.moveTo(cx - sx * ARM, cy).lineTo(cx, cy).lineTo(cx, cy - sy * ARM);
    }
  }
  g.stroke({ color: COLOR, width: 1, alignment: 0.5 });
  drawnHalf.set(g, half);
}

/** Frames whatever a player is reaching for with four corner brackets that breathe in and out. */
export function updateMarkers(gameLayer: Container): void {
  clock++;
  for (const entity of markedOut) {
    if (!entity.targeted) entity.marker!.visible = false;
  }

  const half = BASE_HALF + Math.round(SWING * Math.sin((clock / CYCLE_TICKS) * Math.PI * 2));

  for (const entity of targets) {
    let marker = entity.marker;
    if (!marker) {
      marker = new Graphics();
      marker.zIndex = MARKER_Z;
      gameLayer.addChild(marker);
      world.addComponent(entity, 'marker', marker);
    }
    if (drawnHalf.get(marker) !== half) drawMarker(marker, half);
    const centre = centreOf(entity);
    marker.x = Math.round(centre.x);
    marker.y = Math.round(centre.y);
    marker.visible = true;
  }
}
