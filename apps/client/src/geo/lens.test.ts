import { describe, expect, it } from "vitest";
import { applyLens, lensMinDerivative, type Lens } from "./lens.js";

const lens: Lens = { center: [500, 130], radius: 150, factor: 1.8 };

describe("lens", () => {
  it("leaves points outside the radius and the centre untouched", () => {
    expect(applyLens([700, 130], lens)).toEqual([700, 130]);
    expect(applyLens([500, 130], lens)).toEqual([500, 130]);
  });

  it("stretches points near the centre by up to the factor and keeps their direction", () => {
    const [x, y] = applyLens([501, 130], lens);
    expect(x - 500).toBeGreaterThan(1.7);
    expect(x - 500).toBeLessThanOrEqual(1.8);
    expect(y).toBe(130);
  });

  it("is monotone along every ray (no fold, positive determinant)", () => {
    expect(lensMinDerivative(lens)).toBeGreaterThan(0.3);
    let last = 0;
    for (let r = 0; r <= 160; r += 0.5) {
      const [x] = applyLens([500 + r, 130], lens);
      expect(x - 500).toBeGreaterThanOrEqual(last);
      last = x - 500;
    }
  });

  it("is continuous at the rim", () => {
    const [x] = applyLens([649.999, 130], lens);
    expect(x).toBeCloseTo(649.999, 2);
  });
});
