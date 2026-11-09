import { describe, expect, it } from "vitest";
import { applyAction, createDiceRng, createSeededRng, MAX_COMBAT_ROLLS } from "./index.js";
import type { Action, ActionErrorCode, GameEvent, GameState } from "./index.js";
import { makeState, totalArmies } from "./testkit.js";

const duel = (attackerArmies: number, defenderArmies: number) =>
  makeState({
    territories: { eisenfurt: ["a", attackerArmies], rabenhain: ["b", defenderArmies] },
  });

const blitz: Action = { type: "blitz", from: "eisenfurt", to: "rabenhain" };

function okRun(state: GameState, action: Action, rng: Parameters<typeof applyAction>[3]) {
  const r = applyAction(state, "a", action, rng);
  if (!r.ok) throw new Error(`unexpected ${r.code}`);
  return r;
}

const rolled = (events: GameEvent[]) =>
  events.filter(
    (e): e is Extract<GameEvent, { type: "attackRolled" }> => e.type === "attackRolled",
  );

describe("blitz: validation", () => {
  it("uses the attack checks (without a dice check)", () => {
    const code = (s: GameState, a: Action): ActionErrorCode | "OK" => {
      const r = applyAction(s, "a", a, createDiceRng([]));
      return r.ok ? "OK" : r.code;
    };
    expect(code({ ...duel(4, 3), phase: "reinforce" }, blitz)).toBe("WRONG_PHASE");
    expect(code(duel(4, 3), { ...blitz, to: "nowhere" })).toBe("UNKNOWN_TERRITORY");
    expect(code(duel(4, 3), { ...blitz, from: "rabenhain", to: "eisenfurt" })).toBe("NOT_OWNER");
    expect(
      code(makeState({ territories: { eisenfurt: ["a", 3], rabenhain: ["a", 3] } }), blitz),
    ).toBe("OWN_TARGET");
    expect(code(duel(4, 3), { ...blitz, to: "salzmoor" })).toBe("NOT_ADJACENT");
    expect(code(duel(1, 3), blitz)).toBe("NOT_ENOUGH_ARMIES");
  });

  it("leaves the state unchanged when rejected", () => {
    const s = duel(1, 3);
    const copy = structuredClone(s);
    expect(applyAction(s, "a", blitz, createDiceRng([]))).toEqual({
      ok: false,
      code: "NOT_ENOUGH_ARMIES",
    });
    expect(s).toEqual(copy);
  });
});

describe("blitz: rolling", () => {
  it("repeats with the maximum dice until the territory falls, one event per roll", () => {
    // 5 vs 2: roll 1 (3 dice): 6,5,4 vs 3,2 -> defender loses 2 -> conquered with 3 dice, 5 armies kept.
    const rng = createDiceRng([6, 5, 4, 3, 2]);
    const r = okRun(duel(5, 2), blitz, rng);
    expect(rng.remaining()).toBe(0);
    expect(rolled(r.events)).toHaveLength(1);
    expect(r.state.territories["rabenhain"]).toEqual({ ownerId: "a", armies: 3 });
    expect(r.state.pendingOccupation).toEqual({ from: "eisenfurt", to: "rabenhain", min: 3 });
  });

  it("recomputes the dice every roll and stops with 1 army left", () => {
    // 4 vs 5. Roll 1: 3 dice 1,1,1 vs 6,6 -> attacker loses 2 (4->2).
    // Roll 2: 1 die (2-1) 1 vs 6,6 -> attacker loses 1 (2->1). Stop.
    const rng = createDiceRng([1, 1, 1, 6, 6, 1, 6, 6]);
    const r = okRun(duel(4, 5), blitz, rng);
    expect(rng.remaining()).toBe(0);
    expect(rolled(r.events).map((e) => e.attackerDice.length)).toEqual([3, 1]);
    expect(r.state.territories["eisenfurt"]!.armies).toBe(1);
    expect(r.state.territories["rabenhain"]).toEqual({ ownerId: "b", armies: 5 });
    expect(r.state.conqueredThisTurn).toBe(false);
    expect(r.state.pendingOccupation).toBeNull();
    expect(r.state.lastCombat!.summary).toEqual({
      rollCount: 2,
      attackerLosses: 3,
      defenderLosses: 0,
      conquered: false,
    });
  });

  it("uses one defender die against a single army", () => {
    // 2 vs 1: attacker 1 die 2 vs defender 1 die 1 -> conquered.
    const r = okRun(duel(2, 1), blitz, createDiceRng([2, 1]));
    expect(rolled(r.events)[0]!.defenderDice).toEqual([1]);
    // Min 1 = max 1: moved in automatically.
    expect(r.state.pendingOccupation).toBeNull();
    expect(r.state.territories["rabenhain"]).toEqual({ ownerId: "a", armies: 1 });
    expect(r.state.territories["eisenfurt"]!.armies).toBe(1);
  });

  it("after a conquest asks for occupy with the dice of the last roll as minimum", () => {
    // 6 vs 3. Roll 1: 3 dice 6,6,6 vs 1,1 -> defender 3->1. Roll 2: 3 dice vs 1 die -> conquered, min 3.
    const rng = createDiceRng([6, 6, 6, 1, 1, 5, 5, 5, 2]);
    const r = okRun(duel(6, 3), blitz, rng);
    expect(rolled(r.events)).toHaveLength(2);
    expect(r.events.map((e) => e.type)).toEqual([
      "attackRolled",
      "attackRolled",
      "territoryConquered",
      "armiesMoved",
    ]);
    expect(r.state.pendingOccupation).toEqual({ from: "eisenfurt", to: "rabenhain", min: 3 });
    expect(r.state.territories["eisenfurt"]!.armies).toBe(3);
    expect(r.state.territories["rabenhain"]).toEqual({ ownerId: "a", armies: 3 });
    const blocked = applyAction(r.state, "a", blitz, createDiceRng([]));
    expect(blocked).toEqual({ ok: false, code: "OCCUPY_PENDING" });
  });

  it("always ends: many seeds, minimal and large armies", () => {
    const sizes: [number, number][] = [
      [2, 1],
      [2, 2],
      [2, 30],
      [30, 2],
      [3, 3],
      [10, 10],
      [50, 50],
    ];
    for (const [a, d] of sizes) {
      for (let seed = 1; seed <= 60; seed++) {
        const before = duel(a, d);
        const r = okRun(before, blitz, createSeededRng(seed));
        const events = rolled(r.events);
        expect(events.length).toBeGreaterThan(0);
        expect(events.length).toBeLessThanOrEqual(a + d);
        const from = r.state.territories["eisenfurt"]!;
        const to = r.state.territories["rabenhain"]!;
        expect(from.armies).toBeGreaterThanOrEqual(1);
        expect(to.armies).toBeGreaterThanOrEqual(1);
        const conquered = to.ownerId === "a";
        // Ended by conquest, or the attacker is down to 1 army.
        if (conquered) expect(r.state.lastCombat!.summary.conquered).toBe(true);
        else expect(from.armies).toBe(1);
        // Armies are only lost, never created.
        const lost = events.reduce((n, e) => n + e.attackerLosses + e.defenderLosses, 0);
        expect(totalArmies(r.state)).toBe(totalArmies(before) - lost);
        expect(r.state.lastCombat!.summary.rollCount).toBe(events.length);
      }
    }
  });
});

describe("blitz: lastCombat cut", () => {
  it("keeps the last 20 rolls and summarises all, events stay complete", () => {
    let found = false;
    for (let seed = 1; seed <= 20 && !found; seed++) {
      const r = okRun(duel(60, 60), blitz, createSeededRng(seed));
      const events = rolled(r.events);
      const combat = r.state.lastCombat!;
      if (events.length <= MAX_COMBAT_ROLLS) continue;
      found = true;
      expect(combat.rolls).toHaveLength(MAX_COMBAT_ROLLS);
      expect(combat.summary.rollCount).toBe(events.length);
      expect(combat.rolls).toEqual(
        events.slice(-MAX_COMBAT_ROLLS).map((e) => ({
          attackerDice: e.attackerDice,
          defenderDice: e.defenderDice,
          attackerLosses: e.attackerLosses,
          defenderLosses: e.defenderLosses,
        })),
      );
      expect(combat.summary.attackerLosses).toBe(events.reduce((n, e) => n + e.attackerLosses, 0));
      expect(combat.summary.defenderLosses).toBe(events.reduce((n, e) => n + e.defenderLosses, 0));
      expect(combat.summary.conquered).toBe(r.state.territories["rabenhain"]!.ownerId === "a");
      expect(combat.seq).toBe(1);
    }
    expect(found).toBe(true);
  });

  // Every roll costs the attacker exactly 1 army and the defender stays large: N armies give N - 1 rolls.
  const slowLoss = (armies: number): number[] => {
    const faces: number[] = [];
    for (let a = armies; a > 1; a--) {
      const dice = Math.min(3, a - 1);
      faces.push(...[6, 1, 1].slice(0, dice === 1 ? 0 : dice), ...(dice === 1 ? [1] : []), 5, 5);
    }
    return faces;
  };

  it.each([
    [21, 20],
    [22, 21],
    [5, 4],
  ])(
    "%i armies give %i rolls; at most 20 are kept, the summary counts all",
    (armies, rollCount) => {
      const r = okRun(duel(armies, 99), blitz, createDiceRng(slowLoss(armies)));
      const combat = r.state.lastCombat!;
      expect(rolled(r.events)).toHaveLength(rollCount);
      expect(combat.summary).toEqual({
        rollCount,
        attackerLosses: rollCount,
        defenderLosses: rollCount - 1, // all but the last roll (1 die) also cost the defender 1
        conquered: false,
      });
      expect(combat.rolls).toHaveLength(Math.min(rollCount, MAX_COMBAT_ROLLS));
    },
  );
});
