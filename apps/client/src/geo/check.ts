// Self-checks of the generated outlines (run when the shapes are built and as `--check`): simple rings, no crossing
// between territories, everything in the viewBox.
import { ringArea } from "./cut.js";
import { minDistance, sharedBorders, touchingPairs, type Rings } from "./notch.js";
import { MAP_HEIGHT, MAP_WIDTH, type Pt } from "./project.js";

const cross = (o: Pt, a: Pt, b: Pt): number =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

/** True if the open segments a-b and c-d cross in a single interior point. */
export function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  const d1 = cross(a, b, c);
  const d2 = cross(a, b, d);
  const d3 = cross(c, d, a);
  const d4 = cross(c, d, b);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

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

export function ringsCross(a: readonly Pt[], b: readonly Pt[]): boolean {
  const ba = box(a);
  const bb = box(b);
  if (ba[0] > bb[2] || bb[0] > ba[2] || ba[1] > bb[3] || bb[1] > ba[3]) return false;
  for (let i = 0; i < a.length; i++)
    for (let j = 0; j < b.length; j++)
      if (segmentsCross(a[i]!, a[(i + 1) % a.length]!, b[j]!, b[(j + 1) % b.length]!)) return true;
  return false;
}

export function isSimple(ring: readonly Pt[]): boolean {
  const n = ring.length;
  if (n < 3 || ringArea(ring) === 0) return false;
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++) {
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      if (segmentsCross(ring[i]!, ring[(i + 1) % n]!, ring[j]!, ring[(j + 1) % n]!)) return false;
    }
  return true;
}

/** Human-readable problems; empty when the outlines are sound. */
export function verifyRings(rings: Rings): string[] {
  const problems: string[] = [];
  const ids = Object.keys(rings);
  for (const id of ids) {
    rings[id]!.forEach((ring, i) => {
      if (!isSimple(ring)) problems.push(`${id} ring ${i}: not a simple ring`);
      for (const p of ring)
        if (p[0] < 0 || p[0] > MAP_WIDTH || p[1] < 0 || p[1] > MAP_HEIGHT)
          problems.push(`${id} ring ${i}: point ${p.join(",")} outside the viewBox`);
      rings[id]!.forEach((other, j) => {
        if (j > i && ringsCross(ring, other)) problems.push(`${id}: rings ${i} and ${j} cross`);
      });
    });
  }
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++)
      for (const ra of rings[ids[i]!]!)
        for (const rb of rings[ids[j]!]!)
          if (ringsCross(ra, rb)) problems.push(`${ids[i]} and ${ids[j]} cross`);
  return [...new Set(problems)];
}

export interface WorldChecks {
  landPairs: ReadonlySet<string>;
  /** Territory pairs without a land border that may touch or come closer than `gap` (with reasons elsewhere). */
  touchExceptions?: ReadonlySet<string>;
  gap: number;
  budget: { vertices: number; perTerritory: number; perRing: number; rings: number };
}

/** Shared-border, gap and budget checks of the finished outlines (needs the engine neighbourhoods, not the source). */
export function verifyWorld(rings: Rings, c: WorldChecks): string[] {
  const problems = verifyRings(rings);
  const ids = Object.keys(rings).sort();
  const lengths = sharedBorders(rings);
  const touching = touchingPairs(rings);
  const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
  for (const pair of c.landPairs) {
    const [a, b] = pair.split("|") as [string, string];
    if ((lengths.get(pair) ?? 0) < 3)
      problems.push(`land border ${pair}: shared border shorter than 3`);
  }
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const pair = pairKey(ids[i]!, ids[j]!);
      if (c.landPairs.has(pair) || c.touchExceptions?.has(pair)) continue;
      if (touching.has(pair)) problems.push(`${pair}: touch without a land border`);
      else {
        const d = minDistance(rings[ids[i]!]!, rings[ids[j]!]!, c.gap);
        if (d && d.d < c.gap - 1e-6)
          problems.push(`${pair}: distance ${d.d.toFixed(2)} below ${c.gap}`);
      }
    }
  let total = 0;
  let count = 0;
  for (const id of ids) {
    const v = rings[id]!.reduce((s, r) => s + r.length, 0);
    total += v;
    count += rings[id]!.length - 1;
    if (v > c.budget.perTerritory)
      problems.push(`${id}: ${v} vertices (budget ${c.budget.perTerritory})`);
    rings[id]!.forEach((r, k) => {
      if (k > 0 && r.length > c.budget.perRing)
        problems.push(`${id} ring ${k}: ${r.length} vertices (budget ${c.budget.perRing})`);
    });
  }
  if (total > c.budget.vertices)
    problems.push(`${total} vertices in all (budget ${c.budget.vertices})`);
  if (count > c.budget.rings) problems.push(`${count} island rings (budget ${c.budget.rings})`);
  return problems;
}
