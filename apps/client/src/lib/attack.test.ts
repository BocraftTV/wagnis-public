import { describe, expect, it } from "vitest";
import type { GameViewMessage } from "@wagnis/shared";
import { getMap } from "@wagnis/engine/map-data";
import {
  SeenCombats,
  combatDisplay,
  effectiveDice,
  eliminatedPlayers,
  emptySelection,
  pairDice,
  pruneSelection,
  selectionAfterTap,
  targetsFrom,
} from "./attack.js";
import { wsErrorText } from "./messages.js";
import { wsErrorCodeSchema } from "@wagnis/shared";

type Territories = GameViewMessage["territories"];

const t = (ownerId: string, armies: number, maxAttackDice: number) => ({
  ownerId,
  armies,
  maxAttackDice,
  maxMove: Math.max(0, armies - 1),
});

const map = getMap("testland")!;
const neighbors = Object.fromEntries(map.territories.map((x) => [x.id, x.neighbors]));

const territories: Territories = {
  eisenfurt: t("me", 5, 3),
  rabenhain: t("foe", 2, 1),
  grauwacht: t("me", 1, 0),
  tannenfeld: t("foe", 3, 2),
  salzmoor: t("me", 2, 1),
  dornental: t("foe", 1, 0),
  kupferstadt: t("me", 4, 3),
  nebelkueste: t("foe", 1, 0),
};

describe("targetsFrom", () => {
  it("lists only neighbouring territories of others (highlight only)", () => {
    expect(targetsFrom(neighbors, territories, "me", "eisenfurt")).toEqual(["rabenhain"]);
    expect(targetsFrom(neighbors, territories, "me", "salzmoor").sort()).toEqual(["dornental"]);
    expect(targetsFrom(neighbors, territories, "me", null)).toEqual([]);
  });
});

describe("selection", () => {
  const targets = ["rabenhain"];
  it("selects an own territory that can attack, ignores one that cannot", () => {
    expect(selectionAfterTap(emptySelection, "eisenfurt", territories, "me", [])).toEqual({
      from: "eisenfurt",
      to: null,
    });
    expect(selectionAfterTap(emptySelection, "grauwacht", territories, "me", [])).toEqual(
      emptySelection,
    );
  });
  it("picks and toggles a target next to the origin", () => {
    const from = { from: "eisenfurt", to: null };
    const picked = selectionAfterTap(from, "rabenhain", territories, "me", targets);
    expect(picked).toEqual({ from: "eisenfurt", to: "rabenhain" });
    expect(selectionAfterTap(picked, "rabenhain", territories, "me", targets)).toEqual(from);
  });
  it("ignores a far enemy and switches origin on another own territory", () => {
    const from = { from: "eisenfurt", to: "rabenhain" };
    expect(selectionAfterTap(from, "nebelkueste", territories, "me", targets)).toEqual(from);
    expect(selectionAfterTap(from, "kupferstadt", territories, "me", targets)).toEqual({
      from: "kupferstadt",
      to: null,
    });
    expect(selectionAfterTap(from, "eisenfurt", territories, "me", targets)).toEqual(
      emptySelection,
    );
  });
  it("prunes what the new snapshot invalidates", () => {
    const sel = { from: "eisenfurt", to: "rabenhain" };
    expect(pruneSelection(sel, territories, "me")).toEqual(sel);
    expect(pruneSelection(sel, { ...territories, rabenhain: t("me", 1, 0) }, "me")).toEqual({
      from: "eisenfurt",
      to: null,
    });
    expect(pruneSelection(sel, { ...territories, eisenfurt: t("me", 1, 0) }, "me")).toEqual(
      emptySelection,
    );
    expect(pruneSelection(sel, { ...territories, eisenfurt: t("foe", 5, 3) }, "me")).toEqual(
      emptySelection,
    );
  });
});

describe("effectiveDice", () => {
  it("defaults to the reported maximum and never exceeds it", () => {
    expect(effectiveDice(null, 3)).toBe(3);
    expect(effectiveDice(2, 3)).toBe(2);
    expect(effectiveDice(3, 2)).toBe(2);
  });
});

describe("pairDice", () => {
  it("pairs the highest dice and marks the lower of each pair, a tie is on the attacker", () => {
    expect(pairDice({ attackerDice: [6, 3, 1], defenderDice: [5, 3] })).toEqual([
      { attacker: 6, defender: 5, loser: "defender" },
      { attacker: 3, defender: 3, loser: "attacker" },
      { attacker: 1, defender: null, loser: null },
    ]);
  });
  it("handles 1 against 2 dice", () => {
    expect(pairDice({ attackerDice: [4], defenderDice: [6, 2] })).toEqual([
      { attacker: 4, defender: 6, loser: "attacker" },
      { attacker: null, defender: 2, loser: null },
    ]);
  });
});

describe("combatDisplay", () => {
  const roll = (n: number) => ({
    attackerDice: [n],
    defenderDice: [1],
    attackerLosses: 0,
    defenderLosses: 1,
  });
  const combat = (rolls: number, kept: number) => ({
    seq: 1,
    attackerId: "a",
    defenderId: "b",
    from: "x",
    to: "y",
    rolls: Array.from({ length: kept }, (_, i) => roll(i + 1)),
    summary: { rollCount: rolls, attackerLosses: 0, defenderLosses: rolls, conquered: false },
  });
  it("shows a single roll without summary", () => {
    const d = combatDisplay(combat(1, 1));
    expect(d.showSummary).toBe(false);
    expect(d.roll?.attackerDice).toEqual([1]);
  });
  it("shows the summary and only the last roll of a blitz, also when cut to 20", () => {
    const d = combatDisplay(combat(35, 20));
    expect(d.showSummary).toBe(true);
    expect(d.rollCount).toBe(35);
    expect(d.roll?.attackerDice).toEqual([20]);
  });
});

describe("SeenCombats", () => {
  it("reports each seq once per room, also after a reconnect", () => {
    const seen = new SeenCombats();
    expect(seen.markIfNew("R", 1, 1)).toBe(true);
    expect(seen.markIfNew("R", 1, 1)).toBe(false); // same snapshot again after reconnect
    expect(seen.markIfNew("R", 1, 2)).toBe(true);
    expect(seen.markIfNew("R", 1, 2)).toBe(false);
    expect(seen.markIfNew("R", 1, 1)).toBe(false); // never goes back
    expect(seen.markIfNew("OTHER", 1, 1)).toBe(true);
  });
  it("treats a combat as new on a fresh page (no memory)", () => {
    expect(new SeenCombats().markIfNew("R", 1, 7)).toBe(true);
  });
});

describe("eliminatedPlayers", () => {
  it("derives players without territories", () => {
    const out = eliminatedPlayers({
      playerOrder: ["me", "foe", "gone"],
      territories,
    });
    expect([...out]).toEqual(["gone"]);
  });
});

describe("error texts", () => {
  it("has a German text for every attack error code", () => {
    for (const code of wsErrorCodeSchema.options) expect(wsErrorText[code], code).toBeTruthy();
  });
});

describe("SeenCombats per game number (plan 007)", () => {
  it("seq starts at 1 again in the next game of the room: it is new again, and the old game stays remembered", () => {
    const seen = new SeenCombats();
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
