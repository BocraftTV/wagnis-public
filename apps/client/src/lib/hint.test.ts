import { describe, expect, it } from "vitest";
import { armiesText, territoryHint } from "./hint.js";

describe("hint texts", () => {
  it("uses the singular for one army", () => {
    expect(armiesText(1)).toBe("1 Armee");
    expect(armiesText(0)).toBe("0 Armeen");
    expect(armiesText(12)).toBe("12 Armeen");
  });

  it("names territory, owner and armies and nothing about location", () => {
    expect(territoryHint("Südspitze", "Neutral", 3)).toBe("Südspitze · Neutral · 3 Armeen");
  });
});
