import { describe, expect, it } from "vitest";
import { buildTerritories, insertJunctions, removeSpikes } from "./arcs.js";
import type { Pt, Ring } from "./project.js";
import { poleOfInaccessibility } from "./pole.js";

const id = (lon: number, lat: number): Pt => [lon, lat];
const sq = (x0: number, y0: number, x1: number, y1: number): Ring => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];

describe("buildTerritories", () => {
  it("lets two neighbours share exactly one border arc with identical points", () => {
    // A: two countries merged into one territory (inner border cancels), B to the east.
    const res = buildTerritories(
      [
        { id: "a", rings: [sq(0, 0, 1, 1), sq(1, 0, 2, 1)] },
        { id: "b", rings: [sq(2, 0, 3, 1)] },
      ],
      { project: id, epsilon: 0.01 },
    );
    expect(res.rings["a"]).toHaveLength(1);
    // The merged territory is one rectangle 0..2: the inner node (1,0) and (1,1) are gone after simplification.
    expect(res.rings["a"]![0]!.length).toBe(4);
    expect(res.contacts.get("a|b")).toBeCloseTo(1);
    const shared = (r: Pt[], x: number) => r.filter((p) => p[0] === x).length;
    expect(shared(res.rings["a"]![0]!, 2)).toBe(2);
    expect(shared(res.rings["b"]![0]!, 2)).toBe(2);
  });

  it("does not report contact for territories that only touch diagonally at a corner", () => {
    const res = buildTerritories(
      [
        { id: "a", rings: [sq(0, 0, 1, 1)] },
        { id: "b", rings: [sq(1, 1, 2, 2)] },
      ],
      { project: id, epsilon: 0.01 },
    );
    expect(res.contacts.size).toBe(0);
  });

  it("keeps an island as its own ring and drops rings that simplify away", () => {
    const res = buildTerritories([{ id: "a", rings: [sq(0, 0, 4, 4), sq(10, 10, 12, 12)] }], {
      project: id,
      epsilon: 0.01,
    });
    expect(res.rings["a"]).toHaveLength(2);
    expect(res.rings["a"]![0]!.length).toBeGreaterThanOrEqual(4);
  });

  it("uses the same simplified border for both sides of a rugged border", () => {
    const rugged: Ring = [
      [1, 0],
      [1.01, 0.3],
      [0.99, 0.5],
      [1.02, 0.7],
      [1, 1],
    ];
    const a: Ring = [[0, 0], ...rugged, [0, 1]];
    const b: Ring = [...rugged.slice().reverse(), [2, 0], [2, 1]];
    const res = buildTerritories(
      [
        { id: "a", rings: [a] },
        { id: "b", rings: [b] },
      ],
      { project: id, epsilon: 0.015 },
    );
    const border = (r: Pt[]) => r.filter((p) => p[0] > 0.98 && p[0] < 1.03 && p[1] > 0 && p[1] < 1);
    const pa = border(res.rings["a"]![0]!)
      .map((p) => p.join())
      .sort();
    const pb = border(res.rings["b"]![0]!)
      .map((p) => p.join())
      .sort();
    expect(pa).toEqual(pb);
  });
});

describe("poleOfInaccessibility", () => {
  it("finds the middle of a square and avoids the thin arm of an L", () => {
    const l: Ring = [
      [0, 0],
      [10, 0],
      [10, 2],
      [2, 2],
      [2, 10],
      [0, 10],
    ];
    const { point, distance } = poleOfInaccessibility([l], 0.5);
    expect(distance).toBeGreaterThan(0.9);
    expect(point[0]).toBeLessThan(3.5);
    expect(point[1]).toBeLessThan(3.5);
  });
});

describe("insertJunctions", () => {
  it("puts a node that lies on the edge of another ring into that edge", () => {
    // Ring 1 has the long edge (0,0)-(2,0); ring 2 has a node at (1,0) on it.
    const rings = [
      ["0,0", "200,0", "200,100", "0,100"],
      ["100,0", "150,-50", "50,-50"],
    ];
    const out = insertJunctions(rings);
    expect(out[0]).toEqual(["0,0", "100,0", "200,0", "200,100", "0,100"]);
    expect(out[1]).toEqual(rings[1]);
  });

  it("leaves rings alone that have no node on a foreign edge", () => {
    const rings = [
      ["0,0", "100,0", "100,100"],
      ["300,300", "400,300", "400,400"],
    ];
    expect(insertJunctions(rings)).toEqual(rings);
  });
});

describe("removeSpikes", () => {
  it("drops the tip of a zero-width spike and keeps real corners", () => {
    // The ring runs out to 300,0 and back along the same line through 200,0.
    // The whole antenna beyond 150,0 goes (200,0 becomes a tip once 300,0 is gone).
    expect(removeSpikes(["0,0", "200,0", "300,0", "150,0", "150,100", "0,100"])).toEqual([
      "0,0",
      "150,0",
      "150,100",
      "0,100",
    ]);
    const square = ["0,0", "100,0", "100,100", "0,100"];
    expect(removeSpikes(square)).toEqual(square);
  });
});
