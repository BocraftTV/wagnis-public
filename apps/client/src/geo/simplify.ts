// Line smoothing and simplification for open arcs (end points stay fixed).
import type { Pt } from "./project.js";

/** One pass of a moving three-point average (weight w on each neighbour); the end points do not move. */
export function smooth(points: readonly Pt[], w = 0.25): Pt[] {
  if (points.length < 3) return [...points];
  return points.map((p, i) => {
    if (i === 0 || i === points.length - 1) return p;
    const a = points[i - 1]!;
    const b = points[i + 1]!;
    return [p[0] * (1 - 2 * w) + (a[0] + b[0]) * w, p[1] * (1 - 2 * w) + (a[1] + b[1]) * w] as Pt;
  });
}

function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/** Douglas-Peucker with tolerance `eps` (map units); first and last point are kept. */
export function douglasPeucker(points: readonly Pt[], eps: number): Pt[] {
  if (points.length < 3) return [...points];
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[points.length - 1] = 1;
  const stack: [number, number][] = [[0, points.length - 1]];
  while (stack.length > 0) {
    const [lo, hi] = stack.pop()!;
    let far = -1;
    let farDist = eps;
    for (let i = lo + 1; i < hi; i++) {
      const d = distToSegment(points[i]!, points[lo]!, points[hi]!);
      if (d > farDist) {
        far = i;
        farDist = d;
      }
    }
    if (far >= 0) {
      keep[far] = 1;
      stack.push([lo, far], [far, hi]);
    }
  }
  return points.filter((_, i) => keep[i] === 1);
}
