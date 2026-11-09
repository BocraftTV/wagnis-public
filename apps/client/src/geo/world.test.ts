import { describe, expect, it } from "vitest";
import type { Feature } from "./assign.js";
import { verifyWorld } from "./check.js";
import { sharedBorders } from "./notch.js";
import type { Pt } from "./project.js";
import { buildWorld } from "./world.js";

const feature = (code: string, ring: Pt[]): Feature => ({
  properties: { ADM0_A3: code },
  geometry: { type: "Polygon", coordinates: [ring.map((p) => [p[0], p[1]])] },
});
const box = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

// Three countries in a row (A, B, C): A-B and B-C are land borders in the "engine", A and C touch at a corner only.
const features = [
  feature("AAA", box(0, 0, 10, 10)),
  feature("BBB", box(10, 0, 20, 10)),
  feature("CCC", box(10, 10, 20, 20)),
  feature("DDD", box(0, 10, 10, 20)),
];

describe("buildWorld", () => {
  it("builds outlines, notches a touch without a land border and keeps the border checks green", () => {
    const res = buildWorld(features, {
      territories: ["a", "b", "c", "d"],
      landPairs: new Set(["a|b", "b|c", "c|d", "a|d"]),
      countries: { AAA: "a", BBB: "b", CCC: "c", DDD: "d" },
      lenses: [],
      epsilon: 0.1,
      gap: 1,
      kerbeMax: 12,
      islandMinArea: () => 6,
    });
    // a|c and b|d touch in the middle node only: both are notched.
    expect(res.notches.map((n) => n.pair).sort()).toEqual(["a|c", "b|d"]);
    expect(res.longTouches).toEqual([]);
    expect(sharedBorders(res.rings).get("a|b")).toBeGreaterThan(3);
    const problems = verifyWorld(res.rings, {
      landPairs: new Set(["a|b", "b|c", "c|d", "a|d"]),
      gap: 1,
      budget: { vertices: 3000, perTerritory: 260, perRing: 40, rings: 70 },
    });
    expect(problems).toEqual([]);
  });

  it("reports a long touch without a land border instead of changing it", () => {
    const res = buildWorld(features.slice(0, 2), {
      territories: ["a", "b"],
      landPairs: new Set(),
      countries: { AAA: "a", BBB: "b" },
      lenses: [],
      epsilon: 0.1,
      gap: 1,
      kerbeMax: 5,
      islandMinArea: () => 6,
    });
    expect(res.notches).toEqual([]);
    expect(res.longTouches.map((t) => t.pair)).toEqual(["a|b"]);
  });
});
