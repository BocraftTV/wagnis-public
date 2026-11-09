// Contacts between territory outlines, notches (Kerben) and minimum gaps. All rings are in map units; rings of
// neighbours share vertices with identical coordinates, which is how contacts are found.
import { ringArea } from "./cut.js";
import type { Pt } from "./project.js";

export type Rings = Record<string, Pt[][]>;

const key = (p: Pt): string => `${p[0]},${p[1]}`;
const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
const dist = (a: Pt, b: Pt): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

/** Total length of identical edges per territory pair "a|b" (sorted ids): the shared border. */
export function sharedBorders(rings: Rings): Map<string, number> {
  const edges = new Map<string, { id: string; len: number }[]>();
  for (const [id, list] of Object.entries(rings)) {
    for (const ring of list) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % ring.length]!;
        const k = [key(a), key(b)].sort().join("|");
        const entry = edges.get(k) ?? [];
        entry.push({ id, len: dist(a, b) });
        edges.set(k, entry);
      }
    }
  }
  const out = new Map<string, number>();
  for (const owners of edges.values()) {
    if (owners.length !== 2 || owners[0]!.id === owners[1]!.id) continue;
    const k = pairKey(owners[0]!.id, owners[1]!.id);
    out.set(k, (out.get(k) ?? 0) + owners[0]!.len);
  }
  return out;
}

/** Territory pairs that share at least one vertex (a shared edge or a single touching point). */
export function touchingPairs(rings: Rings): Set<string> {
  const owners = new Map<string, Set<string>>();
  for (const [id, list] of Object.entries(rings))
    for (const ring of list)
      for (const p of ring) {
        const s = owners.get(key(p)) ?? new Set<string>();
        s.add(id);
        owners.set(key(p), s);
      }
  const out = new Set<string>();
  for (const s of owners.values()) {
    const ids = [...s].sort();
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) out.add(pairKey(ids[i]!, ids[j]!));
  }
  return out;
}

/**
 * Unit normal pointing into the ring at vertex `i`. Along a shared run (`prevShared`/`nextShared`) it follows the
 * run, so that both sides of a straight border move by the same distance perpendicular to it.
 */
function inwardNormal(
  ring: readonly Pt[],
  i: number,
  sign: number,
  prevShared: boolean,
  nextShared: boolean,
): Pt {
  const prev = ring[(i + ring.length - 1) % ring.length]!;
  const cur = ring[i]!;
  const next = ring[(i + 1) % ring.length]!;
  const [from, to] =
    prevShared && !nextShared
      ? [prev, cur]
      : nextShared && !prevShared
        ? [cur, next]
        : [prev, next];
  const tx = to[0] - from[0];
  const ty = to[1] - from[1];
  const len = Math.hypot(tx, ty) || 1;
  return [(-ty / len) * sign, (tx / len) * sign];
}

/**
 * Notch: pulls the outlines of two territories that touch apart. Every vertex they share is replaced, in the
 * outline of each territory, by a copy moved `gap / 2` into the territory itself. A third territory that meets the
 * pair at such a vertex gets both copies in its outline (a short cap edge of length `gap`).
 * Returns the number of runs of shared vertices that were pulled apart.
 */
export function notch(rings: Rings, a: string, b: string, gap: number): number {
  const keysOf = (id: string): Set<string> =>
    new Set(rings[id]!.flatMap((r) => r.map((p) => key(p))));
  const shared = new Set([...keysOf(a)].filter((k) => keysOf(b).has(k)));
  if (shared.size === 0) return 0;
  const moved = new Map<string, { a: Pt; b: Pt }>();
  let runs = 0;
  const copyOf = (id: string): Map<string, Pt> => {
    const out = new Map<string, Pt>();
    for (const ring of rings[id]!) {
      const sign = Math.sign(ringArea(ring)) || 1;
      let inRun = false;
      for (let i = 0; i < ring.length; i++) {
        const p = ring[i]!;
        const hit = shared.has(key(p));
        if (hit) {
          const shared1 = (j: number) => shared.has(key(ring[(j + ring.length) % ring.length]!));
          const n = inwardNormal(ring, i, sign, shared1(i - 1), shared1(i + 1));
          out.set(key(p), [p[0] + (n[0] * gap) / 2, p[1] + (n[1] * gap) / 2]);
          if (!inRun && id === a) runs++;
        }
        inRun = hit;
      }
    }
    return out;
  };
  const ca = copyOf(a);
  const cb = copyOf(b);
  for (const k of shared) moved.set(k, { a: ca.get(k)!, b: cb.get(k)! });
  for (const [id, list] of Object.entries(rings)) {
    rings[id] = list.map((ring) => {
      const out: Pt[] = [];
      ring.forEach((p, i) => {
        const m = moved.get(key(p));
        if (!m) return out.push(p);
        if (id === a) return out.push(m.a);
        if (id === b) return out.push(m.b);
        const q =
          out.length > 0 ? out[out.length - 1]! : ring[(i + ring.length - 1) % ring.length]!;
        const r = ring[(i + 1) % ring.length]!;
        const forward = dist(q, m.a) + dist(m.b, r);
        const backward = dist(q, m.b) + dist(m.a, r);
        out.push(...(forward <= backward ? [m.a, m.b] : [m.b, m.a]));
      });
      return out;
    });
  }
  return Math.max(runs, 1);
}

function closestOnSegment(p: Pt, a: Pt, b: Pt): { point: Pt; d: number } {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t =
    len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  const point: Pt = [a[0] + t * dx, a[1] + t * dy];
  return { point, d: dist(p, point) };
}

export interface Closest {
  d: number;
  /** The vertex, the closest point on the other outline and the segment ends of that point. */
  vertex: Pt;
  point: Pt;
  segment: [Pt, Pt];
  vertexOf: "a" | "b";
}

/** Smallest distance between the outlines of two territories (vertex to segment, both ways). */
export function minDistance(
  a: readonly (readonly Pt[])[],
  b: readonly (readonly Pt[])[],
  limit = Infinity,
): Closest | null {
  let best: Closest | null = null;
  const box = (r: readonly Pt[]) => {
    let x0 = Infinity,
      y0 = Infinity,
      x1 = -Infinity,
      y1 = -Infinity;
    for (const p of r) {
      x0 = Math.min(x0, p[0]);
      y0 = Math.min(y0, p[1]);
      x1 = Math.max(x1, p[0]);
      y1 = Math.max(y1, p[1]);
    }
    return [x0, y0, x1, y1] as const;
  };
  for (const ra of a) {
    const ba = box(ra);
    for (const rb of b) {
      const bb = box(rb);
      const bound = Math.min(limit, best?.d ?? Infinity);
      if (
        ba[0] > bb[2] + bound ||
        bb[0] > ba[2] + bound ||
        ba[1] > bb[3] + bound ||
        bb[1] > ba[3] + bound
      )
        continue;
      for (const [r1, r2, which] of [
        [ra, rb, "a"],
        [rb, ra, "b"],
      ] as const) {
        for (const p of r1) {
          for (let j = 0; j < r2.length; j++) {
            const s0 = r2[j]!;
            const s1 = r2[(j + 1) % r2.length]!;
            const { point, d } = closestOnSegment(p, s0, s1);
            if (!best || d < best.d)
              best = { d, vertex: p, point, segment: [s0, s1], vertexOf: which };
          }
        }
      }
    }
  }
  return best;
}

/**
 * Pushes the outlines of the given pairs apart until they keep `gap` distance. Vertices move together with every
 * outline that has the same vertex, so shared borders stay shared. Returns the pairs that could not be separated.
 */
export function enforceGaps(
  rings: Rings,
  pairs: readonly string[],
  gap: number,
  rounds = 40,
): string[] {
  for (let round = 0; round < rounds; round++) {
    const offsets = new Map<string, [number, number]>();
    let any = false;
    for (const pk of pairs) {
      const [x, y] = pk.split("|") as [string, string];
      const c = minDistance(rings[x] ?? [], rings[y] ?? [], gap);
      if (!c || c.d >= gap - 1e-6 || c.d < 1e-9) continue;
      any = true;
      const deficit = gap - c.d + 0.02;
      const ux = (c.vertex[0] - c.point[0]) / c.d;
      const uy = (c.vertex[1] - c.point[1]) / c.d;
      const push = (p: Pt, s: number) => {
        const o = offsets.get(key(p)) ?? [0, 0];
        offsets.set(key(p), [o[0] + ux * s, o[1] + uy * s]);
      };
      push(c.vertex, deficit / 2);
      push(c.segment[0], -deficit / 2);
      push(c.segment[1], -deficit / 2);
    }
    if (!any) return [];
    for (const [id, list] of Object.entries(rings))
      rings[id] = list.map((ring) =>
        ring.map((p) => {
          const o = offsets.get(key(p));
          return o ? ([p[0] + o[0], p[1] + o[1]] as Pt) : p;
        }),
      );
  }
  return pairs.filter((pk) => {
    const [x, y] = pk.split("|") as [string, string];
    const c = minDistance(rings[x] ?? [], rings[y] ?? [], gap);
    return c !== null && c.d < gap - 1e-3 && c.d > 1e-9;
  });
}
