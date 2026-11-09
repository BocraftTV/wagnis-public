// Stacking order of the map layers, as pure data, so tests can prove which territory a tap reaches.
// Tap circles are larger than the counters and overlap their neighbours at the fit scale; the counters therefore
// sit above all tap circles, and within a layer small territories sit above large ones.
import { pointInShape, type Shape } from "./geometry.js";
import { drawOrder, effectiveHit } from "./hit.js";
import type { HitSpec } from "./hit.js";
import type { Point } from "./viewport.js";

/** Bottom to top. Layers not in `TAP_LAYERS` never receive pointer events. */
export const MAP_LAYERS = [
  "backdrop",
  "halo",
  "polygons",
  "texture",
  "lines",
  "links",
  "hits",
  "rings",
  "counters",
  "labels",
] as const;
export type MapLayer = (typeof MAP_LAYERS)[number];

/** Layers whose elements take taps, bottom to top. */
export const TAP_LAYERS: readonly MapLayer[] = ["polygons", "hits", "counters"];

/** Army counter radius on screen (px); it keeps this size at any zoom. */
export const COUNTER_RADIUS_PX = 16;

/** Stacking within a layer, bottom to top: large areas first, small territories on top. */
export function stackOrder(areas: Record<string, number>): string[] {
  return drawOrder(areas);
}

export interface TapModel {
  /** Bottom to top (see `stackOrder`). */
  stack: readonly string[];
  anchors: Record<string, Point>;
  hits: Record<string, HitSpec>;
  /** Outline per territory; territories without one are tapped through counter and circle only. */
  shapes: Record<string, Shape>;
}

/**
 * The territory a tap at `p` (map units) reaches at `scale` (px per map unit), or `null`. Mirrors the browser's
 * hit test: layers top to bottom, within a layer the topmost (last drawn) element first.
 */
export function territoryAt(model: TapModel, p: Point, scale: number): string | null {
  for (let l = TAP_LAYERS.length - 1; l >= 0; l--) {
    const layer = TAP_LAYERS[l]!;
    for (let i = model.stack.length - 1; i >= 0; i--) {
      const id = model.stack[i]!;
      if (layer === "counters") {
        const a = model.anchors[id]!;
        if (Math.hypot(p.x - a.x, p.y - a.y) <= COUNTER_RADIUS_PX / scale) return id;
      } else if (layer === "hits") {
        const c = effectiveHit(model.anchors[id]!, model.hits[id]!, scale);
        if (Math.hypot(p.x - c.cx, p.y - c.cy) <= c.r) return id;
      } else {
        const shape = model.shapes[id];
        if (shape && pointInShape(p, shape)) return id;
      }
    }
  }
  return null;
}
