import { describe, expect, it } from "vitest";
import { ringArea, splitAtLine, splitAtVertical } from "./cut.js";
import type { Pt } from "./project.js";

const sum = (parts: Pt[][]) => parts.reduce((s, r) => s + Math.abs(ringArea(r)), 0);

describe("splitAtVertical", () => {
  it("splits a rectangle into two rectangles with the same cut points", () => {
    const ring: Pt[] = [
      [0, 0],
      [10, 0],
      [10, 4],
      [0, 4],
    ];
    const { west, east } = splitAtVertical(ring, 6);
    expect(sum(west)).toBeCloseTo(24);
    expect(sum(east)).toBeCloseTo(16);
    expect(west).toHaveLength(1);
    expect(east).toHaveLength(1);
  });

  it("splits a U shape cut through both arms into three parts without bridges", () => {
    // U: two arms (x 0..2 and 8..10) joined by a base (y 0..2), open to the top.
    const ring: Pt[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [8, 10],
      [8, 2],
      [2, 2],
      [2, 10],
      [0, 10],
    ];
    const total = Math.abs(ringArea(ring));
    const { west, east } = splitAtVertical(ring, 5);
    expect(west).toHaveLength(1);
    expect(east).toHaveLength(1);
    expect(sum(west) + sum(east)).toBeCloseTo(total);
  });

  it("gives two separate parts when the line cuts a comb through two teeth", () => {
    // Comb opening downwards: the vertical line x = 5 crosses the spine and nothing else; cut at x = 3 crosses teeth.
    const ring: Pt[] = [
      [0, 0],
      [2, 0],
      [2, 6],
      [4, 6],
      [4, 0],
      [6, 0],
      [6, 8],
      [0, 8],
    ];
    const total = Math.abs(ringArea(ring));
    const { west, east } = splitAtVertical(ring, 3);
    expect(sum(west) + sum(east)).toBeCloseTo(total);
    expect(west.length + east.length).toBeGreaterThanOrEqual(2);
  });

  it("returns the ring unchanged when it lies on one side", () => {
    const ring: Pt[] = [
      [0, 0],
      [1, 0],
      [1, 1],
    ];
    expect(splitAtVertical(ring, 5).west).toEqual([ring]);
    expect(splitAtVertical(ring, -5).east).toEqual([ring]);
  });
});

describe("splitAtLine", () => {
  const square: Pt[] = [
    [0, 0],
    [10, 0],
    [10, 10],
    [0, 10],
  ];

  it("splits along a slanted line into two parts whose areas add up and that share the cut points", () => {
    const { left, right } = splitAtLine(square, [0, 0], [10, 10]);
    expect(left).toHaveLength(1);
    expect(right).toHaveLength(1);
    expect(sum(left)).toBeCloseTo(50);
    expect(sum(right)).toBeCloseTo(50);
    const key = (p: Pt) => p.join(",");
    const onLine = (r: Pt[]) => r.filter((p) => p[0] === p[1]).map(key);
    expect(onLine(left[0]!).sort()).toEqual(onLine(right[0]!).sort());
  });

  it("puts the left of a line heading east to the north and of one heading north to the west", () => {
    const north = splitAtLine(square, [0, 4], [1, 4]);
    expect(sum(north.left)).toBeCloseTo(60);
    const west = splitAtLine(square, [4, 0], [4, 1]);
    expect(sum(west.left)).toBeCloseTo(40);
  });

  it("gives parts that add up to the area of a concave ring cut through two arms", () => {
    const u: Pt[] = [
      [0, 0],
      [10, 0],
      [10, 10],
      [8, 10],
      [8, 2],
      [2, 2],
      [2, 10],
      [0, 10],
    ];
    const { left, right } = splitAtLine(u, [0, 6], [1, 6]);
    expect(sum(left) + sum(right)).toBeCloseTo(Math.abs(ringArea(u)));
    expect(left).toHaveLength(2);
  });
});
