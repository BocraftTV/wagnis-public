// Anchor proposals for the army counters: the pole of inaccessibility of the main ring, then a repair loop that moves
// the counters of the closest pairs apart (inside their own main ring, with clearance to the coast). The proposals
// are an aid: the anchors in maps/welt.layout.ts are set by hand from this report.
import { ringArea } from "./cut.js";
import { poleOfInaccessibility, signedDistance } from "./pole.js";
import type { Pt, Ring } from "./project.js";

export interface AnchorOptions {
  /** Wanted distance between any two anchors (map units). */
  minDistance: number;
  /** Clearance of the anchor to the outline for large territories (area above `largeArea`). */
  clearance: number;
  largeArea?: number;
  step?: number;
  /** Anchors that stay where they are (e.g. set by hand). */
  fixed?: Readonly<Record<string, Pt>>;
}

export interface AnchorResult {
  anchors: Record<string, Pt>;
  /** Pairs below the wanted distance after the repair, with their distance. */
  tight: { a: string; b: string; d: number }[];
}

const dist = (a: Pt, b: Pt): number => Math.hypot(a[0] - b[0], a[1] - b[1]);

export function suggestAnchors(
  rings: Readonly<Record<string, readonly Ring[]>>,
  o: AnchorOptions,
): AnchorResult {
  const ids = Object.keys(rings);
  const step = o.step ?? 1.5;
  const pole: Record<string, { point: Pt; distance: number }> = {};
  const candidates: Record<string, Pt[]> = {};
  for (const id of ids) {
    const main = rings[id]![0]!;
    const p = poleOfInaccessibility([main], 2);
    pole[id] = p;
    const need =
      Math.abs(ringArea(main)) > (o.largeArea ?? 600)
        ? o.clearance
        : Math.min(o.clearance, p.distance * 0.6);
    const xs = main.map((q) => q[0]);
    const ys = main.map((q) => q[1]);
    const list: Pt[] = [];
    for (let x = Math.min(...xs); x <= Math.max(...xs); x += step)
      for (let y = Math.min(...ys); y <= Math.max(...ys); y += step)
        if (signedDistance([x, y], [main]) >= need) list.push([x, y]);
    candidates[id] = list.length > 0 ? list : [p.point];
  }
  const anchors: Record<string, Pt> = {};
  for (const id of ids) anchors[id] = o.fixed?.[id] ?? pole[id]!.point;
  const nearest = (id: string, at: Pt): number => {
    let best = Infinity;
    for (const other of ids) if (other !== id) best = Math.min(best, dist(at, anchors[other]!));
    return best;
  };
  const stuck = new Set<string>();
  for (let iter = 0; iter < 600; iter++) {
    let worst: { a: string; b: string; d: number } | null = null;
    for (let i = 0; i < ids.length; i++)
      for (let j = i + 1; j < ids.length; j++) {
        const d = dist(anchors[ids[i]!]!, anchors[ids[j]!]!);
        const key = `${ids[i]}|${ids[j]}`;
        if (d < o.minDistance && !stuck.has(key) && (!worst || d < worst.d))
          worst = { a: ids[i]!, b: ids[j]!, d };
      }
    if (!worst) break;
    let bestMove: { id: string; at: Pt; value: number } | null = null;
    for (const id of [worst.a, worst.b]) {
      if (o.fixed?.[id]) continue;
      const cur = nearest(id, anchors[id]!);
      for (const c of candidates[id]!) {
        // prefer far from everyone, but stay central: penalise the distance from the pole slightly
        const value = Math.min(nearest(id, c), o.minDistance + 6) - 0.04 * dist(c, pole[id]!.point);
        if (value > cur + 1e-6 && (!bestMove || value > bestMove.value))
          bestMove = { id, at: c, value };
      }
    }
    if (!bestMove) stuck.add(`${worst.a}|${worst.b}`);
    else anchors[bestMove.id] = bestMove.at;
  }
  const tight: AnchorResult["tight"] = [];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++) {
      const d = dist(anchors[ids[i]!]!, anchors[ids[j]!]!);
      if (d < o.minDistance) tight.push({ a: ids[i]!, b: ids[j]!, d });
    }
  return { anchors, tight: tight.sort((p, q) => p.d - q.d) };
}
