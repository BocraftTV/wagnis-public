import { describe, expect, it } from "vitest";
import {
  roundLimitChoices,
  roundLimitHint,
  roundLimitLabel,
  roundText,
  scoreRows,
  winnersText,
} from "./rounds.js";
import { winReasonText } from "./missions.js";

const names = (id: string) => ({ a: "Anna", b: "Ben", c: "Cleo" })[id] ?? "?";

describe("roundText", () => {
  it("shows the limit only when there is one", () => {
    expect(roundText(5, 12)).toBe("Runde 5 von 12");
    expect(roundText(5, null)).toBe("Runde 5");
    expect(roundText(1, 8)).toBe("Runde 1 von 8");
  });
});

describe("lobby texts", () => {
  it("offers off, 8, 12 and 16 in this order", () => {
    expect(roundLimitChoices).toEqual([null, 8, 12, 16]);
  });
  it("labels and hints", () => {
    expect(roundLimitLabel(null)).toBe("Kein Limit");
    expect(roundLimitLabel(12)).toBe("12 Runden");
    expect(roundLimitHint(null)).toMatch(/bis jemand gewinnt/);
    expect(roundLimitHint(8)).toMatch(/Nach 8 Runden/);
    expect(roundLimitHint(8)).toMatch(/vorher gewinnt, gewinnt sofort/);
  });
});

describe("winnersText", () => {
  it("one winner, marked with (du) for oneself", () => {
    expect(winnersText(["a"], "a", names, "b")).toBe("Anna hat gewonnen");
    expect(winnersText(["a"], "a", names, "a")).toBe("Anna (du) hat gewonnen");
  });
  it("several winners after a tie", () => {
    expect(winnersText(["a", "b"], "a", names, "c")).toBe("Anna und Ben haben gewonnen");
    expect(winnersText(["a", "b", "c"], "a", names, "c")).toBe(
      "Anna, Ben und Cleo (du) haben gewonnen",
    );
  });
  it("falls back to winnerId when the list is empty", () => {
    expect(winnersText([], "b", names, "a")).toBe("Ben hat gewonnen");
  });
});

describe("scoreRows", () => {
  it("is empty without a score", () => {
    expect(scoreRows(null, [])).toEqual([]);
  });
  it("keeps the server order and marks the winners", () => {
    const rows = scoreRows(
      [
        { playerId: "a", territories: 4, continentBonus: 2, points: 6, armies: 9 },
        { playerId: "b", territories: 5, continentBonus: 0, points: 5, armies: 7 },
      ],
      ["a"],
    );
    expect(rows).toEqual([
      { playerId: "a", points: 6, detail: "4 Gebiete + 2 Bonus", armies: 9, winner: true },
      { playerId: "b", points: 5, detail: "5 Gebiete", armies: 7, winner: false },
    ]);
  });
});

describe("winReasonText", () => {
  it("names the round limit", () => {
    expect(winReasonText("roundLimit")).toBe("nach dem Rundenlimit");
  });
});
