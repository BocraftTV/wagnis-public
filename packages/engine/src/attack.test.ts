import { describe, expect, it } from "vitest";
import { applyAction, createDiceRng } from "./index.js";
import type { Action, ActionErrorCode, GameEvent, GameState } from "./index.js";
import { makeState, totalArmies } from "./testkit.js";

// testland: eisenfurt-rabenhain, eisenfurt-grauwacht, rabenhain-tannenfeld, grauwacht-tannenfeld,
// grauwacht-salzmoor, salzmoor-dornental, salzmoor-kupferstadt, dornental-nebelkueste, kupferstadt-nebelkueste.

const duel = (attackerArmies: number, defenderArmies: number, overrides?: Partial<GameState>) =>
  makeState({
    territories: { eisenfurt: ["a", attackerArmies], rabenhain: ["b", defenderArmies] },
    overrides,
  });

const attack = (dice: number) => ({
  type: "attack" as const,
  from: "eisenfurt",
  to: "rabenhain",
  dice,
});

function run(state: GameState, action: Action, faces: number[] = [], player = "a") {
  const rng = createDiceRng(faces);
  const result = applyAction(state, player, action, rng);
  return { result, rng };
}

function okRun(state: GameState, action: Action, faces: number[] = [], player = "a") {
  const { result, rng } = run(state, action, faces, player);
  if (!result.ok) throw new Error(`unexpected ${result.code}`);
  return { state: result.state, events: result.events, rng };
}

const codeOf = (state: GameState, action: Action, player = "a"): ActionErrorCode | "OK" => {
  const r = applyAction(state, player, action, createDiceRng([]));
  return r.ok ? "OK" : r.code;
};

describe("attack: validation", () => {
  const base = () => duel(4, 3);

  it("returns each error code and leaves the state unchanged", () => {
    const cases: [string, GameState, Action, ActionErrorCode][] = [
      ["WRONG_PHASE", { ...base(), phase: "reinforce" }, attack(1), "WRONG_PHASE"],
      ["UNKNOWN_TERRITORY (from)", base(), { ...attack(1), from: "nowhere" }, "UNKNOWN_TERRITORY"],
      ["UNKNOWN_TERRITORY (to)", base(), { ...attack(1), to: "nowhere" }, "UNKNOWN_TERRITORY"],
      [
        "UNKNOWN_TERRITORY (prototype key)",
        base(),
        { ...attack(1), to: "constructor" },
        "UNKNOWN_TERRITORY",
      ],
      ["NOT_OWNER", base(), { ...attack(1), from: "rabenhain", to: "eisenfurt" }, "NOT_OWNER"],
      [
        "OWN_TARGET",
        makeState({ territories: { eisenfurt: ["a", 4], rabenhain: ["a", 2] } }),
        attack(1),
        "OWN_TARGET",
      ],
      ["NOT_ADJACENT", base(), { ...attack(1), to: "nebelkueste" }, "NOT_ADJACENT"],
      ["NOT_ENOUGH_ARMIES", duel(1, 3), attack(1), "NOT_ENOUGH_ARMIES"],
      ["INVALID_DICE 0", base(), attack(0), "INVALID_DICE"],
      ["INVALID_DICE 4", base(), attack(4), "INVALID_DICE"],
      ["INVALID_DICE 1.5", base(), attack(1.5), "INVALID_DICE"],
      ["INVALID_DICE NaN", base(), attack(Number.NaN), "INVALID_DICE"],
      ["INVALID_DICE 3 at 3 armies", duel(3, 3), attack(3), "INVALID_DICE"],
      ["NOT_YOUR_TURN", base(), attack(1), "NOT_YOUR_TURN"],
    ];
    for (const [name, state, action, code] of cases) {
      const before = structuredClone(state);
      const player = code === "NOT_YOUR_TURN" ? "b" : "a";
      const { result, rng } = run(state, action, [], player);
      expect(result, name).toEqual({ ok: false, code });
      expect(state, name).toEqual(before);
      expect(rng.remaining()).toBe(0);
    }
  });

  it("reports the first violation in the documented order", () => {
    // Everything wrong at once: wrong phase wins over unknown territory, owner, target, adjacency, armies, dice.
    const bad = { ...duel(1, 3), phase: "fortify" as const };
    expect(codeOf(bad, { type: "attack", from: "x", to: "y", dice: 9 })).toBe("WRONG_PHASE");
    expect(codeOf(duel(1, 3), { type: "attack", from: "x", to: "rabenhain", dice: 9 })).toBe(
      "UNKNOWN_TERRITORY",
    );
    expect(
      codeOf(duel(1, 3), { type: "attack", from: "rabenhain", to: "nebelkueste", dice: 9 }),
    ).toBe("NOT_OWNER");
    const own = makeState({ territories: { eisenfurt: ["a", 1], nebelkueste: ["a", 2] } });
    expect(codeOf(own, { type: "attack", from: "eisenfurt", to: "nebelkueste", dice: 9 })).toBe(
      "OWN_TARGET",
    );
    expect(codeOf(duel(1, 3), { ...attack(9), to: "salzmoor" })).toBe("NOT_ADJACENT");
    expect(codeOf(duel(1, 3), attack(9))).toBe("NOT_ENOUGH_ARMIES");
    expect(codeOf(duel(4, 3), attack(9))).toBe("INVALID_DICE");
  });

  it("checks turn, game over and pending occupation before everything else", () => {
    const junk: Action = { type: "attack", from: "x", to: "y", dice: 9 };
    const pending = {
      ...duel(5, 1),
      phase: "fortify" as const,
      pendingOccupation: { from: "eisenfurt", to: "rabenhain", min: 2 },
    };
    expect(codeOf(pending, junk, "b")).toBe("NOT_YOUR_TURN");
    expect(codeOf(pending, junk)).toBe("OCCUPY_PENDING"); // before WRONG_PHASE and UNKNOWN_TERRITORY
    expect(codeOf(pending, { type: "blitz", from: "x", to: "y" })).toBe("OCCUPY_PENDING");
    const over = { ...pending, winnerId: "a" };
    expect(codeOf(over, junk)).toBe("GAME_OVER"); // before OCCUPY_PENDING and WRONG_PHASE
    expect(codeOf(over, junk, "b")).toBe("NOT_YOUR_TURN"); // before GAME_OVER
  });

  it("does not mutate the input state", () => {
    const s = duel(4, 3);
    const copy = structuredClone(s);
    okRun(s, attack(3), [6, 5, 4, 1, 1]);
    expect(s).toEqual(copy);
  });
});

describe("attack: rolling", () => {
  it("3 against 2 dice: 6-3-1 vs 5-3, each side loses one army", () => {
    const { state, events, rng } = okRun(duel(5, 4), attack(3), [3, 6, 1, 5, 3]);
    expect(rng.remaining()).toBe(0);
    expect(state.territories["eisenfurt"]!.armies).toBe(4);
    expect(state.territories["rabenhain"]!.armies).toBe(3);
    expect(events).toEqual([
      {
        type: "attackRolled",
        playerId: "a",
        defenderId: "b",
        from: "eisenfurt",
        to: "rabenhain",
        attackerDice: [6, 3, 1],
        defenderDice: [5, 3],
        attackerLosses: 1,
        defenderLosses: 1,
      },
    ]);
  });

  it("a tie 4 against 4 costs the attacker one army", () => {
    const { state } = okRun(duel(3, 3), attack(1), [4, 4, 1]);
    expect(state.territories["eisenfurt"]!.armies).toBe(2);
    expect(state.territories["rabenhain"]!.armies).toBe(3);
  });

  it("a defender with 1 army rolls exactly one die", () => {
    const { events, rng } = okRun(duel(4, 1), attack(2), [2, 1, 6]);
    expect(rng.remaining()).toBe(0);
    const e = events[0] as Extract<GameEvent, { type: "attackRolled" }>;
    expect(e.defenderDice).toEqual([6]);
    expect(e.attackerLosses + e.defenderLosses).toBe(1);
  });

  it("a defender with 2 or more armies rolls exactly two dice", () => {
    for (const armies of [2, 3, 9]) {
      const { events, rng } = okRun(duel(4, armies), attack(1), [3, 2, 1]);
      expect(rng.remaining()).toBe(0);
      expect((events[0] as Extract<GameEvent, { type: "attackRolled" }>).defenderDice).toEqual([
        2, 1,
      ]);
    }
  });

  it("rolls the attacker's dice first, then the defender's", () => {
    const { events } = okRun(duel(3, 3), attack(2), [1, 2, 6, 5]);
    const e = events[0] as Extract<GameEvent, { type: "attackRolled" }>;
    expect(e.attackerDice).toEqual([2, 1]);
    expect(e.defenderDice).toEqual([6, 5]);
  });

  it("does not change turn state without a conquest", () => {
    const { state } = okRun(duel(4, 3), attack(3), [1, 1, 1, 6, 6]);
    expect(state.conqueredThisTurn).toBe(false);
    expect(state.pendingOccupation).toBeNull();
    expect(state.phase).toBe("attack");
    expect(state.activePlayerId).toBe("a");
  });

  it("allows any number of attacks per turn", () => {
    let s = duel(10, 10);
    for (let i = 0; i < 3; i++) s = okRun(s, attack(3), [1, 1, 1, 1, 1]).state;
    expect(s.territories["eisenfurt"]!.armies).toBe(10 - 3 * 2);
  });
});

describe("attack: lastCombat", () => {
  it("records the combat with a rising seq", () => {
    const first = okRun(duel(5, 4), attack(3), [3, 6, 1, 5, 3]).state;
    expect(first.combatSeq).toBe(1);
    expect(first.lastCombat).toEqual({
      seq: 1,
      attackerId: "a",
      defenderId: "b",
      from: "eisenfurt",
      to: "rabenhain",
      rolls: [
        { attackerDice: [6, 3, 1], defenderDice: [5, 3], attackerLosses: 1, defenderLosses: 1 },
      ],
      summary: { rollCount: 1, attackerLosses: 1, defenderLosses: 1, conquered: false },
    });
    const second = okRun(first, attack(1), [6, 1, 1]).state;
    expect(second.lastCombat!.seq).toBe(2);
    expect(second.combatSeq).toBe(2);
  });

  it("is left alone by a rejected action, endPhase and occupy", () => {
    const s = okRun(duel(5, 4), attack(3), [3, 6, 1, 5, 3]).state;
    expect(run(s, attack(9)).result.ok).toBe(false);
    expect(okRun(s, { type: "endPhase" }).state.lastCombat).toEqual(s.lastCombat);
  });

  it("is left alone by occupy as well", () => {
    const won = okRun(duel(5, 1), attack(3), [6, 5, 4, 1]).state;
    expect(won.pendingOccupation).not.toBeNull();
    const occupied = okRun(won, { type: "occupy", count: 4 }).state;
    expect(occupied.lastCombat).toEqual(won.lastCombat);
    expect(occupied.combatSeq).toBe(won.combatSeq);
  });
});

describe("conquest and occupy", () => {
  // 5 armies attack with 3 dice and win against a single army: min 3, 2 left behind, 1 beyond the 1 that stays.
  const won = () => okRun(duel(5, 1), attack(3), [6, 5, 4, 1]);

  it("moves the minimum right away and keeps no territory empty", () => {
    const { state, events } = won();
    expect(state.territories["rabenhain"]).toEqual({ ownerId: "a", armies: 3 });
    expect(state.territories["eisenfurt"]!.armies).toBe(2);
    expect(state.conqueredThisTurn).toBe(true);
    expect(state.pendingOccupation).toEqual({ from: "eisenfurt", to: "rabenhain", min: 3 });
    expect(events.map((e) => e.type)).toEqual([
      "attackRolled",
      "territoryConquered",
      "armiesMoved",
    ]);
    expect(events[1]).toEqual({
      type: "territoryConquered",
      playerId: "a",
      previousOwnerId: "b",
      from: "eisenfurt",
      to: "rabenhain",
    });
    expect(events[2]).toEqual({
      type: "armiesMoved",
      playerId: "a",
      from: "eisenfurt",
      to: "rabenhain",
      count: 3,
    });
    expect(state.lastCombat!.summary).toEqual({
      rollCount: 1,
      attackerLosses: 0,
      defenderLosses: 1,
      conquered: true,
    });
  });

  it("rejects occupy 2 and accepts occupy 3 after a 3-dice conquest", () => {
    const { state } = won();
    expect(codeOf(state, { type: "occupy", count: 2 })).toBe("INVALID_OCCUPY_COUNT");
    const done = okRun(state, { type: "occupy", count: 3 });
    expect(done.state.pendingOccupation).toBeNull();
    expect(done.state.territories["rabenhain"]!.armies).toBe(3);
    expect(done.state.territories["eisenfurt"]!.armies).toBe(2);
    expect(done.events).toEqual([]);
  });

  it("allows moving in everything but one army", () => {
    const { state } = won();
    expect(codeOf(state, { type: "occupy", count: 5 })).toBe("INVALID_OCCUPY_COUNT");
    const done = okRun(state, { type: "occupy", count: 4 });
    expect(done.state.territories["rabenhain"]!.armies).toBe(4);
    expect(done.state.territories["eisenfurt"]!.armies).toBe(1);
    expect(done.events).toEqual([
      { type: "armiesMoved", playerId: "a", from: "eisenfurt", to: "rabenhain", count: 1 },
    ]);
  });

  it("rejects non-integer and non-positive occupy counts", () => {
    const { state } = won();
    for (const count of [0, -1, 3.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(codeOf(state, { type: "occupy", count })).toBe("INVALID_OCCUPY_COUNT");
    }
  });

  it("answers OCCUPY_PENDING to every other action until occupy was done", () => {
    const { state } = won();
    const others: Action[] = [
      attack(1),
      { type: "endPhase" },
      { type: "placeArmies", territoryId: "eisenfurt", count: 1 },
    ];
    for (const a of others) expect(codeOf(state, a)).toBe("OCCUPY_PENDING");
    for (const phase of ["reinforce", "fortify"] as const) {
      expect(codeOf({ ...state, phase }, { type: "endPhase" })).toBe("OCCUPY_PENDING");
    }
    const done = okRun(state, { type: "occupy", count: 3 }).state;
    expect(codeOf(done, { type: "endPhase" })).toBe("OK");
  });

  it("leaves the state unchanged after a rejected occupy", () => {
    const { state } = won();
    const before = structuredClone(state);
    for (const count of [0, 2, 5]) {
      expect(applyAction(state, "a", { type: "occupy", count }, createDiceRng([]))).toEqual({
        ok: false,
        code: "INVALID_OCCUPY_COUNT",
      });
    }
    expect(state).toEqual(before);
    const idle = duel(4, 3);
    const idleBefore = structuredClone(idle);
    expect(codeOf(idle, { type: "occupy", count: 1 })).toBe("NO_OCCUPY_PENDING");
    expect(idle).toEqual(idleBefore);
  });

  it("answers OCCUPY_PENDING to placeArmies in every phase", () => {
    const { state } = won();
    for (const phase of ["reinforce", "attack", "fortify"] as const) {
      expect(
        codeOf({ ...state, phase }, { type: "placeArmies", territoryId: "eisenfurt", count: 1 }),
      ).toBe("OCCUPY_PENDING");
    }
  });

  it("answers NO_OCCUPY_PENDING without a conquest", () => {
    expect(codeOf(duel(4, 3), { type: "occupy", count: 1 })).toBe("NO_OCCUPY_PENDING");
  });

  it("moves in automatically when minimum equals maximum", () => {
    // 4 armies, 3 dice: all 3 move in, 1 stays; no extra choice.
    const { state } = okRun(duel(4, 1), attack(3), [6, 5, 4, 1]);
    expect(state.pendingOccupation).toBeNull();
    expect(state.territories["rabenhain"]).toEqual({ ownerId: "a", armies: 3 });
    expect(state.territories["eisenfurt"]!.armies).toBe(1);
    expect(state.conqueredThisTurn).toBe(true);
  });

  it("uses the dice of the winning roll as minimum, not the armies lost", () => {
    // 2 dice against 2 armies, both lost: min 2.
    const { state } = okRun(duel(6, 2), attack(2), [6, 5, 4, 3]);
    expect(state.territories["rabenhain"]).toEqual({ ownerId: "a", armies: 2 });
    expect(state.pendingOccupation).toEqual({ from: "eisenfurt", to: "rabenhain", min: 2 });
    // 1 die against 1 army.
    const one = okRun(duel(6, 1), attack(1), [6, 5]).state;
    expect(one.pendingOccupation).toEqual({ from: "eisenfurt", to: "rabenhain", min: 1 });
  });

  it("can attack on from a territory that just received armies", () => {
    const moved = okRun(won().state, { type: "occupy", count: 4 }).state;
    const next = okRun(
      moved,
      { type: "attack", from: "rabenhain", to: "tannenfeld", dice: 3 },
      [2, 2, 2, 6, 6],
    );
    expect(next.state.territories["rabenhain"]!.armies).toBe(3); // lost 1 to the defender's 6
    expect(next.state.territories["tannenfeld"]!.armies).toBe(1);
  });

  it("keeps the territory total except for losses", () => {
    const before = duel(5, 4);
    const after = okRun(before, attack(3), [3, 6, 1, 5, 3]).state;
    expect(totalArmies(after)).toBe(totalArmies(before) - 2);
    const conquered = won().state;
    expect(totalArmies(conquered)).toBe(totalArmies(duel(5, 1)) - 1);
  });
});
