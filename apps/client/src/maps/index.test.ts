import { describe, expect, it } from "vitest";
import { mapData } from "./index.js";

describe("mapData", () => {
  it("gives map and layout for welt and testland, undefined for anything else", () => {
    expect(mapData("welt")?.map.territories).toHaveLength(42);
    expect(mapData("testland")?.map.territories).toHaveLength(8);
    expect(mapData("nirgendwo")).toBeUndefined();
    expect(mapData("constructor")).toBeUndefined();
  });

  for (const id of ["welt", "testland"]) {
    it(`${id}: layout covers every territory and continent exactly`, () => {
      const { map, layout } = mapData(id)!;
      const ids = map.territories.map((t) => t.id).sort();
      expect(Object.keys(layout.territories).sort()).toEqual(ids);
      expect(Object.keys(layout.shapes).sort()).toEqual(ids);
      expect([...layout.stack].sort()).toEqual(ids);
      expect(Object.keys(layout.continentLabels).sort()).toEqual(
        map.continents.map((c) => c.id).sort(),
      );
    });
  }

  it("welt draws only the 16 sea routes as lines, dashed; testland every border, solid", () => {
    const welt = mapData("welt")!.layout.links;
    expect(welt).toHaveLength(16);
    expect(welt.every((l) => l.dashed)).toBe(true);
    const test = mapData("testland")!;
    const borders = test.map.territories.reduce((n, t) => n + t.neighbors.length, 0) / 2;
    expect(test.layout.links).toHaveLength(borders);
    expect(test.layout.links.every((l) => !l.dashed)).toBe(true);
  });

  it("builds one path per territory with one sub-path per ring", () => {
    for (const id of ["welt", "testland"]) {
      const { layout } = mapData(id)!;
      expect(Object.keys(layout.paths).sort()).toEqual(Object.keys(layout.shapes).sort());
      for (const [t, shape] of Object.entries(layout.shapes)) {
        expect(layout.paths[t]!.split("M").length - 1, t).toBe(shape.length);
        expect(layout.paths[t]!.endsWith("Z")).toBe(true);
      }
    }
  });

  it("draws testland discs around the anchors", () => {
    const { layout } = mapData("testland")!;
    for (const [id, t] of Object.entries(layout.territories)) {
      expect(layout.shapes[id]).toHaveLength(1);
      const xs = layout.shapes[id]![0]!.map((p) => p.x);
      expect((Math.max(...xs) + Math.min(...xs)) / 2).toBeCloseTo(t.anchor.x, 6);
    }
  });

  it("builds the static layer paths at load: all outlines, coast, one path per continent, terrain only on welt", () => {
    for (const id of ["welt", "testland"]) {
      const { map, layout } = mapData(id)!;
      const subpaths = (d: string) => d.split("M").length - 1;
      const rings = Object.values(layout.shapes).reduce((n, s) => n + s.length, 0);
      expect(subpaths(layout.allPath), id).toBe(rings);
      expect(layout.coastPath.length, id).toBeGreaterThan(0);
      expect(Object.keys(layout.continentPaths).sort(), id).toEqual(
        map.continents.map((c) => c.id).sort(),
      );
    }
    expect(mapData("welt")!.layout.atlas).toBe(true);
    expect(Object.keys(mapData("welt")!.layout.terrainPaths).sort()).toEqual([
      "desert",
      "forest",
      "mountain",
    ]);
    expect(mapData("testland")!.layout.atlas).toBe(false);
    expect(mapData("testland")!.layout.terrainPaths).toEqual({});
  });
});
