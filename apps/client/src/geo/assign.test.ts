import { describe, expect, it } from "vitest";
import { assignCountries, clipToWindow, type Feature } from "./assign.js";
import { ringArea } from "./cut.js";
import type { Pt } from "./project.js";

const feature = (code: string, ...rings: Pt[][]): Feature => ({
  properties: { ADM0_A3: code },
  geometry: { type: "MultiPolygon", coordinates: rings.map((r) => [r.map((p) => [p[0], p[1]])]) },
});
const box = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  [x0, y0],
  [x1, y0],
  [x1, y1],
  [x0, y1],
];
const area = (rings: readonly Pt[][] | undefined) =>
  (rings ?? []).reduce((s, r) => s + Math.abs(ringArea(r)), 0);

describe("assignCountries", () => {
  it("splits a country along a cut line and sends the sides to different territories", () => {
    const f = feature("XXX", box(0, 0, 10, 10));
    const { rings } = assignCountries([f], {
      XXX: {
        all: {
          cut: [
            [5, 0],
            [5, 1],
          ],
          left: "west",
          right: "east",
        },
      },
    });
    expect(area(rings["west"])).toBeCloseTo(50);
    expect(area(rings["east"])).toBeCloseTo(50);
  });

  it("applies ring rules by the centre of the ring and drops rings", () => {
    const f = feature("XXX", box(0, 0, 10, 10), box(50, 50, 52, 52));
    const { rings } = assignCountries([f], {
      XXX: { all: "main", rings: [{ in: [49, 49, 53, 53], to: null }] },
    });
    expect(rings["main"]).toHaveLength(1);
  });

  it("drops rings below the minimum area of a rule and reports countries without a rule", () => {
    const f = feature("XXX", box(0, 0, 10, 10), box(20, 20, 20.5, 20.5));
    const { rings, unassigned } = assignCountries([f, feature("YYY", box(0, 0, 1, 1))], {
      XXX: { all: "main", rings: [{ in: [19, 19, 21, 21], to: "main", minArea: 6 }] },
    });
    expect(rings["main"]).toHaveLength(1);
    expect(unassigned).toEqual(["YYY"]);
  });

  it("moves rings west of -100 degrees east by 360 when asked (date line)", () => {
    const f = feature("XXX", box(175, 60, 180, 70), box(-180, 60, -175, 70));
    const { rings } = assignCountries([f], { XXX: { all: "r", shift360: true } });
    const xs = rings["r"]!.flatMap((r) => r.map((p) => p[0]));
    expect(Math.min(...xs)).toBe(175);
    expect(Math.max(...xs)).toBe(185);
  });
});

describe("clipToWindow", () => {
  it("cuts off what lies outside the map window and keeps what is inside", () => {
    expect(area(clipToWindow(box(0, 0, 10, 10)))).toBeCloseTo(100);
    expect(area(clipToWindow(box(185, 0, 195, 10)))).toBeCloseTo(50);
    expect(clipToWindow(box(-200, 0, -190, 10))).toEqual([]);
    expect(area(clipToWindow(box(0, 80, 10, 90)))).toBeCloseTo(30);
  });
});
