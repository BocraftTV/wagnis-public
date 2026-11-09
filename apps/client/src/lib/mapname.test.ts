import { describe, expect, it } from "vitest";
import { fortifyHint, fortifyLabel, mapLabel } from "./mapname.js";

describe("mapLabel", () => {
  it("names the map and its size", () => {
    expect(mapLabel("welt")).toBe("Karte: Welt (42 Gebiete)");
    expect(mapLabel("testland")).toMatch(/^Karte: .+ \(8 Gebiete\)$/);
    expect(mapLabel("anderswo")).toBe("Karte: anderswo");
  });
});

describe("fortify setting texts", () => {
  it("names both values and explains them", () => {
    expect(fortifyLabel(1)).toBe("Original");
    expect(fortifyLabel(2)).toBe("Zwei Verschiebungen");
    expect(fortifyHint(1)).toContain("Eine Verschiebung");
    expect(fortifyHint(2)).toContain("zwei Verschiebungen");
  });
});
