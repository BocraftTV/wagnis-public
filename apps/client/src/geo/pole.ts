// Pole of inaccessibility: the point inside a shape farthest from its outline (a good place for the army counter).
import type { Pt, Ring } from "./project.js";

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Signed distance: positive inside (even-odd over all rings), negative outside. */
export function signedDistance(p: Pt, rings: readonly Ring[]): number {
  let inside = false;
  let best = Infinity;
  for (const ring of rings) {
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
      const a = ring[i]!;
      const b = ring[j]!;
      if (
        a[1] > p[1] !== b[1] > p[1] &&
        p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0]
      )
        inside = !inside;
      best = Math.min(best, distToSegment(p, a, b));
    }
  }
  return inside ? best : -best;
}

/** Grid search with three refinement rounds. Returns the point and its distance to the outline. */
export function poleOfInaccessibility(
  rings: readonly Ring[],
  step = 2,
): { point: Pt; distance: number } {
  const main = rings[0];
  if (!main) throw new Error("no rings");
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of main) {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  }
  let best: { point: Pt; distance: number } = {
    point: [(minX + maxX) / 2, (minY + maxY) / 2],
    distance: -Infinity,
  };
  let [x0, y0, x1, y1] = [minX, minY, maxX, maxY];
  let s = step;
  for (let round = 0; round < 4; round++) {
    for (let x = x0; x <= x1; x += s) {
      for (let y = y0; y <= y1; y += s) {
        const d = signedDistance([x, y], rings);
        if (d > best.distance) best = { point: [x, y], distance: d };
      }
    }
    [x0, y0, x1, y1] = [best.point[0] - s, best.point[1] - s, best.point[0] + s, best.point[1] + s];
    s /= 4;
  }
  return best;
}
