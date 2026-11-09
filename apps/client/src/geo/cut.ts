// Splitting a simple ring along a straight line (a "cut line" between two territories of one country).
// Not clipping: crossings are sorted along the line and joined pairwise, so rugged coasts give no zero-width bridges.
import type { Pt, Ring } from "./project.js";

export function ringArea(ring: Ring): number {
  let s = 0;
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i]!;
    const b = ring[(i + 1) % ring.length]!;
    s += a[0] * b[1] - b[0] * a[1];
  }
  return s / 2;
}

/**
 * Splits `ring` along the infinite line through `a` and `b`. `left` is the side to the left of the direction a -> b
 * (points exactly on the line count as left), `right` the other one. Both sides share the same cut points.
 */
export function splitAtLine(ring: Ring, a: Pt, b: Pt): { left: Pt[][]; right: Pt[][] } {
  const n = ring.length;
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len = Math.hypot(dx, dy);
  const side = (p: Pt): number => (dx * (p[1] - a[1]) - dy * (p[0] - a[0])) / len;
  const right = (p: Pt): boolean => side(p) < -1e-9;
  // Crossings in ring order: edge index i means the edge ring[i] -> ring[i+1].
  const edges: number[] = [];
  for (let i = 0; i < n; i++) if (right(ring[i]!) !== right(ring[(i + 1) % n]!)) edges.push(i);
  if (edges.length === 0)
    return right(ring[0]!) ? { left: [], right: [[...ring]] } : { left: [[...ring]], right: [] };

  const cuts: Pt[] = edges.map((i) => {
    const p = ring[i]!;
    const q = ring[(i + 1) % n]!;
    const s0 = side(p);
    const s1 = side(q);
    const t = s0 / (s0 - s1);
    return [p[0] + t * (q[0] - p[0]), p[1] + t * (q[1] - p[1])] as Pt;
  });
  const along = cuts.map((c) => (c[0] - a[0]) * dx + (c[1] - a[1]) * dy);
  const m = edges.length;
  // Even-odd pairing along the line: the segment between sorted crossing 2k and 2k+1 lies inside the ring.
  const order = [...along.keys()].sort((p, q) => along[p]! - along[q]!);
  const partner = new Array<number>(m);
  for (let k = 0; k + 1 < m; k += 2) {
    partner[order[k]!] = order[k + 1]!;
    partner[order[k + 1]!] = order[k]!;
  }
  // Chain k runs from crossing k to crossing k+1 (ring order) and lies on one side.
  const chain = (k: number): Pt[] => {
    const out: Pt[] = [cuts[k]!];
    const end = edges[(k + 1) % m]!;
    for (let i = (edges[k]! + 1) % n; ; i = (i + 1) % n) {
      out.push(ring[i]!);
      if (i === end) break;
    }
    out.push(cuts[(k + 1) % m]!);
    return out;
  };
  const used = new Set<number>();
  const parts = { left: [] as Pt[][], right: [] as Pt[][] };
  for (let k0 = 0; k0 < m; k0++) {
    if (used.has(k0)) continue;
    const part: Pt[] = [];
    let k = k0;
    for (let guard = 0; guard <= m; guard++) {
      used.add(k);
      part.push(...chain(k));
      k = partner[(k + 1) % m]!;
      if (k === k0) break;
    }
    const side0 = right(ring[(edges[k0]! + 1) % n]!) ? parts.right : parts.left;
    side0.push(
      part.filter((p, i) => i === 0 || p[0] !== part[i - 1]![0] || p[1] !== part[i - 1]![1]),
    );
  }
  return parts;
}

/** Returns the parts of `ring` west and east of the line x = c (both sides share the same cut points). */
export function splitAtVertical(ring: Ring, c: number): { west: Pt[][]; east: Pt[][] } {
  const { left, right } = splitAtLine(ring, [c, 0], [c, 1]);
  return { west: left, east: right };
}
