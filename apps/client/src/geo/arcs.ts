// Topology: builds territory outlines from country rings so that borders between two territories are one shared arc.
// Input rings are in degrees (lon/lat), already assigned to a territory id. Steps: snap nodes to the 0.01 degree
// grid, cancel edges inside a territory (borders between countries of the same group), chain the remaining edges
// into rings, cut the rings into arcs wherever the neighbour on the other side changes, project and simplify each
// arc once (in a canonical direction) and reuse it for both sides.
import { gridKey, type Pt, type Ring } from "./project.js";
import { ringArea } from "./cut.js";
import { douglasPeucker, smooth } from "./simplify.js";

export interface RegionInput {
  id: string;
  /** Rings in degrees; orientation does not matter. */
  rings: readonly Ring[];
}

export interface BuildOptions {
  /** Degrees to map units, including any lens. Must be a pure function of its arguments. */
  project: (lon: number, lat: number) => Pt;
  /** Douglas-Peucker tolerance in map units. */
  epsilon: number;
  /** Weight of the smoothing pass (0 = off). */
  smooth?: number;
}

export interface BuildResult {
  /** Outline rings per territory in map units, largest ring first. */
  rings: Record<string, Pt[][]>;
  /** Length of shared border per pair "a|b" (sorted ids), in map units. */
  contacts: Map<string, number>;
  /** Rings that vanished in simplification (fewer than 3 points). */
  dropped: number;
}

const parseKey = (k: string): Pt => {
  const [a, b] = k.split(",");
  return [Number(a) / 100, Number(b) / 100];
};

function orientCcw(keys: string[]): string[] {
  const pts = keys.map(parseKey);
  return ringArea(pts) < 0 ? [...keys].reverse() : keys;
}

/** Distance (in grid cells of 0.01 degrees) within which a node counts as lying on a foreign edge. */
const NODE_ON_EDGE = 0.8;

/**
 * Inserts every node that lies on the inside of an edge of another ring into that edge (T-junctions). A cut line
 * ends on the border of a neighbouring country, whose edge then needs the cut point as a node, or the two sides
 * of the border would no longer match edge by edge.
 */
export function insertJunctions(rings: readonly string[][]): string[][] {
  const CELL = 64;
  const coords = new Map<string, [number, number]>();
  const buckets = new Map<string, string[]>();
  rings.forEach((ring) => {
    for (const k of ring) {
      if (coords.has(k)) continue;
      const [x, y] = k.split(",").map(Number) as [number, number];
      coords.set(k, [x, y]);
      const bk = `${Math.floor(x / CELL)},${Math.floor(y / CELL)}`;
      const list = buckets.get(bk);
      if (list) list.push(k);
      else buckets.set(bk, [k]);
    }
  });
  return rings.map((ring) => {
    const own = new Set(ring);
    const out: string[] = [];
    for (let i = 0; i < ring.length; i++) {
      const ka = ring[i]!;
      const kb = ring[(i + 1) % ring.length]!;
      out.push(ka);
      const [ax, ay] = coords.get(ka)!;
      const [bx, by] = coords.get(kb)!;
      const found: { t: number; key: string }[] = [];
      const dx = bx - ax;
      const dy = by - ay;
      const len2 = dx * dx + dy * dy;
      if (len2 === 0) continue;
      const x0 = Math.floor((Math.min(ax, bx) - 1) / CELL);
      const x1 = Math.floor((Math.max(ax, bx) + 1) / CELL);
      const y0 = Math.floor((Math.min(ay, by) - 1) / CELL);
      const y1 = Math.floor((Math.max(ay, by) + 1) / CELL);
      for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
          for (const k of buckets.get(`${cx},${cy}`) ?? []) {
            if (own.has(k)) continue;
            const [px, py] = coords.get(k)!;
            const t = ((px - ax) * dx + (py - ay) * dy) / len2;
            if (t <= 0 || t >= 1) continue;
            if (Math.hypot(px - (ax + t * dx), py - (ay + t * dy)) <= NODE_ON_EDGE)
              found.push({ t, key: k });
          }
        }
      }
      found.sort((p, q) => p.t - q.t);
      for (const f of found) out.push(f.key);
    }
    return out;
  });
}

/**
 * Removes zero-width spikes: where a ring runs out along a line and back on the same line, the tip is dropped.
 * Natural Earth has such wedges (the Kafia Kingi tip of Sudan), where a node of one country lies on the edge of another.
 */
export function removeSpikes(ring: readonly string[]): string[] {
  let keys = [...ring];
  for (let again = true; again && keys.length > 3;) {
    again = false;
    for (let i = 0; i < keys.length; i++) {
      const n = keys.length;
      const [px, py] = parseKey(keys[(i + n - 1) % n]!).map((v) => v * 100) as [number, number];
      const [cx, cy] = parseKey(keys[i]!).map((v) => v * 100) as [number, number];
      const [nx, ny] = parseKey(keys[(i + 1) % n]!).map((v) => v * 100) as [number, number];
      const ux = cx - px;
      const uy = cy - py;
      const vx = nx - cx;
      const vy = ny - cy;
      const lu = Math.hypot(ux, uy);
      const lv = Math.hypot(vx, vy);
      if (lu === 0 || lv === 0) continue;
      const reversing = ux * vx + uy * vy < 0;
      const offLine = Math.abs(ux * vy - uy * vx) / Math.max(lu, lv);
      if (reversing && offLine <= NODE_ON_EDGE) {
        keys.splice(i, 1);
        again = true;
        break;
      }
    }
  }
  return keys;
}

export function buildTerritories(regions: readonly RegionInput[], opts: BuildOptions): BuildResult {
  const owner = outerEdges(regions);
  const outgoing = outgoingByRegion(owner);
  const simplifyArc = arcSimplifier(opts);
  const result: Record<string, Pt[][]> = {};
  const contacts = new Map<string, number>();
  let dropped = 0;
  for (const region of regions) {
    const rings: Pt[][] = [];
    for (const ring of chainRings(outgoing.get(region.id) ?? new Map<string, string[]>())) {
      // 3. Label every edge with the neighbour on the other side, cut into arcs where it changes.
      const label = (i: number): string =>
        owner.get(`${ring[(i + 1) % ring.length]!}>${ring[i]!}`) ?? "";
      const pts: Pt[] = [];
      for (const run of arcRuns(ring, label)) {
        const arc = simplifyArc(run.nodes);
        pts.push(...arc.slice(0, -1));
        if (run.other !== "" && region.id < run.other) {
          const pair = `${region.id}|${run.other}`;
          contacts.set(pair, (contacts.get(pair) ?? 0) + lineLength(arc));
        }
      }
      if (pts.length < 3) dropped++;
      else rings.push(pts);
    }
    rings.sort((a, b) => Math.abs(ringArea(b)) - Math.abs(ringArea(a)));
    result[region.id] = rings;
  }
  return { rings: result, contacts, dropped };
}

/**
 * 1. Directed edges per territory with cancellation of inner borders. Returns the outer edges "a>b" with the
 * territory they belong to.
 */
function outerEdges(regions: readonly RegionInput[]): Map<string, string> {
  const prepared: { id: string; keys: string[] }[] = [];
  for (const region of regions) {
    for (const raw of region.rings) {
      let keys = raw.map((p) => gridKey(p[0], p[1]));
      keys = keys.filter((k, i) => k !== keys[(i + keys.length - 1) % keys.length]);
      if (keys.length > 1 && keys[0] === keys[keys.length - 1]) keys.pop();
      if (keys.length < 3) continue;
      prepared.push({ id: region.id, keys });
    }
  }
  const noded = insertJunctions(prepared.map((p) => p.keys)).map(removeSpikes);
  const ownEdges = new Map<string, Set<string>>();
  prepared.forEach((p, i) => {
    const own = ownEdges.get(p.id) ?? new Set<string>();
    ownEdges.set(p.id, own);
    const keys = orientCcw(noded[i]!);
    for (let j = 0; j < keys.length; j++) {
      const a = keys[j]!;
      const b = keys[(j + 1) % keys.length]!;
      if (own.has(`${b}>${a}`)) own.delete(`${b}>${a}`);
      else own.add(`${a}>${b}`);
    }
  });
  const owner = new Map<string, string>(); // "a>b" -> region id (outer edge)
  for (const [id, own] of ownEdges) for (const e of own) owner.set(e, id);
  return owner;
}

/** 2. The outer edges as region -> node -> targets, for chaining them into rings. */
function outgoingByRegion(owner: Map<string, string>): Map<string, Map<string, string[]>> {
  const outgoing = new Map<string, Map<string, string[]>>();
  for (const [e, id] of owner) {
    const [a, b] = e.split(">") as [string, string];
    const nodes = outgoing.get(id) ?? new Map<string, string[]>();
    outgoing.set(id, nodes);
    nodes.set(a, [...(nodes.get(a) ?? []), b]);
  }
  return outgoing;
}

/** Chains a region's edges into rings (start nodes sorted); uses the edges up. Rings under 3 nodes are skipped. */
function* chainRings(nodes: Map<string, string[]>): Generator<string[]> {
  const starts = [...nodes.keys()].sort();
  for (const start of starts) {
    while ((nodes.get(start)?.length ?? 0) > 0) {
      const ring: string[] = [start];
      let cur = start;
      for (;;) {
        const next = nodes.get(cur)?.pop();
        if (next === undefined) break;
        if (next === start) break;
        ring.push(next);
        cur = next;
      }
      if (ring.length < 3) continue;
      yield ring;
    }
  }
}

/**
 * Cuts a ring into runs of edges with the same neighbour (`label`). A ring with one neighbour all round (island,
 * enclave) is cut into two halves, so the arcs are open.
 */
function arcRuns(
  ring: readonly string[],
  label: (i: number) => string,
): { other: string; nodes: string[] }[] {
  const k = ring.length;
  let first = 0;
  for (let i = 0; i < k; i++) {
    if (label(i) !== label((i + k - 1) % k)) {
      first = i;
      break;
    }
  }
  const runs: { other: string; nodes: string[] }[] = [];
  let runStart = first;
  for (let n = 1; n <= k; n++) {
    const i = (first + n) % k;
    if (n === k || label(i) !== label(runStart)) {
      const seq: string[] = [];
      for (let j = runStart; j !== i || seq.length === 0; j = (j + 1) % k) {
        seq.push(ring[j]!);
        if (seq.length > k) break;
      }
      seq.push(ring[i]!);
      runs.push({ other: label(runStart), nodes: seq });
      runStart = i;
    }
  }
  if (runs.length !== 1) return runs;
  const lo = ring.reduce((m, key, i) => (key < ring[m]! ? i : m), 0);
  const rot = [...ring.slice(lo), ...ring.slice(0, lo)];
  const mid = Math.floor(rot.length / 2);
  return [
    { other: label(0), nodes: rot.slice(0, mid + 1) },
    { other: label(0), nodes: [...rot.slice(mid), rot[0]!] },
  ];
}

/**
 * Projects and simplifies an arc once, in a canonical direction (the smaller end node first), and gives it back in
 * the asked direction: both neighbours get exactly the same points.
 */
function arcSimplifier(opts: BuildOptions): (nodes: string[]) => Pt[] {
  const cache = new Map<string, Pt[]>(); // canonical arc key -> simplified points (projected)
  const projectKey = (k: string): Pt => {
    const [lon, lat] = parseKey(k);
    return opts.project(lon, lat);
  };
  return (nodes) => {
    const forward = nodes[0]! < nodes[nodes.length - 1]!;
    const canon = forward ? nodes : [...nodes].reverse();
    const key = canon.join(";");
    let pts = cache.get(key);
    if (!pts) {
      const projected = canon.map(projectKey);
      pts = douglasPeucker(opts.smooth ? smooth(projected, opts.smooth) : projected, opts.epsilon);
      cache.set(key, pts);
    }
    return forward ? pts : [...pts].reverse();
  };
}

const lineLength = (pts: readonly Pt[]): number => {
  let s = 0;
  for (let i = 1; i < pts.length; i++)
    s += Math.hypot(pts[i]![0] - pts[i - 1]![0], pts[i]![1] - pts[i - 1]![1]);
  return s;
};

export const vertexCount = (rings: readonly (readonly Ring[])[]): number =>
  rings.reduce((s, r) => s + r.reduce((t, ring) => t + ring.length, 0), 0);
