// Applies the country -> territory table (welt.regions.ts) to the Natural Earth features: shifts the rings across the
// date line, clips them to the map window, drops the rings the table drops and splits countries along cut lines.
// Pipeline only (scripts and tests); the app never imports from geo/.
import { ringArea, splitAtLine } from "./cut.js";
import { LAT_BOTTOM, LAT_TOP, LON_LEFT, LON_RIGHT, type Pt, type Ring } from "./project.js";

/** A territory id, `null` (dropped), or a cut: `left`/`right` are the sides of the line from `from` to `to`. */
export type Target = string | null | { cut: readonly [Pt, Pt]; left: Target; right: Target };

/** Window in degrees: [lonMin, latMin, lonMax, latMax]. */
export type Window = readonly [number, number, number, number];

export interface RingRule {
  /** Applies to rings whose bounding-box centre lies in this window. */
  in: Window;
  to: Target;
  /** Drop the ring when its area is below this value (map units squared, no lens; rough). */
  minArea?: number;
}

export interface CountryRule {
  /** Target for all rings that match no ring rule. */
  all: Target;
  rings?: readonly RingRule[];
  /** Rings entirely west of -100 degrees are moved east by 360 degrees (Russia and Fiji across the date line). */
  shift360?: boolean;
}

export interface Feature {
  properties: { ADM0_A3: string };
  geometry: { type: "Polygon" | "MultiPolygon"; coordinates: number[][][] | number[][][][] };
}

/** Degrees squared to map units squared at the plain projection (2.78 units per degree of longitude, 3.9 of latitude). */
const UNITS_PER_DEG2 = (1000 / 360) * (540 / 139);

/** Outer rings of a feature. Holes are skipped: the only enclave of the source (Lesotho) belongs to the same territory. */
export function featureRings(f: Feature): Ring[] {
  const polys =
    f.geometry.type === "Polygon"
      ? [f.geometry.coordinates as number[][][]]
      : (f.geometry.coordinates as number[][][][]);
  return polys.map((p) => p[0]!.map((c) => [c[0]!, c[1]!] as Pt));
}

/** Parts of a ring inside the map window. */
export function clipToWindow(ring: Ring): Pt[][] {
  let parts: Pt[][] = [[...ring]];
  const lines: [Pt, Pt, "left" | "right"][] = [
    [[LON_LEFT, 0], [LON_LEFT, 1], "right"], // keep east of the left edge
    [[LON_RIGHT, 0], [LON_RIGHT, 1], "left"], // keep west of the right edge
    [[0, LAT_TOP], [1, LAT_TOP], "right"], // keep south of the top edge (direction east: right is south)
    [[0, LAT_BOTTOM], [1, LAT_BOTTOM], "left"], // keep north of the bottom edge
  ];
  for (const [a, b, keep] of lines) {
    parts = parts.flatMap((p) => splitAtLine(p, a, b)[keep]);
  }
  return parts.filter((p) => p.length >= 3 && Math.abs(ringArea(p)) > 1e-9);
}

function centre(ring: Ring): Pt {
  const xs = ring.map((p) => p[0]);
  const ys = ring.map((p) => p[1]);
  return [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...ys) + Math.max(...ys)) / 2];
}

function resolve(target: Target, ring: Ring, out: (id: string, ring: Ring) => void): void {
  if (target === null) return;
  if (typeof target === "string") return out(target, ring);
  const { left, right } = splitAtLine(ring, target.cut[0], target.cut[1]);
  for (const r of left) resolve(target.left, r, out);
  for (const r of right) resolve(target.right, r, out);
}

/** Territory id -> rings in degrees for the given countries. Throws for a country without a rule. */
export function assignCountries(
  features: readonly Feature[],
  rules: Readonly<Record<string, CountryRule | string | null>>,
): { rings: Record<string, Pt[][]>; unassigned: string[] } {
  const rings: Record<string, Pt[][]> = {};
  const unassigned: string[] = [];
  for (const f of features) {
    const code = f.properties.ADM0_A3;
    const raw = rules[code];
    if (raw === undefined) {
      unassigned.push(code);
      continue;
    }
    const rule: CountryRule = typeof raw === "object" && raw !== null ? raw : { all: raw };
    for (const original of featureRings(f)) {
      let ring: Ring = original;
      if (rule.shift360 && Math.max(...ring.map((p) => p[0])) < -100)
        ring = ring.map((p) => [p[0] + 360, p[1]] as Pt);
      const [cx, cy] = centre(ring);
      const hit = rule.rings?.find(
        (r) => cx >= r.in[0] && cx <= r.in[2] && cy >= r.in[1] && cy <= r.in[3],
      );
      const target = hit ? hit.to : rule.all;
      for (const part of clipToWindow(ring)) {
        if (hit?.minArea !== undefined && Math.abs(ringArea(part)) * UNITS_PER_DEG2 < hit.minArea)
          continue;
        resolve(target, part, (id, r) => (rings[id] ??= []).push([...r]));
      }
    }
  }
  return { rings, unassigned };
}
