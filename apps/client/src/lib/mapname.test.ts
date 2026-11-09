import { describe, expect, it } from "vitest";
import { mapLabel } from "./mapname.js";

describe("mapLabel", () => {
  it("names the map and its size", () => {
    expect(mapLabel("welt")).toBe("Karte: Welt (42 Gebiete)");
    expect(mapLabel("testland")).toMatch(/^Karte: .+ \(8 Gebiete\)$/);
    expect(mapLabel("anderswo")).toBe("Karte: anderswo");
  });
});
