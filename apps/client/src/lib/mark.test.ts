import { describe, expect, it } from "vitest";
import { pickable, territoryMarks } from "./mark.js";
import type { MarkInput } from "./mark.js";

const t = (ownerId: string | null, armies: number) => ({
  ownerId,
  armies,
  maxAttackDice: Math.max(0, Math.min(3, armies - 1)),
  maxMove: Math.max(0, armies - 1),
});
const territories = { a: t("me", 3), b: t("me", 1), c: t("other", 2), d: t(null, 1) };
const ids = ["a", "b", "c", "d", "unknown"];
const input = (over: Partial<MarkInput>): MarkInput => ({
  mode: null,
  me: "me",
  territories,
  selection: { from: null, to: null },
  targets: [],
  moveTargets: [],
  moveOrigins: [],
  ...over,
});

describe("territory marks", () => {
  it("marks nothing without an action, and skips territories the view does not know", () => {
    const marks = territoryMarks(input({}), ids);
    expect(Object.keys(marks)).toEqual(["a", "b", "c", "d"]);
    for (const m of Object.values(marks))
      expect(m).toEqual({ pickable: false, ring: "none", tone: "place" });
  });

  it("placing: every own territory can be picked", () => {
    const marks = territoryMarks(input({ mode: "place" }), ids);
    expect(marks["a"]).toEqual({ pickable: true, ring: "pick", tone: "place" });
    expect(marks["b"]?.pickable).toBe(true);
    expect(marks["c"]?.pickable).toBe(false);
  });

  it("attacking: own territories with dice, then the targets in the attack tone", () => {
    const start = territoryMarks(input({ mode: "attack" }), ids);
    expect(start["a"]).toEqual({ pickable: true, ring: "pick", tone: "place" });
    expect(start["b"]?.pickable).toBe(false);
    expect(start["c"]).toEqual({ pickable: false, ring: "none", tone: "attack" });
    const chosen = input({
      mode: "attack",
      selection: { from: "a", to: "c" },
      targets: ["c", "d"],
    });
    const marks = territoryMarks(chosen, ids);
    expect(marks["a"]).toEqual({ pickable: true, ring: "chosen", tone: "place" });
    expect(marks["c"]).toEqual({ pickable: true, ring: "chosen", tone: "attack" });
    expect(marks["d"]).toEqual({ pickable: true, ring: "pick", tone: "attack" });
  });

  it("fortifying: origins first, then origins and targets, all in the move tone", () => {
    const origins = input({ mode: "fortify", moveOrigins: ["a"] });
    expect(pickable(origins, "a")).toBe(true);
    expect(pickable(origins, "b")).toBe(false);
    const chosen = input({
      mode: "fortify",
      moveOrigins: ["a"],
      moveTargets: ["b"],
      selection: { from: "a", to: null },
    });
    const marks = territoryMarks(chosen, ids);
    expect(marks["a"]).toEqual({ pickable: true, ring: "chosen", tone: "move" });
    expect(marks["b"]).toEqual({ pickable: true, ring: "pick", tone: "move" });
    expect(marks["c"]).toEqual({ pickable: false, ring: "none", tone: "move" });
  });

  it("an unknown territory is never pickable", () => {
    expect(pickable(input({ mode: "place" }), "unknown")).toBe(false);
  });
});
