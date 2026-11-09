import { describe, expect, it } from "vitest";
import { wsErrorCodeSchema } from "@wagnis/shared";
import type { GameViewMessage } from "@wagnis/shared";
import {
  SeenTrades,
  bonusChoices,
  bonusToSend,
  kindName,
  matchingSuggestion,
  pruneChoice,
  toggleChoice,
  tradeLine,
} from "./cards.js";
import type { Card, SuggestedSet, Trade } from "./cards.js";
import { wsErrorText } from "./messages.js";

const card = (id: string, kind: Card["kind"], territoryId: string | null = null): Card => ({
  id,
  kind,
  territoryId,
  bonusEligible: false,
});

describe("error texts", () => {
  it("has a German text for every new fortify and card code", () => {
    for (const code of [
      "SAME_TERRITORY",
      "NOT_CONNECTED",
      "MUST_TRADE",
      "INVALID_SET",
      "UNKNOWN_CARD",
      "INVALID_BONUS_TERRITORY",
    ] as const) {
      expect(wsErrorText[code], code).toMatch(/\S/);
    }
  });
  it("has a text for every code the protocol knows", () => {
    for (const code of wsErrorCodeSchema.options) expect(wsErrorText[code], code).toBeTruthy();
  });
});

describe("kindName", () => {
  it("names all four kinds", () => {
    expect(Object.keys(kindName).sort()).toEqual(["artillery", "cavalry", "infantry", "joker"]);
  });
});

describe("toggleChoice", () => {
  it("adds, removes and lets a fourth card replace the oldest", () => {
    expect(toggleChoice([], "a")).toEqual(["a"]);
    expect(toggleChoice(["a", "b"], "a")).toEqual(["b"]);
    expect(toggleChoice(["a", "b", "c"], "d")).toEqual(["b", "c", "d"]);
  });
});

describe("matchingSuggestion", () => {
  const sets: SuggestedSet[] = [
    { cardIds: ["a", "b", "c"], value: 10, bonusTerritoryId: "x" },
    { cardIds: ["a", "b", "d"], value: 4, bonusTerritoryId: null },
  ];
  it("takes over the suggestion with exactly the chosen cards, in any order", () => {
    expect(matchingSuggestion(["c", "a", "b"], sets)).toBe(sets[0]);
    expect(matchingSuggestion(["a", "b", "d"], sets)).toBe(sets[1]);
  });
  it("finds nothing for a free choice or an incomplete one (the server decides)", () => {
    expect(matchingSuggestion(["a", "c", "d"], sets)).toBeUndefined();
    expect(matchingSuggestion(["a", "b"], sets)).toBeUndefined();
    expect(matchingSuggestion([], [])).toBeUndefined();
  });
});

describe("pruneChoice", () => {
  const hand = [card("a", "infantry"), card("b", "joker")];
  it("keeps the same array when nothing changed, drops cards no longer in the hand", () => {
    const sel = ["a", "b"];
    expect(pruneChoice(sel, hand)).toBe(sel);
    expect(pruneChoice(["a", "gone"], hand)).toEqual(["a"]);
  });
});

describe("SeenTrades", () => {
  it("reports each seq once per room, also after a reconnect", () => {
    const seen = new SeenTrades();
    expect(seen.markIfNew("R", 1, 1)).toBe(true);
    expect(seen.markIfNew("R", 1, 1)).toBe(false); // same snapshot again after reconnect
    expect(seen.markIfNew("R", 1, 2)).toBe(true);
    expect(seen.markIfNew("R", 1, 2)).toBe(false);
    expect(seen.markIfNew("R", 1, 1)).toBe(false); // never goes back
    expect(seen.markIfNew("OTHER", 1, 1)).toBe(true);
  });
  it("treats a trade as new on a fresh page (no memory)", () => {
    expect(new SeenTrades().markIfNew("R", 1, 5)).toBe(true);
  });
  it("counts every seq of a sequence exactly once, even with repeated snapshots", () => {
    const seen = new SeenTrades();
    const snapshots = [1, 1, 2, 2, 2, 3, 3];
    expect(snapshots.filter((s) => seen.markIfNew("R", 1, s))).toEqual([1, 2, 3]);
  });
});

describe("tradeLine", () => {
  const trade: Trade = {
    seq: 1,
    playerId: "p1",
    cards: [card("1", "infantry", "x"), card("2", "cavalry", "y"), card("3", "joker")],
    armies: 10,
    bonusTerritoryId: "x",
  };
  const name = (id: string) => (id === "p1" ? "Anna" : "?");
  const place = (id: string) => `Gebiet ${id}`;
  it("shows player, cards and the value from the record, plus the bonus territory", () => {
    expect(tradeLine(trade, name, place)).toBe(
      "Anna hat getauscht: Infanterie, Kavallerie, Joker → 10 Armeen, Bonus auf Gebiet x",
    );
  });
  it("omits the bonus when the record has none", () => {
    expect(tradeLine({ ...trade, bonusTerritoryId: null }, name, place)).toBe(
      "Anna hat getauscht: Infanterie, Kavallerie, Joker → 10 Armeen",
    );
  });
});

// Compile-time guard: the helper types follow the shared view schema.
const _check: GameViewMessage["secret"]["hand"] = [] as Card[];
void _check;

describe("bonus territory choice", () => {
  const hand: Card[] = [
    { ...card("c1", "infantry", "t1"), bonusEligible: true },
    { ...card("c2", "cavalry", "t2"), bonusEligible: false }, // not owned
    { ...card("c3", "artillery", "t3"), bonusEligible: true },
    card("c4", "joker"),
    { ...card("c5", "infantry", "t1"), bonusEligible: true }, // same territory as c1
  ];

  it("offers only territories of chosen cards marked bonusEligible, in card order, once", () => {
    expect(bonusChoices(hand, ["c1", "c2", "c3"])).toEqual(["t1", "t3"]);
    expect(bonusChoices(hand, ["c3", "c1", "c4"])).toEqual(["t3", "t1"]);
    expect(bonusChoices(hand, ["c1", "c5", "c4"])).toEqual(["t1"]);
    expect(bonusChoices(hand, ["c2", "c4"])).toEqual([]);
    expect(bonusChoices(hand, [])).toEqual([]);
  });

  it("sends nothing without a real choice", () => {
    expect(bonusToSend([], null, null)).toBeUndefined();
    expect(bonusToSend(["t1"], "t1", "t1")).toBeUndefined();
  });

  it("sends the pick, else the suggestion's bonus, else the first choice", () => {
    expect(bonusToSend(["t1", "t3"], "t3", "t1")).toBe("t3");
    expect(bonusToSend(["t1", "t3"], null, "t3")).toBe("t3");
    expect(bonusToSend(["t1", "t3"], null, null)).toBe("t1");
  });

  it("ignores a pick or suggestion that is not among the choices", () => {
    expect(bonusToSend(["t1", "t3"], "t2", "t9")).toBe("t1");
  });
});

describe("SeenTrades per game number (plan 007)", () => {
  it("seq starts at 1 again in the next game of the room: it is new again, and the old game stays remembered", () => {
    const seen = new SeenTrades();
    expect(seen.markIfNew("R", 1, 1)).toBe(true);
    expect(seen.markIfNew("R", 1, 5)).toBe(true);
    expect(seen.markIfNew("R", 1, 1)).toBe(false);
    expect(seen.markIfNew("R", 2, 1)).toBe(true); // game 2, seq 1 is shown
    expect(seen.markIfNew("R", 2, 1)).toBe(false);
    expect(seen.markIfNew("R", 2, 2)).toBe(true);
    expect(seen.markIfNew("R", 1, 5)).toBe(false); // game 1 is not forgotten
    expect(seen.markIfNew("OTHER", 2, 1)).toBe(true); // another room, same game number
  });
});
