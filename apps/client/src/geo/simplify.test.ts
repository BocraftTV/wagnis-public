import { describe, expect, it } from "vitest";
import type { Pt } from "./project.js";
import { douglasPeucker, smooth } from "./simplify.js";

describe("simplify", () => {
  it("keeps the end points and drops points within the tolerance", () => {
    const line: Pt[] = [
      [0, 0],
      [1, 0.2],
      [2, -0.2],
      [3, 0],
      [4, 3],
    ];
    const out = douglasPeucker(line, 0.5);
    expect(out[0]).toEqual([0, 0]);
    expect(out[out.length - 1]).toEqual([4, 3]);
    expect(out).toContainEqual([3, 0]);
    expect(out).not.toContainEqual([1, 0.2]);
  });

  it("keeps every point at zero tolerance on a bent line", () => {
    const line: Pt[] = [
      [0, 0],
      [1, 1],
      [2, 0],
    ];
    expect(douglasPeucker(line, 0)).toHaveLength(3);
  });

  it("smooths inner points and leaves the ends fixed", () => {
    const out = smooth([
      [0, 0],
      [1, 4],
      [2, 0],
    ]);
    expect(out[0]).toEqual([0, 0]);
    expect(out[2]).toEqual([2, 0]);
    expect(out[1]![1]).toBeCloseTo(2);
  });
});
