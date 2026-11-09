import { getMap } from "@wagnis/engine/map-data";
import { describe, expect, it } from "vitest";
import { poleOfInaccessibility } from "../geo/pole.js";
import { BUDGET, GAP_MIN, MIN_ISLAND_AREA } from "../geo/welt.regions.js";
import { minDistance, sharedBorders, touchingPairs, type Rings } from "../geo/notch.js";
import { isSimple, ringsCross as tupleRingsCross } from "../geo/check.js";
import {
  circleOverlapsRect,
  distanceToSegment,
  pointInShape,
  polygonArea,
  rectsOverlap,
  shapeArea,
  type Rect,
} from "../lib/geometry.js";
import { belowMinimum, clearance, drawOrder, MIN_HIT_PX, scaleForMinimum } from "../lib/hit.js";
import { continentLabelSize, labelBox } from "../lib/label.js";
import { COUNTER_RADIUS_PX } from "../lib/layers.js";
import { fitScale, type Point } from "../lib/viewport.js";
import { weltLayout, type SeaRoute } from "./welt.layout.js";
import { weltShapes } from "./welt.shapes.js";

const map = getMap("welt")!;
const ids = map.territories.map((t) => t.id);
const { viewBox } = weltLayout;

// Smallest iPad in portrait (744 wide), map area 744 x 900, 8 px inset: the worst case for the fit scale.
const FIT = fitScale({ width: 744, height: 900 }, viewBox, 8);
const FIT_LANDSCAPE = fitScale({ width: 1133, height: 700 }, viewBox, 8);
const COUNTER_PX = COUNTER_RADIUS_PX; // counter radius on screen
const pairKey = (a: string, b: string): string => (a < b ? `${a}|${b}` : `${b}|${a}`);

const seaPairs = new Set(weltLayout.seaRoutes.map((r) => pairKey(r.a, r.b)));
const edges: [string, string][] = [];
for (const t of map.territories) for (const n of t.neighbors) if (t.id < n) edges.push([t.id, n]);
const landEdges = edges.filter(([a, b]) => !seaPairs.has(pairKey(a, b)));
const land = new Set(landEdges.map(([a, b]) => pairKey(a, b)));

// Outlines as coordinate pairs for the pipeline checks.
const rings: Rings = Object.fromEntries(
  ids.map((id) => [id, weltShapes[id]!.map((r) => r.map((p) => [p.x, p.y] as const))]),
);

describe("data completeness", () => {
  it("has outline, anchor, tap circle and label for every territory and nothing else", () => {
    expect(Object.keys(weltShapes).sort()).toEqual([...ids].sort());
    expect(Object.keys(weltLayout.territories).sort()).toEqual([...ids].sort());
  });

  it("labels every continent", () => {
    expect(Object.keys(weltLayout.continentLabels).sort()).toEqual(
      map.continents.map((c) => c.id).sort(),
    );
  });

  it("has finite coordinates on the 0.1 grid", () => {
    for (const id of ids)
      for (const ring of weltShapes[id]!)
        for (const p of ring)
          for (const v of [p.x, p.y]) {
            expect(Number.isFinite(v)).toBe(true);
            expect(Math.abs(v * 10 - Math.round(v * 10)), `${id} ${v}`).toBeLessThan(1e-6);
          }
  });
});

describe("layout", () => {
  it("keeps outlines and anchors inside the viewBox", () => {
    for (const id of ids) {
      for (const ring of weltShapes[id]!)
        for (const p of ring) {
          expect(p.x).toBeGreaterThanOrEqual(0);
          expect(p.x).toBeLessThanOrEqual(viewBox.width);
          expect(p.y).toBeGreaterThanOrEqual(0);
          expect(p.y).toBeLessThanOrEqual(viewBox.height);
        }
      const a = weltLayout.territories[id]!.anchor;
      expect(a.x).toBeGreaterThanOrEqual(0);
      expect(a.x).toBeLessThanOrEqual(viewBox.width);
      expect(a.y).toBeGreaterThanOrEqual(0);
      expect(a.y).toBeLessThanOrEqual(viewBox.height);
    }
  });

  it("puts every anchor inside the main part of its own outline", () => {
    for (const id of ids) {
      const main = weltShapes[id]![0]!;
      expect(pointInShape(weltLayout.territories[id]!.anchor, [main]), id).toBe(true);
    }
  });

  it("keeps large territories' anchors at least 8 units from the coast", () => {
    for (const id of ids) {
      const main = rings[id]![0]!;
      if (shapeArea(weltShapes[id]!) <= 600) continue;
      const a = weltLayout.territories[id]!.anchor;
      let nearest = Infinity;
      for (let i = 0; i < main.length; i++) {
        const p = main[i]!;
        const q = main[(i + 1) % main.length]!;
        nearest = Math.min(
          nearest,
          distanceToSegment(a, { x: p[0], y: p[1] }, { x: q[0], y: q[1] }),
        );
      }
      // A narrow territory (the isthmus) has no point 8 units from the coast: then its widest inner circle counts.
      const widest = poleOfInaccessibility([main], 1).distance;
      if (widest < 8)
        console.log(
          `${id}: widest inner circle ${widest.toFixed(1)} units, anchor ${nearest.toFixed(1)} from the coast`,
        );
      expect(nearest, id).toBeGreaterThanOrEqual(Math.min(8, widest - 0.5) - 1e-9);
    }
  });

  it("keeps counters apart so they do not overlap at the fit scale (portrait and landscape)", () => {
    // Counter diameter on screen is 2 * 16 px; two counters keep 2 px between them at the fit scale.
    const needPx = 2 * COUNTER_PX + 2;
    expect(weltLayout.minAnchorDistance * FIT).toBeGreaterThanOrEqual(needPx);
    let closest = { d: Infinity, pair: "" };
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = weltLayout.territories[ids[i]!]!.anchor;
        const b = weltLayout.territories[ids[j]!]!.anchor;
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (d < closest.d) closest = { d, pair: `${ids[i]} / ${ids[j]}` };
        expect(d * FIT, `${ids[i]} ${ids[j]} portrait`).toBeGreaterThanOrEqual(needPx);
        expect(d * FIT_LANDSCAPE, `${ids[i]} ${ids[j]} landscape`).toBeGreaterThanOrEqual(needPx);
      }
    }
    console.log(
      `closest counters: ${closest.pair} ${closest.d.toFixed(1)} units = ${(closest.d * FIT).toFixed(1)} px ` +
        `portrait (${FIT.toFixed(3)} px/unit), ${(closest.d * FIT_LANDSCAPE).toFixed(1)} px landscape (${FIT_LANDSCAPE.toFixed(3)}); need ${needPx} px`,
    );
  });
});

describe("data budget (plan 006, 3.4)", () => {
  const count = (id: string) => weltShapes[id]!.reduce((n, r) => n + r.length, 0);

  it("stays within the vertex budget in all, per territory and per island", () => {
    const total = ids.reduce((n, id) => n + count(id), 0);
    expect(total).toBeLessThanOrEqual(BUDGET.vertices);
    for (const id of ids) {
      expect(count(id), id).toBeLessThanOrEqual(BUDGET.perTerritory);
      weltShapes[id]!.forEach((ring, k) => {
        if (k > 0) expect(ring.length, `${id} island ${k}`).toBeLessThanOrEqual(BUDGET.perRing);
      });
    }
  });

  it("counts island rings next to the main parts (not the main parts themselves) against the limit of 70", () => {
    const islands = ids.reduce((n, id) => n + weltShapes[id]!.length - 1, 0);
    expect(islands).toBeLessThanOrEqual(BUDGET.rings);
    // Every territory has a main part; the total number of rings is the main parts plus the islands.
    expect(ids.reduce((n, id) => n + weltShapes[id]!.length, 0)).toBe(ids.length + islands);
  });
});

describe("outlines", () => {
  it("has simple rings of at least 3 points, the largest ring first and islands of at least the minimum area", () => {
    for (const id of ids) {
      const shape = weltShapes[id]!;
      expect(shape.length, id).toBeGreaterThanOrEqual(1);
      const areas = shape.map((r) => polygonArea(r));
      shape.forEach((ring, i) => {
        expect(ring.length, `${id} ring ${i}`).toBeGreaterThanOrEqual(3);
        expect(isSimple(rings[id]![i]!), `${id} ring ${i}`).toBe(true);
        if (i > 0) expect(areas[i]!, `${id} ring ${i}`).toBeGreaterThanOrEqual(MIN_ISLAND_AREA);
      });
      expect(areas[0], id).toBe(Math.max(...areas));
    }
  });

  it("lets no two rings of one territory cross", () => {
    for (const id of ids) {
      const list = rings[id]!;
      for (let i = 0; i < list.length; i++)
        for (let j = i + 1; j < list.length; j++)
          expect(tupleRingsCross(list[i]!, list[j]!), `${id} ${i} x ${j}`).toBe(false);
    }
  });

  it("lets no two outlines cross or contain each other's corners", () => {
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const a = weltShapes[ids[i]!]!;
        const b = weltShapes[ids[j]!]!;
        for (let x = 0; x < a.length; x++)
          for (let y = 0; y < b.length; y++)
            expect(
              tupleRingsCross(rings[ids[i]!]![x]!, rings[ids[j]!]![y]!),
              `${ids[i]} x ${ids[j]}`,
            ).toBe(false);
        const bKeys = new Set(b.flat().map((p) => `${p.x},${p.y}`));
        const aKeys = new Set(a.flat().map((p) => `${p.x},${p.y}`));
        for (const p of a.flat())
          if (!bKeys.has(`${p.x},${p.y}`))
            expect(pointInShape(p, b), `${ids[i]} in ${ids[j]}`).toBe(false);
        for (const p of b.flat())
          if (!aKeys.has(`${p.x},${p.y}`))
            expect(pointInShape(p, a), `${ids[j]} in ${ids[i]}`).toBe(false);
      }
    }
  });

  it("shares a border of at least 3 units (two points and an edge) for every land border", () => {
    expect(landEdges.length).toBe(56);
    const shared = sharedBorders(rings);
    for (const [a, b] of landEdges) {
      expect(shared.get(pairKey(a, b)) ?? 0, `${a} - ${b}`).toBeGreaterThanOrEqual(3);
      const ka = new Set(weltShapes[a]!.flat().map((p) => `${p.x},${p.y}`));
      const common = weltShapes[b]!.flat().filter((p) => ka.has(`${p.x},${p.y}`));
      expect(common.length, `${a} - ${b}`).toBeGreaterThanOrEqual(2);
    }
  });

  it("follows the border of the neighbour along a stretch of 3 units, measured independently of the build", () => {
    for (const [a, b] of landEdges) {
      // Sample the edges of a every 2 units and count the stretch that lies within 0.3 units of the outline of b.
      let near = 0;
      for (const ring of weltShapes[a]!) {
        for (let i = 0; i < ring.length; i++) {
          const p = ring[i]!;
          const q = ring[(i + 1) % ring.length]!;
          const len = Math.hypot(q.x - p.x, q.y - p.y);
          const n = Math.max(1, Math.ceil(len / 2));
          for (let k = 0; k < n; k++) {
            const s = {
              x: p.x + ((q.x - p.x) * (k + 0.5)) / n,
              y: p.y + ((q.y - p.y) * (k + 0.5)) / n,
            };
            let d = Infinity;
            for (const rb of weltShapes[b]!)
              for (let m = 0; m < rb.length; m++)
                d = Math.min(d, distanceToSegment(s, rb[m]!, rb[(m + 1) % rb.length]!));
            if (d <= 0.3) near += len / n;
          }
        }
      }
      expect(near, `${a} - ${b}`).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps territories without a land border apart: no shared point, gap of at least GAP_MIN, except the listed pairs", () => {
    const exceptions = weltLayout.touchExceptions;
    expect(Object.keys(exceptions).length).toBeLessThanOrEqual(12);
    for (const reason of Object.values(exceptions)) expect(reason.length).toBeGreaterThan(10);
    console.log(
      `touch exceptions: ${
        Object.keys(exceptions).length
          ? Object.entries(exceptions)
              .map(([k, v]) => `${k} (${v})`)
              .join("; ")
          : "none"
      }`,
    );
    const touching = touchingPairs(rings);
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const pair = pairKey(ids[i]!, ids[j]!);
        if (land.has(pair) || pair in exceptions) continue;
        expect(touching.has(pair), `${pair} shares a point`).toBe(false);
        const c = minDistance(rings[ids[i]!]!, rings[ids[j]!]!, GAP_MIN);
        if (c) expect(c.d, `${pair} distance`).toBeGreaterThanOrEqual(GAP_MIN - 1e-6);
      }
    }
  });

  it("has only listed exceptions that name real pairs", () => {
    for (const pair of Object.keys(weltLayout.touchExceptions)) {
      const [a, b] = pair.split("|");
      expect(ids).toContain(a);
      expect(ids).toContain(b);
      expect(land.has(pair), pair).toBe(false);
    }
  });
});

describe("sea routes", () => {
  const routes: SeaRoute[] = weltLayout.seaRoutes;

  it("lists exactly 16 routes, each an engine neighbourhood, none twice", () => {
    expect(routes.length).toBe(16);
    expect(seaPairs.size).toBe(16);
    const neighbors = new Set(edges.map(([a, b]) => pairKey(a, b)));
    for (const r of routes) expect(neighbors.has(pairKey(r.a, r.b)), `${r.a} - ${r.b}`).toBe(true);
  });

  it("has 7 routes across continent borders and 56 land borders in all", () => {
    const continent = (id: string): string => map.territories.find((t) => t.id === id)!.continentId;
    expect(routes.filter((r) => continent(r.a) !== continent(r.b)).length).toBe(7);
    expect(landEdges.length + routes.length).toBe(72);
  });

  it("keeps routes away from the counters of other territories", () => {
    for (const r of routes) {
      const a = weltLayout.territories[r.a]!.anchor;
      const b = weltLayout.territories[r.b]!.anchor;
      const lines = r.wrap
        ? [
            [a, r.wrap.a],
            [r.wrap.b, b],
          ]
        : [[a, ...(r.via ?? []), b]];
      for (const line of lines) {
        for (const id of ids) {
          if (id === r.a || id === r.b) continue;
          const p = weltLayout.territories[id]!.anchor;
          for (let i = 0; i + 1 < line.length; i++) {
            expect(
              distanceToSegment(p, line[i]!, line[i + 1]!),
              `${r.a}-${r.b} near ${id}`,
            ).toBeGreaterThan((COUNTER_PX + 4) / FIT);
          }
        }
      }
    }
  });

  it("runs through a third territory only for a small part of its length (sampled every 2 units)", () => {
    for (const r of routes) {
      const a = weltLayout.territories[r.a]!.anchor;
      const b = weltLayout.territories[r.b]!.anchor;
      const lines = r.wrap
        ? [
            [a, r.wrap.a],
            [r.wrap.b, b],
          ]
        : [[a, ...(r.via ?? []), b]];
      let samples = 0;
      let third = 0;
      for (const line of lines) {
        for (let i = 0; i + 1 < line.length; i++) {
          const p = line[i]!;
          const q = line[i + 1]!;
          const n = Math.max(1, Math.ceil(Math.hypot(q.x - p.x, q.y - p.y) / 2));
          for (let k = 0; k <= n; k++) {
            const s = { x: p.x + ((q.x - p.x) * k) / n, y: p.y + ((q.y - p.y) * k) / n };
            samples++;
            if (ids.some((id) => id !== r.a && id !== r.b && pointInShape(s, weltShapes[id]!)))
              third++;
          }
        }
      }
      expect(third / samples, `${r.a}-${r.b}`).toBeLessThanOrEqual(0.08);
    }
  });

  it("draws the wrap-around route over the map edge", () => {
    const wrap = routes.filter((r) => r.wrap);
    expect(wrap.length).toBe(1);
    expect(wrap[0]!.wrap!.a.x).toBe(0);
    expect(wrap[0]!.wrap!.b.x).toBe(viewBox.width);
  });
});

describe("tap circles", () => {
  const hits = Object.fromEntries(ids.map((id) => [id, weltLayout.territories[id]!.hit]));

  it("never cover another territory's counter", () => {
    const anchors = Object.fromEntries(ids.map((id) => [id, weltLayout.territories[id]!.anchor]));
    for (const id of ids) expect(clearance(id, anchors, hits[id]), id).toBeGreaterThan(hits[id]!.r);
  });

  it("reach 44 px at the fit scale, except the listed territories", () => {
    const below = belowMinimum(hits, FIT);
    console.log(
      `tap circles below ${MIN_HIT_PX} px at the fit scale (${FIT.toFixed(3)} px/unit): ` +
        (below.length
          ? below.map((id) => `${id} (${weltLayout.hitExceptions[id]})`).join(", ")
          : "none"),
    );
    expect(below).toEqual(Object.keys(weltLayout.hitExceptions).sort());
    for (const reason of Object.values(weltLayout.hitExceptions))
      expect(reason.length).toBeGreaterThan(10);
  });

  it("reach 44 px everywhere at zoom 2", () => {
    expect(belowMinimum(hits, FIT * 2)).toEqual([]);
  });

  it("report the zoom at which the last territory reaches 44 px", () => {
    const needed = Math.max(...ids.map((id) => scaleForMinimum(hits[id]!) / FIT));
    console.log(
      `last tap circle reaches 44 px at zoom ${Math.max(needed, 0).toFixed(2)} (relative to the fit scale)`,
    );
    expect(needed).toBeLessThanOrEqual(2);
  });

  it("draw small territories above large ones", () => {
    const areas = Object.fromEntries(ids.map((id) => [id, shapeArea(weltShapes[id]!)]));
    const order = drawOrder(areas);
    // The property: a smaller area is drawn later (further up); the ten smallest are the top ten.
    for (let i = 1; i < order.length; i++)
      expect(areas[order[i - 1]!]!).toBeGreaterThanOrEqual(areas[order[i]!]!);
    const smallest = [...ids].sort((a, b) => areas[a]! - areas[b]!).slice(0, 10);
    expect(new Set(order.slice(-10))).toEqual(new Set(smallest));
  });
});

describe("labels", () => {
  const counterRect = (p: Point, scale: number): Rect => ({
    left: p.x - COUNTER_PX / scale,
    top: p.y - COUNTER_PX / scale,
    right: p.x + COUNTER_PX / scale,
    bottom: p.y + COUNTER_PX / scale,
  });

  for (const zoom of [weltLayout.labelZoom, 2, 3, 4]) {
    it(`do not overlap each other or any counter at zoom ${zoom}`, () => {
      const scale = FIT * zoom;
      const boxes = ids.map((id) => ({
        id,
        box: labelBox(
          weltLayout.territories[id]!.anchor,
          weltLayout.territories[id]!.label,
          map.territories.find((t) => t.id === id)!.name,
          scale,
        ),
      }));
      for (let i = 0; i < boxes.length; i++) {
        for (let j = i + 1; j < boxes.length; j++) {
          expect(
            rectsOverlap(boxes[i]!.box, boxes[j]!.box),
            `${boxes[i]!.id} / ${boxes[j]!.id}`,
          ).toBe(false);
        }
        for (const id of ids) {
          const p = weltLayout.territories[id]!.anchor;
          expect(
            circleOverlapsRect(p, COUNTER_PX / scale, boxes[i]!.box),
            `${boxes[i]!.id} on counter ${id}`,
          ).toBe(false);
        }
      }
    });
  }

  it("stays inside the viewBox at the label threshold", () => {
    const scale = FIT * weltLayout.labelZoom;
    for (const t of map.territories) {
      const l = weltLayout.territories[t.id]!;
      const box = labelBox(l.anchor, l.label, t.name, scale);
      expect(box.left, t.id).toBeGreaterThanOrEqual(0);
      expect(box.right, t.id).toBeLessThanOrEqual(viewBox.width);
      expect(box.top, t.id).toBeGreaterThanOrEqual(0);
      expect(box.bottom, t.id).toBeLessThanOrEqual(viewBox.height);
    }
  });

  it("keeps the continent labels clear of counters, of each other and inside the viewBox at the fit scale", () => {
    const boxes = map.continents.map((c) => {
      const p = weltLayout.continentLabels[c.id]!;
      const { width, height } = continentLabelSize(c.name);
      return {
        id: c.id,
        box: {
          left: p.x - width / 2 / FIT,
          right: p.x + width / 2 / FIT,
          top: p.y - height / 2 / FIT,
          bottom: p.y + height / 2 / FIT,
        } satisfies Rect,
      };
    });
    for (let i = 0; i < boxes.length; i++) {
      const { id, box } = boxes[i]!;
      expect(box.left, id).toBeGreaterThanOrEqual(0);
      expect(box.right, id).toBeLessThanOrEqual(viewBox.width);
      expect(box.top, id).toBeGreaterThanOrEqual(0);
      expect(box.bottom, id).toBeLessThanOrEqual(viewBox.height);
      for (let j = i + 1; j < boxes.length; j++)
        expect(rectsOverlap(box, boxes[j]!.box), `${id}`).toBe(false);
      for (const tid of ids) {
        expect(
          circleOverlapsRect(weltLayout.territories[tid]!.anchor, COUNTER_PX / FIT, box),
          `${id} on ${tid}`,
        ).toBe(false);
      }
    }
  });
});

describe("sea routes: engine data and drawing list agree (plan 014 B)", () => {
  it("the client draws exactly the sea routes the engine knows, none twice", () => {
    const engine = map.seaRoutes.map(([a, b]) => pairKey(a, b)).sort();
    const drawn = weltLayout.seaRoutes.map((r) => pairKey(r.a, r.b)).sort();
    expect(drawn).toEqual(engine);
    expect(new Set(drawn).size).toBe(drawn.length);
  });
});
