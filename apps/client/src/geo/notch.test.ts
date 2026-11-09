import { describe, expect, it } from "vitest";
import {
  enforceGaps,
  minDistance,
  notch,
  sharedBorders,
  touchingPairs,
  type Rings,
} from "./notch.js";
import type { Pt } from "./project.js";

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

describe("sharedBorders and touchingPairs", () => {
  it("measures the shared edges and finds pairs that only touch in a corner", () => {
    const rings: Rings = {
      a: [rect(0, 0, 10, 10)],
      b: [rect(10, 0, 20, 10)],
      c: [rect(20, 10, 30, 20)],
    };
    expect(sharedBorders(rings).get("a|b")).toBeCloseTo(10);
    expect(sharedBorders(rings).has("b|c")).toBe(false);
    expect([...touchingPairs(rings)].sort()).toEqual(["a|b", "b|c"]);
  });
});

describe("notch", () => {
  it("pulls two touching territories apart by the gap and leaves a third one closed", () => {
    // a and b share the edge x = 10 (y 0..10); c lies on top of both and touches both at the corner nodes.
    const rings: Rings = {
      a: [
        [
          [0, 0],
          [10, 0],
          [10, 10],
          [0, 10],
        ],
      ],
      b: [
        [
          [10, 0],
          [20, 0],
          [20, 10],
          [10, 10],
        ],
      ],
      c: [
        [
          [0, 10],
          [10, 10],
          [20, 10],
          [20, 20],
          [0, 20],
        ],
      ],
    };
    expect(notch(rings, "a", "b", 1)).toBeGreaterThan(0);
    expect(sharedBorders(rings).has("a|b")).toBe(false);
    expect(minDistance(rings.a!, rings.b!)!.d).toBeGreaterThanOrEqual(1 - 1e-9);
    // c carries the cap: both copies of the old node (10, 10) are in its outline.
    expect(rings.c![0]!.length).toBe(6);
  });
});

describe("enforceGaps", () => {
  it("pushes outlines that come too close apart and keeps shared borders shared", () => {
    const rings: Rings = {
      a: [rect(0, 0, 10, 10)],
      b: [rect(10.2, 0, 20, 10)],
    };
    expect(enforceGaps(rings, ["a|b"], 1)).toEqual([]);
    expect(minDistance(rings.a!, rings.b!)!.d).toBeGreaterThanOrEqual(1 - 1e-6);
  });
});
