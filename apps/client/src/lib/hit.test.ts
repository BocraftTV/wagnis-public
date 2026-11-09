import { describe, expect, it } from "vitest";
import {
  belowMinimum,
  clearance,
  drawOrder,
  effectiveHit,
  hitPixels,
  meetsMinimum,
  scaleForMinimum,
  type HitSpec,
} from "./hit.js";

describe("effectiveHit", () => {
  const anchor = { x: 100, y: 50 };

  it("grows to 44 px on screen when zoomed out, as far as the cap allows", () => {
    const hit: HitSpec = { r: 40 };
    const c = effectiveHit(anchor, hit, 0.5);
    expect(c.r).toBe(40); // 22 / 0.5 = 44 would exceed the cap
    expect(hitPixels(hit, 0.5)).toBe(40);
    const d = effectiveHit(anchor, hit, 0.7);
    expect(d.r).toBeCloseTo(22 / 0.7);
    expect(hitPixels(hit, 0.7)).toBeCloseTo(44);
  });

  it("keeps 44 px at any larger scale while the cap is not reached", () => {
    const hit: HitSpec = { r: 40 };
    expect(hitPixels(hit, 1.4)).toBeCloseTo(44);
    expect(hitPixels(hit, 2.8)).toBeCloseTo(44);
  });

  it("applies the center offset", () => {
    const c = effectiveHit(anchor, { r: 30, dx: 5, dy: -7 }, 1);
    expect(c).toMatchObject({ cx: 105, cy: 43 });
  });
});

describe("minimum", () => {
  const hits: Record<string, HitSpec> = { big: { r: 40 }, small: { r: 20 }, tiny: { r: 12 } };

  it("lists territories under 44 px", () => {
    expect(belowMinimum(hits, 0.7)).toEqual(["small", "tiny"]);
    expect(belowMinimum(hits, 1.1)).toEqual(["tiny"]);
    expect(belowMinimum(hits, 1.84)).toEqual([]);
  });

  it("reports the scale at which a territory reaches 44 px", () => {
    expect(scaleForMinimum({ r: 20 })).toBeCloseTo(1.1);
    expect(meetsMinimum({ r: 20 }, scaleForMinimum({ r: 20 }))).toBe(true);
    expect(meetsMinimum({ r: 20 }, 1.09)).toBe(false);
  });
});

describe("drawOrder", () => {
  it("puts small areas last (on top)", () => {
    expect(drawOrder({ a: 100, b: 5000, c: 30, d: 700 })).toEqual(["b", "d", "a", "c"]);
  });

  it("is stable for equal areas", () => {
    expect(drawOrder({ z: 10, a: 10, m: 10 })).toEqual(["a", "m", "z"]);
  });
});

describe("clearance", () => {
  it("is the distance to the nearest other anchor", () => {
    const anchors = { a: { x: 0, y: 0 }, b: { x: 30, y: 40 }, c: { x: 100, y: 0 } };
    expect(clearance("a", anchors)).toBe(50);
    expect(clearance("c", anchors)).toBeCloseTo(Math.hypot(70, 40));
  });

  it("measures from the offset center", () => {
    const anchors = { a: { x: 0, y: 0 }, b: { x: 30, y: 0 } };
    expect(clearance("a", anchors, { r: 1, dx: 10 })).toBe(20);
  });
});
