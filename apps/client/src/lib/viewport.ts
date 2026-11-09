// Pure zoom/pan math for the map. No DOM access: the component feeds in sizes and pointer positions.
// A viewport maps map units (viewBox coordinates) to container pixels: screen = map * scale + translation.

export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

export interface Viewport {
  scale: number;
  tx: number;
  ty: number;
}

export interface ViewportLimits {
  /** Free margin (px) around the map at the fit scale. */
  inset: number;
  /** Largest zoom relative to the fit scale. */
  maxZoom: number;
}

export const DEFAULT_LIMITS: ViewportLimits = { inset: 8, maxZoom: 4 };

export interface TapThresholds {
  /** Largest movement (px) between down and up that still counts as a tap. */
  distance: number;
  /** Longest press (ms) that still counts as a tap. */
  duration: number;
}

export const TAP_THRESHOLDS: TapThresholds = { distance: 10, duration: 350 };

export interface PointerSample extends Point {
  /** Timestamp in ms. */
  t: number;
}

/** Scale at which the whole map is visible inside the container with a margin of `inset` px. */
export function fitScale(container: Size, viewBox: Size, inset: number): number {
  const sx = (container.width - 2 * inset) / viewBox.width;
  const sy = (container.height - 2 * inset) / viewBox.height;
  return Math.max(Math.min(sx, sy), Number.EPSILON);
}

/** The whole map, centered. */
export function fitViewport(container: Size, viewBox: Size, inset: number): Viewport {
  const scale = fitScale(container, viewBox, inset);
  return {
    scale,
    tx: (container.width - viewBox.width * scale) / 2,
    ty: (container.height - viewBox.height * scale) / 2,
  };
}

/** Zoom relative to the fit scale (1 = whole map). */
export function relativeZoom(viewport: Viewport, fit: number): number {
  return viewport.scale / fit;
}

export function toScreen(viewport: Viewport, p: Point): Point {
  return { x: p.x * viewport.scale + viewport.tx, y: p.y * viewport.scale + viewport.ty };
}

export function toMap(viewport: Viewport, p: Point): Point {
  return { x: (p.x - viewport.tx) / viewport.scale, y: (p.y - viewport.ty) / viewport.scale };
}

function clampAxis(t: number, content: number, container: number, inset: number): number {
  if (content + 2 * inset <= container) return (container - content) / 2;
  return Math.min(inset, Math.max(container - inset - content, t));
}

/**
 * Keeps the scale between the fit scale and fit * maxZoom, and the translation so the map never leaves the
 * container (no dragging into empty space). An axis on which the map is smaller than the container is centered.
 */
export function clamp(
  viewport: Viewport,
  container: Size,
  viewBox: Size,
  limits: ViewportLimits = DEFAULT_LIMITS,
): Viewport {
  const fit = fitScale(container, viewBox, limits.inset);
  const scale = Math.min(fit * limits.maxZoom, Math.max(fit, viewport.scale));
  return {
    scale,
    tx: clampAxis(viewport.tx, viewBox.width * scale, container.width, limits.inset),
    ty: clampAxis(viewport.ty, viewBox.height * scale, container.height, limits.inset),
  };
}

/** Zoom by `factor` around a screen point; the map point under `focal` stays under it. Not clamped. */
export function zoomAt(viewport: Viewport, focal: Point, factor: number): Viewport {
  const scale = viewport.scale * factor;
  const m = toMap(viewport, focal);
  return { scale, tx: focal.x - m.x * scale, ty: focal.y - m.y * scale };
}

export function pan(viewport: Viewport, dx: number, dy: number): Viewport {
  return { scale: viewport.scale, tx: viewport.tx + dx, ty: viewport.ty + dy };
}

function mid(a: Point, b: Point): Point {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Two-finger gesture: the viewport at gesture start plus both finger positions then and now give the new
 * viewport. Scale follows the finger distance; the map point under the start midpoint follows the midpoint.
 * Not clamped.
 */
export function pinch(
  startViewport: Viewport,
  startFingers: readonly [Point, Point],
  currentFingers: readonly [Point, Point],
): Viewport {
  const d0 = dist(startFingers[0], startFingers[1]);
  const d1 = dist(currentFingers[0], currentFingers[1]);
  const factor = d0 > 0 && d1 > 0 ? d1 / d0 : 1;
  const scale = startViewport.scale * factor;
  const m = toMap(startViewport, mid(startFingers[0], startFingers[1]));
  const c = mid(currentFingers[0], currentFingers[1]);
  return { scale, tx: c.x - m.x * scale, ty: c.y - m.y * scale };
}

/** A press that moved at most `distance` px and lasted at most `duration` ms is a tap, not a drag. */
export function isTap(
  down: PointerSample,
  up: PointerSample,
  thresholds: TapThresholds = TAP_THRESHOLDS,
): boolean {
  return dist(down, up) <= thresholds.distance && up.t - down.t <= thresholds.duration;
}

/** Share of the maximum zoom from which a double tap goes back to the fit view instead of zooming further. */
const DOUBLE_TAP_RESET_SHARE = 0.75;

/** Double tap: zoom to twice the current scale around the point; close to the maximum, back to the fit view. */
export function doubleTap(
  viewport: Viewport,
  focal: Point,
  container: Size,
  viewBox: Size,
  limits: ViewportLimits = DEFAULT_LIMITS,
): Viewport {
  const fit = fitScale(container, viewBox, limits.inset);
  if (viewport.scale >= fit * limits.maxZoom * DOUBLE_TAP_RESET_SHARE) {
    return fitViewport(container, viewBox, limits.inset);
  }
  return clamp(zoomAt(viewport, focal, 2), container, viewBox, limits);
}

/** Factor to apply around an element's anchor so it keeps its on-screen size at any zoom. */
export function counterScale(viewport: Viewport): number {
  return 1 / viewport.scale;
}

/** Territory names show from this zoom (relative to the fit scale) upwards. */
export function labelVisible(viewport: Viewport, fit: number, threshold: number): boolean {
  return relativeZoom(viewport, fit) >= threshold - 1e-9;
}

/**
 * Container size changed (rotation, resize): the map point at the center of the old container stays at the
 * center of the new one, the relative zoom is kept, and the result is clamped again.
 */
export function refit(
  old: Viewport,
  oldContainer: Size,
  newContainer: Size,
  viewBox: Size,
  limits: ViewportLimits = DEFAULT_LIMITS,
): Viewport {
  const oldFit = fitScale(oldContainer, viewBox, limits.inset);
  const newFit = fitScale(newContainer, viewBox, limits.inset);
  const scale = relativeZoom(old, oldFit) * newFit;
  const center = toMap(old, { x: oldContainer.width / 2, y: oldContainer.height / 2 });
  const moved: Viewport = {
    scale,
    tx: newContainer.width / 2 - center.x * scale,
    ty: newContainer.height / 2 - center.y * scale,
  };
  return clamp(moved, newContainer, viewBox, limits);
}
