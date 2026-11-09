// Small pure geometry helpers for the map drawing (polygon checks, label and counter overlap).
import type { Point } from "./viewport.js";

export interface Rect {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** A territory outline: a list of rings, main part first, then islands. */
export type Shape = readonly (readonly Point[])[];

/** Sum of the ring areas. */
export function shapeArea(shape: Shape): number {
  return shape.reduce((sum, ring) => sum + polygonArea(ring), 0);
}

/** Point in one of the rings. */
export function pointInShape(p: Point, shape: Shape): boolean {
  return shape.some((ring) => pointInPolygon(p, ring));
}

/** SVG path data of a shape: one closed sub-path per ring. */
export function shapePath(shape: Shape): string {
  return shape.map((ring) => `M${ring.map((p) => `${p.x} ${p.y}`).join("L")}Z`).join("");
}

/** Absolute polygon area (shoelace). */
export function polygonArea(ring: readonly Point[]): number {
  let sum = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}

/** Even-odd point-in-polygon test. */
export function pointInPolygon(p: Point, ring: readonly Point[]): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

function cross(o: Point, a: Point, b: Point): number {
  return (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
}

/** True if the open segments a-b and c-d cross in a single interior point (touching ends do not count). */
export function segmentsCross(a: Point, b: Point, c: Point, d: Point): boolean {
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** A ring is simple if it has an area and no two non-adjacent edges cross. */
export function isSimpleRing(ring: readonly Point[]): boolean {
  if (ring.length < 3 || polygonArea(ring) === 0) return false;
  const n = ring.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsCross(ring[i]!, ring[(i + 1) % n]!, ring[j]!, ring[(j + 1) % n]!)) return false;
    }
  }
  return true;
}

/** True if any edge of `a` properly crosses any edge of `b`. */
export function ringsCross(a: readonly Point[], b: readonly Point[]): boolean {
  for (let i = 0; i < a.length; i++) {
    for (let j = 0; j < b.length; j++) {
      if (segmentsCross(a[i]!, a[(i + 1) % a.length]!, b[j]!, b[(j + 1) % b.length]!)) return true;
    }
  }
  return false;
}

export function rectsOverlap(a: Rect, b: Rect): boolean {
  return a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;
}

/** True if the circle and the rectangle share area. */
export function circleOverlapsRect(c: Point, r: number, rect: Rect): boolean {
  const nx = Math.min(rect.right, Math.max(rect.left, c.x));
  const ny = Math.min(rect.bottom, Math.max(rect.top, c.y));
  return Math.hypot(c.x - nx, c.y - ny) < r;
}

export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
