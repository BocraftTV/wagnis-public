import { describe, expect, it } from "vitest";
import {
  BADGE_GAP_PX,
  BADGE_PX,
  CONTINENT_CHAR_PX,
  continentLabelLines,
  continentLabelSize,
  labelLines,
} from "./label.js";

describe("labels", () => {
  it("breaks long names at the space nearest the middle", () => {
    expect(labelLines("Japan")).toEqual(["Japan"]);
    expect(labelLines("Osteuropäische Ebene")).toEqual(["Osteuropäische", "Ebene"]);
    expect(labelLines("Wüstenhalbinsel")).toEqual(["Wüstenhalbinsel"]);
  });

  it("breaks only long continent names, at the space nearest the middle", () => {
    expect(continentLabelLines("Europa")).toEqual(["Europa"]);
    expect(continentLabelLines("Vorderasien")).toEqual(["Vorderasien"]);
    expect(continentLabelLines("Karibischer Bogen")).toEqual(["Karibischer", "Bogen"]);
  });

  it("sizes a continent label from the longest line plus the bonus badge", () => {
    expect(continentLabelSize("Europa").width).toBe(
      6 * CONTINENT_CHAR_PX + BADGE_GAP_PX + BADGE_PX,
    );
    expect(continentLabelSize("Karibischer Bogen").height).toBeGreaterThan(
      continentLabelSize("Europa").height,
    );
  });
});
