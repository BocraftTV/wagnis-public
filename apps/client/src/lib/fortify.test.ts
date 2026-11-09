import { describe, expect, it } from "vitest";
import type { GameViewMessage } from "@wagnis/shared";
import { emptySelection } from "./attack.js";
import {
  effectiveMove,
  fortifyOrigins,
  fortifyTargets,
  pruneFortifySelection,
  selectionAfterFortifyTap,
} from "./fortify.js";

type Territories = GameViewMessage["territories"];
type Fortify = NonNullable<GameViewMessage["fortify"]>;

const t = (ownerId: string, armies: number) => ({
  ownerId,
  armies,
  maxAttackDice: 0,
  maxMove: Math.max(0, armies - 1),
});

const territories: Territories = {
  a: t("me", 5),
  b: t("me", 1),
  c: t("me", 3),
  d: t("foe", 4),
  e: t("me", 2),
};
// Deliberately not what the map would give: the client must show exactly what the view says.
const connected: Fortify = { reach: "connected", groups: [["a", "b", "c"]] };
const adjacent: Fortify = { reach: "adjacent", targets: { a: ["b"], c: ["a", "b"] } };

describe("fortifyTargets", () => {
  it("takes the group of the origin without the origin itself", () => {
    expect(fortifyTargets(connected, "a")).toEqual(["b", "c"]);
    expect(fortifyTargets(connected, "e")).toEqual([]);
  });
  it("takes the listed targets for the adjacent variant", () => {
    expect(fortifyTargets(adjacent, "c")).toEqual(["a", "b"]);
    expect(fortifyTargets(adjacent, "b")).toEqual([]);
  });
  it("is empty without view data or origin", () => {
    expect(fortifyTargets(null, "a")).toEqual([]);
    expect(fortifyTargets(connected, null)).toEqual([]);
  });
});

describe("fortifyOrigins", () => {
  it("lists listed own territories that have armies to move", () => {
    expect(fortifyOrigins(connected, territories, "me")).toEqual(["a", "c"]); // b has maxMove 0
    expect(fortifyOrigins(adjacent, territories, "me")).toEqual(["a", "c"]);
    expect(fortifyOrigins(null, territories, "me")).toEqual([]);
  });
});

describe("selection", () => {
  it("selects an origin, then a target, toggles the target", () => {
    const from = selectionAfterFortifyTap(emptySelection, "a", connected, territories, "me");
    expect(from).toEqual({ from: "a", to: null });
    const to = selectionAfterFortifyTap(from, "b", connected, territories, "me");
    expect(to).toEqual({ from: "a", to: "b" });
    expect(selectionAfterFortifyTap(to, "b", connected, territories, "me")).toEqual(from);
  });
  it("lets a target that could also be an origin be a target while an origin is set", () => {
    const from = { from: "a", to: null };
    expect(selectionAfterFortifyTap(from, "c", connected, territories, "me")).toEqual({
      from: "a",
      to: "c",
    });
  });
  it("deselects the origin on a second tap and ignores unlisted territories", () => {
    const from = { from: "a", to: null };
    expect(selectionAfterFortifyTap(from, "a", connected, territories, "me")).toEqual(
      emptySelection,
    );
    expect(selectionAfterFortifyTap(from, "d", connected, territories, "me")).toEqual(from);
    expect(selectionAfterFortifyTap(emptySelection, "e", connected, territories, "me")).toEqual(
      emptySelection,
    );
  });
  it("highlights per adjacent targets, not per group", () => {
    const from = selectionAfterFortifyTap(emptySelection, "a", adjacent, territories, "me");
    expect(selectionAfterFortifyTap(from, "c", adjacent, territories, "me")).toEqual({
      from: "c",
      to: null,
    });
  });
  it("prunes what a new snapshot invalidates", () => {
    const sel = { from: "a", to: "b" };
    expect(pruneFortifySelection(sel, connected, territories, "me")).toEqual(sel);
    expect(pruneFortifySelection(sel, null, territories, "me")).toEqual(emptySelection);
    expect(pruneFortifySelection(sel, connected, { ...territories, a: t("me", 1) }, "me")).toEqual(
      emptySelection,
    );
    expect(
      pruneFortifySelection(sel, { reach: "adjacent", targets: { a: ["c"] } }, territories, "me"),
    ).toEqual({
      from: "a",
      to: null,
    });
  });
});

describe("effectiveMove", () => {
  it("defaults to the reported maximum and stays within 1 … max", () => {
    expect(effectiveMove(null, 4)).toBe(4);
    expect(effectiveMove(2, 4)).toBe(2);
    expect(effectiveMove(9, 4)).toBe(4);
    expect(effectiveMove(0, 4)).toBe(1);
    expect(effectiveMove(null, 0)).toBe(0);
  });
});
