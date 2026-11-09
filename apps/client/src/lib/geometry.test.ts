import { describe, expect, it } from "vitest";
import { pointInShape, polygonArea, shapeArea, shapePath } from "./geometry.js";

const square = (x: number, y: number, s = 10) => [
  { x, y },
  { x: x + s, y },
  { x: x + s, y: y + s },
  { x, y: y + s },
];

describe("shapes with several rings", () => {
  const shape = [square(0, 0), square(30, 0, 4)];

  it("adds the ring areas", () => {
    expect(polygonArea(square(0, 0))).toBe(100);
    expect(shapeArea(shape)).toBe(116);
  });

  it("finds a point in any ring and none outside", () => {
    expect(pointInShape({ x: 5, y: 5 }, shape)).toBe(true);
    expect(pointInShape({ x: 32, y: 2 }, shape)).toBe(true);
    expect(pointInShape({ x: 20, y: 5 }, shape)).toBe(false);
  });

  it("writes one closed sub-path per ring", () => {
    expect(shapePath(shape)).toBe("M0 0L10 0L10 10L0 10ZM30 0L34 0L34 4L30 4Z");
  });
});
