import { describe, expect, it } from "vitest";
import { suggestAnchors } from "./anchors.js";
import type { Pt } from "./project.js";

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

describe("suggestAnchors", () => {
  it("moves the anchors of two wide neighbours apart and keeps them inside their outlines", () => {
    // Two long territories side by side: the poles are close (both in the middle of the shared strip).
    const rings = { a: [rect(0, 0, 100, 40)], b: [rect(0, 40, 100, 80)] };
    const { anchors, tight } = suggestAnchors(rings, { minDistance: 55, clearance: 3, step: 2 });
    expect(tight).toEqual([]);
    expect(
      Math.hypot(anchors["a"]![0] - anchors["b"]![0], anchors["a"]![1] - anchors["b"]![1]),
    ).toBeGreaterThanOrEqual(55);
    expect(anchors["a"]![1]).toBeLessThanOrEqual(40);
    expect(anchors["b"]![1]).toBeGreaterThanOrEqual(40);
  });

  it("reports pairs that cannot get far enough apart", () => {
    const rings = { a: [rect(0, 0, 30, 30)], b: [rect(30, 0, 60, 30)] };
    const { tight } = suggestAnchors(rings, { minDistance: 90, clearance: 2, step: 2 });
    expect(tight).toHaveLength(1);
  });
});
