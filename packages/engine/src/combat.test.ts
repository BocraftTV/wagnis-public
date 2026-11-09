import { describe, expect, it } from "vitest";
import { createDiceRng, createSeededRng } from "./index.js";
import { resolveRoll, rollDice } from "./combat.js";

describe("resolveRoll", () => {
  it("3 against 2 dice: 6-3-1 vs 5-3 costs each side one army, the third die expires", () => {
    expect(resolveRoll([6, 3, 1], [5, 3])).toEqual({ attackerLosses: 1, defenderLosses: 1 });
  });
  it("a tie goes to the defender", () => {
    expect(resolveRoll([4], [4])).toEqual({ attackerLosses: 1, defenderLosses: 0 });
  });
  it("1 die against 2 dice compares only the highest", () => {
    expect(resolveRoll([5], [4, 6])).toEqual({ attackerLosses: 1, defenderLosses: 0 });
    expect(resolveRoll([6], [4, 6])).toEqual({ attackerLosses: 1, defenderLosses: 0 });
    expect(resolveRoll([6], [4, 5])).toEqual({ attackerLosses: 0, defenderLosses: 1 });
  });
  it("2 dice against 1 die compares only the highest", () => {
    expect(resolveRoll([6, 1], [5])).toEqual({ attackerLosses: 0, defenderLosses: 1 });
    expect(resolveRoll([3, 2], [5])).toEqual({ attackerLosses: 1, defenderLosses: 0 });
  });
  it("surplus attacker dice are ignored", () => {
    expect(resolveRoll([6, 6, 6], [1])).toEqual({ attackerLosses: 0, defenderLosses: 1 });
  });
  it("both pairs can go to the attacker or the defender", () => {
    expect(resolveRoll([6, 5, 4], [3, 2])).toEqual({ attackerLosses: 0, defenderLosses: 2 });
    expect(resolveRoll([3, 2, 1], [6, 5])).toEqual({ attackerLosses: 2, defenderLosses: 0 });
  });
  it("sorts unsorted input", () => {
    expect(resolveRoll([1, 3, 6], [3, 5])).toEqual({ attackerLosses: 1, defenderLosses: 1 });
  });
  it("loses at least one army per roll and at most two", () => {
    for (const a of [1, 2, 3])
      for (const d of [1, 2]) {
        const r = resolveRoll(Array<number>(a).fill(3), Array<number>(d).fill(3));
        expect(r.attackerLosses + r.defenderLosses).toBe(Math.min(a, d));
      }
  });
});

describe("rollDice", () => {
  it("draws in order and returns the dice sorted descending", () => {
    expect(rollDice(createDiceRng([2, 6, 4]), 3)).toEqual([6, 4, 2]);
  });
  it("draws faces 1 to 6 from a seeded rng", () => {
    const rng = createSeededRng(9);
    const seen = new Set(rollDice(rng, 500));
    expect([...seen].sort()).toEqual([1, 2, 3, 4, 5, 6]);
  });
  it("draws nothing for zero dice", () => {
    expect(rollDice(createDiceRng([]), 0)).toEqual([]);
  });
});

describe("createDiceRng", () => {
  it("throws when the sequence is exhausted instead of guessing", () => {
    const rng = createDiceRng([3]);
    expect(rng.int(6)).toBe(2);
    expect(rng.remaining()).toBe(0);
    expect(() => rng.int(6)).toThrow(/exhausted/);
  });
  it("throws for anything but a die", () => {
    expect(() => createDiceRng([3]).int(4)).toThrow();
  });
});
