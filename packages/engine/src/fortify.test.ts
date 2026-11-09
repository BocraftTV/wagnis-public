import { describe, expect, it } from "vitest";
import { applyAction, createSeededRng, testlandRules } from "./index.js";
import type { Action, GameState } from "./index.js";
import { makeState, totalArmies } from "./testkit.js";

const rng = createSeededRng(1);

/**
 * a owns the chain eisenfurt (A) - rabenhain (B) - tannenfeld (C) and salzmoor (D); b owns grauwacht,
 * which lies between A and D, so D is only reachable through a foreign territory.
 */
function setup(
  reach: "connected" | "adjacent",
  overrides: Partial<GameState> = {},
  armies = { A: 5, B: 2, C: 3, D: 4 },
): GameState {
  return makeState({
    phase: "fortify",
    territories: {
      eisenfurt: ["a", armies.A],
      rabenhain: ["a", armies.B],
      tannenfeld: ["a", armies.C],
      salzmoor: ["a", armies.D],
      grauwacht: ["b", 2],
    },
    overrides: { rules: { ...testlandRules, fortifyReach: reach }, ...overrides },
  });
}

const move = (from: string, to: string, count: number): Action => ({
  type: "fortify",
  from,
  to,
  count,
});
const run = (s: GameState, a: Action, p = s.activePlayerId) => applyAction(s, p, a, rng);
const code = (s: GameState, a: Action, p = s.activePlayerId): string | undefined => {
  const r = run(s, a, p);
  return r.ok ? undefined : r.code;
};

describe.each(["connected", "adjacent"] as const)("fortify with fortifyReach %s", (reach) => {
  it("accepts a direct neighbour", () => {
    const s = setup(reach);
    const r = run(s, move("eisenfurt", "rabenhain", 2));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.territories["eisenfurt"]!.armies).toBe(3);
    expect(r.state.territories["rabenhain"]!.armies).toBe(4);
  });

  it("rejects a target behind a chain through a foreign territory with NOT_CONNECTED, state unchanged", () => {
    const s = setup(reach);
    const before = structuredClone(s);
    expect(run(s, move("eisenfurt", "salzmoor", 1))).toEqual({ ok: false, code: "NOT_CONNECTED" });
    expect(s).toEqual(before);
  });

  it("ends the turn after the move: a second fortify is NOT_YOUR_TURN", () => {
    const s = setup(reach);
    const r = run(s, move("eisenfurt", "rabenhain", 1));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.activePlayerId).toBe("b");
    expect(code(r.state, move("eisenfurt", "rabenhain", 1), "a")).toBe("NOT_YOUR_TURN");
  });

  it("keeps at least 1 army: count = armies is INVALID_COUNT, so are 0 and fractions; armies - 1 is fine", () => {
    const s = setup(reach);
    for (const count of [5, 6, 0, -1, 1.5, Number.NaN]) {
      expect(code(s, move("eisenfurt", "rabenhain", count)), String(count)).toBe("INVALID_COUNT");
    }
    const r = run(s, move("eisenfurt", "rabenhain", 4));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.state.territories["eisenfurt"]!.armies).toBe(1);
  });

  it("checks owner, same territory and phase", () => {
    const s = setup(reach);
    expect(code(s, move("grauwacht", "eisenfurt", 1))).toBe("NOT_OWNER");
    expect(code(s, move("eisenfurt", "grauwacht", 1))).toBe("NOT_OWNER");
    expect(code(s, move("eisenfurt", "eisenfurt", 1))).toBe("SAME_TERRITORY");
    expect(code(s, move("nope", "eisenfurt", 1))).toBe("UNKNOWN_TERRITORY");
    expect(code(s, move("eisenfurt", "nope", 1))).toBe("UNKNOWN_TERRITORY");
    expect(code(s, move("constructor", "eisenfurt", 1))).toBe("UNKNOWN_TERRITORY");
    for (const phase of ["reinforce", "attack"] as const) {
      expect(code({ ...s, phase }, move("eisenfurt", "rabenhain", 1))).toBe("WRONG_PHASE");
    }
  });

  it("follows the order of checks of rules.md 5.3", () => {
    const s = setup(reach);
    const bad = move("grauwacht", "grauwacht", 99);
    // Everything wrong at once: the first check in the list wins.
    expect(code(s, bad, "b")).toBe("NOT_YOUR_TURN");
    expect(code({ ...s, winnerId: "a" }, bad)).toBe("GAME_OVER");
    expect(
      code({ ...s, pendingOccupation: { from: "eisenfurt", to: "grauwacht", min: 1 } }, bad),
    ).toBe("OCCUPY_PENDING");
    expect(code({ ...s, phase: "attack" }, bad)).toBe("WRONG_PHASE");
    expect(code(s, move("nope", "grauwacht", 99))).toBe("UNKNOWN_TERRITORY");
    expect(code(s, bad)).toBe("NOT_OWNER");
    expect(code(s, move("eisenfurt", "eisenfurt", 99))).toBe("SAME_TERRITORY");
    expect(code(s, move("eisenfurt", "salzmoor", 99))).toBe("NOT_CONNECTED");
    expect(code(s, move("eisenfurt", "rabenhain", 99))).toBe("INVALID_COUNT");
  });

  it("keeps the total number of armies and emits armiesFortified", () => {
    const s = setup(reach);
    const r = run(s, move("eisenfurt", "rabenhain", 3));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(totalArmies(r.state)).toBe(totalArmies(s));
    expect(r.events[0]).toEqual({
      type: "armiesFortified",
      playerId: "a",
      from: "eisenfurt",
      to: "rabenhain",
      count: 3,
    });
  });

  it("ends the turn automatically: next player in reinforce, flags reset, reinforcements worked out", () => {
    const s = setup(reach, {
      conqueredThisTurn: true,
      combatSeq: 3,
      lastCombat: {
        seq: 3,
        attackerId: "a",
        defenderId: "b",
        from: "eisenfurt",
        to: "grauwacht",
        rolls: [],
        summary: { rollCount: 0, attackerLosses: 0, defenderLosses: 0, conquered: false },
      },
    });
    const r = run(s, move("eisenfurt", "rabenhain", 1));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state).toMatchObject({
      activePlayerId: "b",
      phase: "reinforce",
      turn: 2,
      reinforcementsLeft: 3,
      conqueredThisTurn: false,
      lastCombat: null,
      combatSeq: 3,
    });
    // The conquest of this turn earns the card, drawn between the move and the turn change.
    expect(r.events.map((e) => e.type)).toEqual([
      "armiesFortified",
      "cardDrawn",
      "phaseChanged",
      "turnStarted",
    ]);
    expect(r.state.secret.hand["a"]).toHaveLength(1);
  });

  it("endPhase in fortify skips the move and ends the turn too", () => {
    const s = setup(reach);
    const r = run(s, { type: "endPhase" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.activePlayerId).toBe("b");
    expect(r.state.phase).toBe("reinforce");
    expect(r.state.territories).toEqual(s.territories);
  });
});

describe("fortify reach differences", () => {
  it("connected: reaches C over B and takes the armies", () => {
    const s = setup("connected");
    const r = run(s, move("eisenfurt", "tannenfeld", 3));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.territories["eisenfurt"]!.armies).toBe(2);
    expect(r.state.territories["tannenfeld"]!.armies).toBe(6);
  });

  it("connected: the chain may not run through a foreign territory even if both ends are own", () => {
    // Own: eisenfurt and tannenfeld; both possible links (rabenhain, grauwacht) belong to b.
    const s = makeState({
      phase: "fortify",
      territories: {
        eisenfurt: ["a", 4],
        tannenfeld: ["a", 2],
        rabenhain: ["b", 1],
        grauwacht: ["b", 1],
      },
    });
    expect(code(s, move("eisenfurt", "tannenfeld", 1))).toBe("NOT_CONNECTED");
  });

  it("adjacent: C is only reachable over a chain, so NOT_CONNECTED", () => {
    const s = setup("adjacent");
    expect(code(s, move("eisenfurt", "tannenfeld", 1))).toBe("NOT_CONNECTED");
  });
});
