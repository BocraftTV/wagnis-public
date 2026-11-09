import { describe, expect, it } from "vitest";
import { continentBorders, coastSegments, segmentsPath } from "./borders.js";
import { mapData } from "../maps/index.js";

const square = (x: number, y: number) => [
  { x, y },
  { x: x + 10, y },
  { x: x + 10, y: y + 10 },
  { x, y: y + 10 },
];

describe("coastSegments", () => {
  it("returns the edges that only one outline has", () => {
    // Two squares side by side: 8 outer edges, the shared one is no coast.
    const found = coastSegments({ a: [square(0, 0)], b: [square(10, 0)] });
    expect(found).toHaveLength(6);
    expect(coastSegments({ a: [square(0, 0), square(30, 0)] })).toHaveLength(8);
  });
});

describe("continentBorders", () => {
  it("returns only edges shared by territories of different continents", () => {
    const shapes = { a: [square(0, 0)], b: [square(10, 0)], c: [square(0, 10)] };
    const continentOf = { a: "x", b: "y", c: "x" };
    const found = continentBorders(shapes, continentOf);
    expect(found).toHaveLength(1);
    expect([found[0]!.a.x, found[0]!.b.x]).toEqual([10, 10]);
  });

  it("returns nothing inside one continent or on a coast", () => {
    const shapes = { a: [square(0, 0)], b: [square(10, 0)] };
    expect(continentBorders(shapes, { a: "x", b: "x" })).toEqual([]);
    expect(continentBorders({ a: [square(0, 0)] }, { a: "x" })).toEqual([]);
  });

  it("looks at every ring of a territory (an island ring next to a neighbour)", () => {
    const shapes = { a: [square(0, 0), square(30, 0)], b: [square(40, 0)] };
    expect(continentBorders(shapes, { a: "x", b: "y" })).toHaveLength(1);
  });

  it("finds the land crossings between continents on the world map", () => {
    const { map, layout } = mapData("welt")!;
    const continentOf = Object.fromEntries(map.territories.map((t) => [t.id, t.continentId]));
    const landCrossings = map.territories.flatMap((t) =>
      t.neighbors.filter((n) => t.id < n && continentOf[n] !== t.continentId),
    ).length;
    // 7 of those neighbourhoods are sea routes; the rest share an edge.
    expect(landCrossings).toBeGreaterThan(7);
    expect(layout.continentBorders.length).toBeGreaterThanOrEqual(landCrossings - 7);
  });

  it("writes a path with one move and line per segment", () => {
    expect(segmentsPath([{ a: { x: 1, y: 2 }, b: { x: 3, y: 4 } }])).toBe("M1 2L3 4");
  });
});
