import { describe, expect, it } from "vitest";
import {
  fortifyHint,
  fortifyLabel,
  holdToWinHint,
  holdToWinLabel,
  mapLabel,
  missionDraftHint,
  missionDraftLabel,
} from "./mapname.js";

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

describe("mission option texts (plan 013)", () => {
  it("names both options and explains on and off", () => {
    expect(missionDraftLabel).toBe("Zwei ziehen, eine behalten");
    expect(holdToWinLabel).toBe("Halten bis zum nächsten Zug");
    expect(missionDraftHint(true)).toContain("zwei Missionen");
    expect(missionDraftHint(false)).toContain("eine Mission");
    expect(holdToWinHint(true)).toContain("Jemand steht kurz vor dem Sieg");
    expect(holdToWinHint(false)).toContain("sofort");
  });
});
