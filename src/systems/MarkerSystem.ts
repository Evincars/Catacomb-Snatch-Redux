import { Container, Graphics } from 'pixi.js';
import { world } from '../world';

/** Half the side of the box the brackets frame. */
const HALF = 17;
const ARM = 6;
const COLOR = 0xffffff;
/** Above every actor, below the fog. */
const MARKER_Z = 1_000_000;

function createMarker(gameLayer: Container): Graphics {
  const g = new Graphics();
  for (const sx of [-1, 1]) {
    for (const sy of [-1, 1]) {
      const cx = sx * HALF;
      const cy = sy * HALF;
      g.moveTo(cx - sx * ARM, cy).lineTo(cx, cy).lineTo(cx, cy - sy * ARM);
    }
  }
  g.stroke({ color: COLOR, width: 1, alignment: 0.5 });
  g.zIndex = MARKER_Z;
  gameLayer.addChild(g);
  return g;
}

/** Frames whatever a player is reaching for or pointing at with four white corner brackets. */
export function updateMarkers(gameLayer: Container): void {
  for (const entity of world.with('marker')) {
    if (!entity.targeted && !entity.hovered) entity.marker!.visible = false;
  }

  for (const query of [world.with('position', 'targeted'), world.with('position', 'hovered')]) {
    for (const entity of query) {
      let marker = entity.marker;
      if (!marker) {
        marker = createMarker(gameLayer);
        world.addComponent(entity, 'marker', marker);
      }
      marker.x = Math.round(entity.position!.x);
      marker.y = Math.round(entity.position!.y - (entity.yOffset ?? 0));
      marker.visible = true;
    }
  }
}
