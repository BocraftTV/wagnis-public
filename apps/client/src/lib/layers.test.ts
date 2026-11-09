import { describe, expect, it } from "vitest";
import { shapeArea } from "./geometry.js";
import { COUNTER_RADIUS_PX, MAP_LAYERS, TAP_LAYERS, stackOrder, territoryAt } from "./layers.js";
import type { TapModel } from "./layers.js";
import { fitScale } from "./viewport.js";
import { mapData } from "../maps/index.js";

describe("layer order", () => {
  const rank = (l: (typeof MAP_LAYERS)[number]) => MAP_LAYERS.indexOf(l);

  it("puts counters above tap circles, tap circles above outlines, labels on top", () => {
    expect(rank("counters")).toBeGreaterThan(rank("hits"));
    expect(rank("hits")).toBeGreaterThan(rank("polygons"));
    expect(rank("labels")).toBe(MAP_LAYERS.length - 1);
    expect(rank("rings")).toBeLessThan(rank("counters"));
  });

  it("lists the tap layers bottom to top and only known layers", () => {
    expect(TAP_LAYERS).toEqual(["polygons", "hits", "counters"]);
    for (const l of TAP_LAYERS) expect(MAP_LAYERS).toContain(l);
    expect(new Set(MAP_LAYERS).size).toBe(MAP_LAYERS.length);
  });

  it("stacks large areas first so small territories end on top", () => {
    expect(stackOrder({ big: 100, small: 4, mid: 30 })).toEqual(["big", "mid", "small"]);
    expect(stackOrder({ b: 5, a: 5 })).toEqual(["a", "b"]);
  });
});

describe("what a tap reaches", () => {
  const { map, layout } = mapData("welt")!;
  const model: TapModel = {
    stack: layout.stack,
    anchors: Object.fromEntries(Object.entries(layout.territories).map(([k, t]) => [k, t.anchor])),
    hits: Object.fromEntries(Object.entries(layout.territories).map(([k, t]) => [k, t.hit])),
    shapes: layout.shapes,
  };
  const ids = map.territories.map((t) => t.id);
  const fit = (w: number, h: number) => fitScale({ width: w, height: h }, layout.viewBox, 8);
  // Smallest iPad in both orientations (map area), at several zoom levels.
  const scales = [fit(744, 496), fit(744, 900), fit(1133, 700)].flatMap((f) =>
    [1, 1.6, 2, 3, 4].map((z) => f * z),
  );

  it("is the territory's own for every point on its counter, at every zoom", () => {
    for (const scale of scales) {
      for (const id of ids) {
        const a = model.anchors[id]!;
        const r = (COUNTER_RADIUS_PX * 0.98) / scale;
        const probes = [{ x: a.x, y: a.y }];
        for (let k = 0; k < 12; k++) {
          const t = (k / 12) * 2 * Math.PI;
          probes.push({ x: a.x + r * Math.cos(t), y: a.y + r * Math.sin(t) });
        }
        for (const p of probes) expect(territoryAt(model, p, scale), `${id} @${scale}`).toBe(id);
      }
    }
  });

  it("is the neighbour's when the tap circles overlap and the neighbour is smaller", () => {
    const area = (id: string) => shapeArea(layout.shapes[id]!);
    const scale = fit(744, 496);
    let overlaps = 0;
    for (const a of ids) {
      for (const b of ids) {
        if (a >= b) continue;
        const pa = model.anchors[a]!;
        const pb = model.anchors[b]!;
        const d = Math.hypot(pa.x - pb.x, pa.y - pb.y);
        const ra = Math.min(model.hits[a]!.r, 22 / scale);
        const rb = Math.min(model.hits[b]!.r, 22 / scale);
        if (d >= ra + rb) continue;
        overlaps++;
        // A point in the lens, midway between the two edges, outside both counters.
        const t = (d - rb + ra) / 2 / d;
        const p = { x: pa.x + (pb.x - pa.x) * t, y: pa.y + (pb.y - pa.y) * t };
        if (Math.hypot(p.x - pa.x, p.y - pa.y) <= COUNTER_RADIUS_PX / scale) continue;
        if (Math.hypot(p.x - pb.x, p.y - pb.y) <= COUNTER_RADIUS_PX / scale) continue;
        const small = area(a) <= area(b) ? a : b;
        expect(territoryAt(model, p, scale), `${a}/${b}`).toBe(small);
      }
    }
    expect(overlaps).toBeGreaterThan(0);
  });

  it("is nothing on open sea", () => {
    expect(territoryAt(model, { x: 5, y: 535 }, fit(744, 496))).toBeNull();
  });
});
