// The whole pipeline in one function: Natural Earth features -> outlines of the 42 territories (map units).
// Used by scripts/build-world-shapes.mjs and by the tests of geo/. Pure; the caller reads the file.
import { buildTerritories } from "./arcs.js";
import { assignCountries, type CountryRule, type Feature } from "./assign.js";
import { ringArea } from "./cut.js";
import type { Lens } from "./lens.js";
import { applyLenses } from "./lens.js";
import {
  enforceGaps,
  minDistance,
  notch,
  sharedBorders,
  touchingPairs,
  type Rings,
} from "./notch.js";
import { project, type Pt } from "./project.js";

export interface WorldOptions {
  territories: readonly string[];
  /** Pairs "a|b" with a land border in the engine; everything else must stay apart. */
  landPairs: ReadonlySet<string>;
  countries: Readonly<Record<string, CountryRule | string | null>>;
  lenses: readonly Lens[];
  epsilon: number;
  gap: number;
  kerbeMax: number;
  islandMinArea: (id: string) => number;
  /** Rings that stay however small: the ring of `id` nearest to this point (degrees). */
  keepIslands?: readonly { id: string; at: Pt }[];
  /** Hand-made rings per territory in degrees, added to those of the source. */
  extraRings?: Readonly<Record<string, readonly (readonly Pt[])[]>>;
}

export interface WorldResult {
  rings: Rings;
  /** Notches that were cut: pair and number of runs. */
  notches: { pair: string; runs: number; length: number }[];
  /** Touches without a land border that are longer than `kerbeMax` (not changed). */
  longTouches: { pair: string; length: number }[];
  /** Pairs that could not be pulled apart to `gap`. */
  tooClose: string[];
  /** Rings dropped for being smaller than the minimum. */
  droppedIslands: { id: string; area: number }[];
  unassigned: string[];
}

const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);
const round1 = (v: number): number => Math.round(v * 10) / 10;

export function buildWorld(features: readonly Feature[], o: WorldOptions): WorldResult {
  const { rings: assigned, unassigned } = assignCountries(features, o.countries);
  const lens = (lon: number, lat: number): Pt => applyLenses(project(lon, lat), o.lenses);
  const built = buildTerritories(
    o.territories.map((id) => ({
      id,
      rings: [...(assigned[id] ?? []), ...(o.extraRings?.[id] ?? [])],
    })),
    { project: lens, epsilon: o.epsilon, smooth: 0.25 },
  );
  const rings: Rings = {};
  const droppedIslands: { id: string; area: number }[] = [];
  for (const id of o.territories) {
    const keep = (o.keepIslands ?? [])
      .filter((k) => k.id === id)
      .map((k) => lens(k.at[0], k.at[1]));
    rings[id] = built.rings[id]!.filter((ring, i) => {
      const area = Math.abs(ringArea(ring));
      if (i === 0 || area >= o.islandMinArea(id)) return true;
      const xs = ring.map((p) => p[0]);
      const ys = ring.map((p) => p[1]);
      const near = keep.some(
        (k) =>
          k[0] >= Math.min(...xs) - 3 &&
          k[0] <= Math.max(...xs) + 3 &&
          k[1] >= Math.min(...ys) - 3 &&
          k[1] <= Math.max(...ys) + 3,
      );
      if (!near) droppedIslands.push({ id, area });
      return near;
    });
  }

  const notches: WorldResult["notches"] = [];
  const longTouches: WorldResult["longTouches"] = [];
  const lengths = sharedBorders(rings);
  for (const pair of [...touchingPairs(rings)].sort()) {
    if (o.landPairs.has(pair)) continue;
    const [a, b] = pair.split("|") as [string, string];
    const length = lengths.get(pair) ?? 0;
    if (length > o.kerbeMax) {
      longTouches.push({ pair, length });
      continue;
    }
    notches.push({ pair, runs: notch(rings, a, b, o.gap + 0.2), length });
  }
  const apart: string[] = [];
  for (let i = 0; i < o.territories.length; i++)
    for (let j = i + 1; j < o.territories.length; j++) {
      const pair = pairKey(o.territories[i]!, o.territories[j]!);
      if (!o.landPairs.has(pair) && !longTouches.some((t) => t.pair === pair)) apart.push(pair);
    }
  const roundAll = (): void => {
    for (const id of o.territories)
      rings[id] = rings[id]!.map((ring) => ring.map((p) => [round1(p[0]), round1(p[1])] as Pt));
  };
  const tooClose = (): string[] =>
    apart.filter((pair) => {
      const [a, b] = pair.split("|") as [string, string];
      const c = minDistance(rings[a]!, rings[b]!, o.gap);
      return c !== null && c.d < o.gap - 1e-6 && c.d > 1e-9;
    });
  // Rounding to the 0.1 grid can eat into a gap: push apart with a reserve and round again until it holds.
  roundAll();
  for (let pass = 0; pass < 8 && tooClose().length > 0; pass++) {
    enforceGaps(rings, tooClose(), o.gap + 0.25);
    roundAll();
  }
  // Islands that rounding pushed below the minimum area go as well.
  for (const id of o.territories) {
    const keep = (o.keepIslands ?? [])
      .filter((k) => k.id === id)
      .map((k) => lens(k.at[0], k.at[1]));
    rings[id] = rings[id]!.filter((ring, i) => {
      if (i === 0 || Math.abs(ringArea(ring)) >= o.islandMinArea(id)) return true;
      return keep.some((k) => ring.some((p) => Math.hypot(p[0] - k[0], p[1] - k[1]) < 6));
    });
  }
  return { rings, notches, longTouches, tooClose: tooClose(), droppedIslands, unassigned };
}
