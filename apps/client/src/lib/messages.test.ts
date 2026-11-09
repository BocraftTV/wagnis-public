import { describe, expect, it } from "vitest";
import { fortifyHintText } from "./messages.js";

describe("fortifyHintText", () => {
  it("keeps the old hint before the first move and changes it after it", () => {
    expect(fortifyHintText("pick-origin", 0)).toContain("optional");
    expect(fortifyHintText("pick-origin", 1)).toContain("Zweite Verschiebung möglich");
    expect(fortifyHintText("pick-target", 1)).toBe("Hervorgehobenes Ziel antippen.");
    expect(fortifyHintText("none", 1)).toContain("nichts verschieben");
  });
});
