// Pure hit-area math for the map. The layout gives each territory a cap radius (in map units) around its
// anchor; the effective radius grows with the zoom-out so the area keeps 44 px on screen, but never beyond the cap.
import type { Point } from "./viewport.js";

/** Smallest tap target (px), Apple's guideline and the project rule. */
export const MIN_HIT_PX = 44;

export interface HitSpec {
  /** Largest radius (map units) that still leaves the neighbours' anchors alone. */
  r: number;
  /** Offset of the circle's center from the anchor (map units). */
  dx?: number;
  dy?: number;
}

export interface HitCircle {
  cx: number;
  cy: number;
  /** Radius in map units. */
  r: number;
}

/** The invisible tap circle of a territory at a given scale (px per map unit). */
export function effectiveHit(anchor: Point, hit: HitSpec, scale: number): HitCircle {
  return {
    cx: anchor.x + (hit.dx ?? 0),
    cy: anchor.y + (hit.dy ?? 0),
    r: Math.min(hit.r, MIN_HIT_PX / 2 / scale),
  };
}

/** Diameter of the effective tap circle on screen (px). */
export function hitPixels(hit: HitSpec, scale: number): number {
  return 2 * Math.min(hit.r, MIN_HIT_PX / 2 / scale) * scale;
}

const EPS = 1e-9;

export function meetsMinimum(hit: HitSpec, scale: number): boolean {
  return hitPixels(hit, scale) >= MIN_HIT_PX - EPS;
}

/** IDs whose tap circle stays under 44 px at `scale`, sorted. */
export function belowMinimum(hits: Record<string, HitSpec>, scale: number): string[] {
  return Object.keys(hits)
    .filter((id) => !meetsMinimum(hits[id]!, scale))
    .sort();
}

/** Smallest scale (px per map unit) at which the tap circle reaches 44 px. */
export function scaleForMinimum(hit: HitSpec): number {
  return MIN_HIT_PX / 2 / hit.r;
}

/** Drawing order: large areas first, so small territories end up on top and win overlapping taps. */
export function drawOrder(areas: Record<string, number>): string[] {
  return Object.keys(areas).sort((a, b) => areas[b]! - areas[a]! || (a < b ? -1 : 1));
}

/** Distance from `id`'s hit center to the nearest other anchor. A tap circle up to this radius covers no foreign anchor. */
export function clearance(id: string, anchors: Record<string, Point>, hit?: HitSpec): number {
  const own = anchors[id]!;
  const center = { x: own.x + (hit?.dx ?? 0), y: own.y + (hit?.dy ?? 0) };
  let best = Infinity;
  for (const [other, p] of Object.entries(anchors)) {
    if (other === id) continue;
    best = Math.min(best, Math.hypot(p.x - center.x, p.y - center.y));
  }
  return best;
}
