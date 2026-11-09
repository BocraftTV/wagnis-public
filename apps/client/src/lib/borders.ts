// Continent borders for the map drawing: the outline edges that two territories of different continents share.
import type { Shape } from "./geometry.js";
import type { Point } from "./viewport.js";

export interface Segment {
  a: Point;
  b: Point;
}

const pointKey = (p: Point): string => `${p.x},${p.y}`;

/** Edge owners over all rings: edge key -> segment and the territories that have it (once per ring edge). */
function edgeOwners(
  shapes: Record<string, Shape>,
): Map<string, { segment: Segment; ids: string[] }> {
  const owners = new Map<string, { segment: Segment; ids: string[] }>();
  for (const [id, rings] of Object.entries(shapes)) {
    for (const ring of rings) {
      for (let i = 0; i < ring.length; i++) {
        const a = ring[i]!;
        const b = ring[(i + 1) % ring.length]!;
        const k = [pointKey(a), pointKey(b)].sort().join("|");
        const entry = owners.get(k);
        if (entry) entry.ids.push(id);
        else owners.set(k, { segment: { a, b }, ids: [id] });
      }
    }
  }
  return owners;
}

/** Edges shared by exactly two outlines whose territories belong to different continents. */
export function continentBorders(
  shapes: Record<string, Shape>,
  continentOf: Record<string, string>,
): Segment[] {
  const out: Segment[] = [];
  for (const { segment, ids } of edgeOwners(shapes).values()) {
    if (ids.length === 2 && continentOf[ids[0]!] !== continentOf[ids[1]!]) out.push(segment);
  }
  return out;
}

/** Edges that only one outline has: the coast (sea on the other side). */
export function coastSegments(shapes: Record<string, Shape>): Segment[] {
  const out: Segment[] = [];
  for (const { segment, ids } of edgeOwners(shapes).values())
    if (ids.length === 1) out.push(segment);
  return out;
}

/** SVG path data for a list of segments. */
export function segmentsPath(segments: readonly Segment[]): string {
  return segments.map((s) => `M${s.a.x} ${s.a.y}L${s.b.x} ${s.b.y}`).join("");
}

/** The polylines of a sea route between two anchors: one line, or two stubs when the route wraps over the map edge. */
export function routeLines(
  route: { via?: Point[]; wrap?: { a: Point; b: Point } },
  a: Point,
  b: Point,
): Point[][] {
  return route.wrap
    ? [
        [a, route.wrap.a],
        [route.wrap.b, b],
      ]
    : [[a, ...(route.via ?? []), b]];
}

/** SVG path data for polylines. */
export function linesPath(lines: readonly (readonly Point[])[]): string {
  return lines.map((line) => "M" + line.map((p) => `${p.x} ${p.y}`).join("L")).join("");
}
