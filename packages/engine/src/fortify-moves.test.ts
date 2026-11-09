import { describe, expect, it } from "vitest";
import {
  applyAction,
  applyHostAction,
  createGame,
  createSeededRng,
  testland,
  testlandRules,
  viewFor,
} from "./index.js";
import type { Action, GameState, HostAction, RuleConfig } from "./index.js";
import { makeState, totalArmies, withMissions } from "./testkit.js";

// Plan 011, section 7: fortify moves per turn (`rules.fortifyMoves` 1 or 2, rules.md 5.3). testland:
// eisenfurt-rabenhain, eisenfurt-grauwacht, rabenhain-tannenfeld, grauwacht-tannenfeld, grauwacht-salzmoor, ...

const rng = createSeededRng(1);

/**
 * a owns the chain eisenfurt (A) - rabenhain (B) - tannenfeld (C) and salzmoor (D); b owns grauwacht, which lies
 * between A and D, so D is only reachable through a foreign territory.
 */
function setup(
  reach: RuleConfig["fortifyReach"],
  moves: 1 | 2,
  overrides: Partial<GameState> = {},
  armies = { A: 5, B: 2, C: 3, D: 4 },
): GameState {
  return makeState({
    phase: "fortify",
    fortifyMoves: moves,
    territories: {
      eisenfurt: ["a", armies.A],
      rabenhain: ["a", armies.B],
      tannenfeld: ["a", armies.C],
      salzmoor: ["a", armies.D],
      grauwacht: ["b", 2],
    },
    overrides: {
      ...overrides,
      rules: { ...testlandRules, fortifyReach: reach, fortifyMoves: moves },
    },
  });
}

const move = (from: string, to: string, count: number): Action => ({
  type: "fortify",
  from,
  to,
  count,
});
function ok(s: GameState, a: Action, p = s.activePlayerId) {
  const r = applyAction(s, p, a, rng);
  if (!r.ok) throw new Error(`unexpected ${r.code}`);
  return r;
}
const code = (s: GameState, a: Action, p = s.activePlayerId): string | undefined => {
  const r = applyAction(s, p, a, rng);
  return r.ok ? undefined : r.code;
};
const types = (r: { events: { type: string }[] }) => r.events.map((e) => e.type);
const END_OF_TURN = ["armiesFortified", "cardDrawn", "phaseChanged", "turnStarted"];

describe.each(["connected", "adjacent"] as const)(
  "fortifyMoves 1 with fortifyReach %s",
  (reach) => {
    it("the first move ends the turn: counter 0 at the successor, the card of a conquest exactly once", () => {
      const s = setup(reach, 1, { conqueredThisTurn: true });
      const r = ok(s, move("eisenfurt", "rabenhain", 1));
      expect(r.state.activePlayerId).toBe("b");
      expect(r.state.phase).toBe("reinforce");
      expect(r.state.turn).toBe(2);
      expect(r.state.fortifyMovesDone).toBe(0);
      expect(r.state.secret.hand["a"]).toHaveLength(1);
      expect(types(r)).toEqual(END_OF_TURN);
    });

    it("a further fortify is NOT_YOUR_TURN, endPhase skips the move", () => {
      const s = setup(reach, 1);
      const r = ok(s, move("eisenfurt", "rabenhain", 1));
      expect(code(r.state, move("eisenfurt", "rabenhain", 1), "a")).toBe("NOT_YOUR_TURN");
      const skipped = ok(s, { type: "endPhase" });
      expect(skipped.state.activePlayerId).toBe("b");
      expect(skipped.state.fortifyMovesDone).toBe(0);
      expect(skipped.state.territories).toEqual(s.territories);
    });
  },
);

describe.each(["connected", "adjacent"] as const)(
  "fortifyMoves 2 with fortifyReach %s",
  (reach) => {
    it("the first move leaves a active in fortify: counter 1, same turn, no card, only armiesFortified", () => {
      const s = setup(reach, 2, { conqueredThisTurn: true });
      const r = ok(s, move("eisenfurt", "rabenhain", 2));
      expect(r.state.activePlayerId).toBe("a");
      expect(r.state.phase).toBe("fortify");
      expect(r.state.turn).toBe(1);
      expect(r.state.fortifyMovesDone).toBe(1);
      expect(r.state.conqueredThisTurn).toBe(true);
      expect(r.state.secret.hand["a"]).toEqual([]);
      expect(r.state.secret.deck).toEqual(s.secret.deck);
      expect(r.state.reinforcementsLeft).toBe(s.reinforcementsLeft);
      expect(types(r)).toEqual(["armiesFortified"]);
      expect(totalArmies(r.state)).toBe(totalArmies(s));
      expect(r.state.territories["eisenfurt"]!.armies).toBe(3);
      expect(r.state.territories["rabenhain"]!.armies).toBe(4);
    });

    it("the second move ends the turn: counter 0 at the successor, the card of a conquest exactly once", () => {
      const s = setup(reach, 2, { conqueredThisTurn: true });
      const first = ok(s, move("eisenfurt", "rabenhain", 1));
      const second = ok(first.state, move("rabenhain", "tannenfeld", 1));
      expect(second.state.activePlayerId).toBe("b");
      expect(second.state.phase).toBe("reinforce");
      expect(second.state.turn).toBe(2);
      expect(second.state.fortifyMovesDone).toBe(0);
      expect(second.state.conqueredThisTurn).toBe(false);
      expect(second.state.secret.hand["a"]).toHaveLength(1);
      expect(types(second)).toEqual(END_OF_TURN);
      expect(totalArmies(second.state)).toBe(totalArmies(s));
    });

    it("no conquest: no card after the second move", () => {
      const s = setup(reach, 2);
      const second = ok(
        ok(s, move("eisenfurt", "rabenhain", 1)).state,
        move("rabenhain", "eisenfurt", 1),
      );
      expect(second.state.secret.hand["a"]).toEqual([]);
      expect(types(second)).toEqual(["armiesFortified", "phaseChanged", "turnStarted"]);
    });

    it("the same territories and armies may be used again: A -> B, then B -> C, B -> A or A -> B", () => {
      const s = setup(reach, 2);
      const first = ok(s, move("eisenfurt", "rabenhain", 3)).state; // A 2, B 5
      for (const [from, to, count] of [
        ["rabenhain", "tannenfeld", 4], // the armies that just arrived move on
        ["rabenhain", "eisenfurt", 4], // and back
        ["eisenfurt", "rabenhain", 1], // the same pair again
      ] as const) {
        const second = ok(first, move(from, to, count));
        expect(second.state.activePlayerId, `${from} -> ${to}`).toBe("b");
      }
    });

    it("a rejected second move changes nothing and leaves the move available", () => {
      const first = ok(setup(reach, 2), move("eisenfurt", "rabenhain", 1)).state;
      const before = structuredClone(first);
      for (const [a, expected] of [
        [move("eisenfurt", "salzmoor", 1), "NOT_CONNECTED"],
        [move("eisenfurt", "rabenhain", 99), "INVALID_COUNT"],
        [move("grauwacht", "eisenfurt", 1), "NOT_OWNER"],
        [move("eisenfurt", "eisenfurt", 1), "SAME_TERRITORY"],
        [move("nope", "eisenfurt", 1), "UNKNOWN_TERRITORY"],
      ] as const) {
        expect(applyAction(first, "a", a, rng), String(expected)).toEqual({
          ok: false,
          code: expected,
        });
        expect(first).toEqual(before);
      }
      expect(ok(first, move("rabenhain", "eisenfurt", 1)).state.activePlayerId).toBe("b");
    });

    it("the minimum of 1 army is checked against the state after the first move", () => {
      const first = ok(setup(reach, 2), move("eisenfurt", "rabenhain", 4)).state; // A 1, B 6
      expect(code(first, move("eisenfurt", "rabenhain", 1))).toBe("INVALID_COUNT");
      expect(code(first, move("rabenhain", "eisenfurt", 6))).toBe("INVALID_COUNT");
      expect(code(first, move("rabenhain", "eisenfurt", 5))).toBeUndefined();
    });

    it("a third fortify is NOT_YOUR_TURN; the successor's fortify in his reinforce phase is WRONG_PHASE", () => {
      const first = ok(setup(reach, 2), move("eisenfurt", "rabenhain", 1)).state;
      const second = ok(first, move("rabenhain", "eisenfurt", 1)).state;
      const before = structuredClone(second);
      expect(applyAction(second, "a", move("eisenfurt", "rabenhain", 1), rng)).toEqual({
        ok: false,
        code: "NOT_YOUR_TURN",
      });
      expect(second).toEqual(before);
      expect(code(second, move("eisenfurt", "rabenhain", 1), "b")).toBe("WRONG_PHASE");
    });

    it("endPhase after 0 moves and after 1 move ends the turn: counter 0, the card of a conquest once", () => {
      const s = setup(reach, 2, { conqueredThisTurn: true });
      const none = ok(s, { type: "endPhase" });
      expect(none.state.activePlayerId).toBe("b");
      expect(none.state.fortifyMovesDone).toBe(0);
      expect(none.state.secret.hand["a"]).toHaveLength(1);
      const one = ok(ok(s, move("eisenfurt", "rabenhain", 1)).state, { type: "endPhase" });
      expect(one.state.activePlayerId).toBe("b");
      expect(one.state.phase).toBe("reinforce");
      expect(one.state.fortifyMovesDone).toBe(0);
      expect(one.state.secret.hand["a"]).toHaveLength(1);
      expect(types(one)).toEqual(["cardDrawn", "phaseChanged", "turnStarted"]);
    });

    it("the counter starts at 0 in the next turn of the same player: two moves again", () => {
      let s = ok(
        ok(setup(reach, 2), move("eisenfurt", "rabenhain", 1)).state,
        move("rabenhain", "eisenfurt", 1),
      ).state;
      const skipped = applyHostAction(s, { type: "skipTurn", turn: s.turn }, rng);
      if (!skipped.ok) throw new Error(`unexpected ${skipped.code}`);
      s = skipped.state;
      expect(s.activePlayerId).toBe("a");
      expect(s.phase).toBe("reinforce");
      expect(s.fortifyMovesDone).toBe(0);
      const left = s.reinforcementsLeft;
      s = ok(s, { type: "placeArmies", territoryId: "eisenfurt", count: left }).state;
      s = ok(s, { type: "endPhase" }).state; // attack
      s = ok(s, { type: "endPhase" }).state; // fortify
      expect(s.phase).toBe("fortify");
      expect(ok(s, move("eisenfurt", "rabenhain", 1)).state.activePlayerId).toBe("a");
    });

    it("the check order of rules.md 5.3 is unchanged after the first move", () => {
      const first = ok(setup(reach, 2), move("eisenfurt", "rabenhain", 1)).state;
      const bad = move("grauwacht", "grauwacht", 99);
      expect(code(first, bad, "b")).toBe("NOT_YOUR_TURN");
      expect(code({ ...first, winnerId: "a" }, bad)).toBe("GAME_OVER");
      expect(
        code({ ...first, pendingOccupation: { from: "eisenfurt", to: "grauwacht", min: 1 } }, bad),
      ).toBe("OCCUPY_PENDING");
      expect(code({ ...first, phase: "attack" }, bad)).toBe("WRONG_PHASE");
      expect(code(first, bad)).toBe("NOT_OWNER");
    });

    it("a second move is always possible after the first: the armies can go back (rules.md 5.3, question 36)", () => {
      const s = setup(reach, 2);
      const own = ["eisenfurt", "rabenhain", "tannenfeld", "salzmoor"];
      for (const from of own) {
        for (const to of own) {
          for (let count = 1; count < s.territories[from]!.armies; count++) {
            const first = applyAction(s, "a", move(from, to, count), rng);
            if (!first.ok) continue;
            expect(first.state.activePlayerId, `${from} -> ${to} ${count}`).toBe("a");
            const back = applyAction(first.state, "a", move(to, from, 1), rng);
            expect(back.ok, `${from} -> ${to} ${count}: back`).toBe(true);
          }
        }
      }
    });

    it("the same actions end in the same position; only the turn change differs from fortifyMoves 1", () => {
      const one = ok(setup(reach, 1), move("eisenfurt", "rabenhain", 2)).state;
      const two = ok(setup(reach, 2), move("eisenfurt", "rabenhain", 2)).state;
      expect(two.territories).toEqual(one.territories);
      expect(one.activePlayerId).toBe("b");
      expect(two.activePlayerId).toBe("a");
    });
  },
);

describe("a second move on a board with only two own territories (rules.md 5.3, question 36)", () => {
  it.each(["connected", "adjacent"] as const)(
    "fortifyReach %s: the armies can always go back",
    (reach) => {
      const s = makeState({
        phase: "fortify",
        fortifyMoves: 2,
        territories: { eisenfurt: ["a", 4], rabenhain: ["a", 2] },
        overrides: { rules: { ...testlandRules, fortifyReach: reach, fortifyMoves: 2 } },
      });
      const first = ok(s, move("eisenfurt", "rabenhain", 3)).state; // A 1, B 5
      expect(ok(first, move("rabenhain", "eisenfurt", 4)).state.activePlayerId).toBe("b");
    },
  );
});

describe.each([1, 2] as const)(
  "no move possible when the fortify phase begins (fortifyMoves %s, question 37)",
  (moves) => {
    it("every own territory has 1 army: no fortify is valid, only endPhase leads on, the turn does not end by itself", () => {
      const s = makeState({
        phase: "fortify",
        fortifyMoves: moves,
        territories: { eisenfurt: ["a", 1], rabenhain: ["a", 1], tannenfeld: ["a", 1] },
      });
      for (const [from, to] of [
        ["eisenfurt", "rabenhain"],
        ["rabenhain", "tannenfeld"],
        ["tannenfeld", "rabenhain"],
      ] as const) {
        expect(code(s, move(from, to, 1))).toBe("INVALID_COUNT");
      }
      expect(s.activePlayerId).toBe("a");
      const r = ok(s, { type: "endPhase" });
      expect(r.state.activePlayerId).toBe("b");
      expect(r.state.fortifyMovesDone).toBe(0);
    });
  },
);

describe("createGame and fortifyMoves", () => {
  const make = (fortifyMoves: unknown) =>
    createGame({
      map: testland,
      rules: { ...testlandRules, fortifyMoves } as RuleConfig,
      playerIds: ["a", "b", "c"],
      rng: createSeededRng(5),
    });

  it.each([1, 2] as const)("takes %s into state.rules and starts the counter at 0", (value) => {
    const r = make(value);
    if (!r.ok) throw new Error(r.code);
    expect(r.state.rules.fortifyMoves).toBe(value);
    expect(r.state.fortifyMovesDone).toBe(0);
  });

  it.each([[0], [3], [-1], [1.5], ["2"], [true], [null], [undefined], [Number.NaN]])(
    "%j is INVALID_RULES",
    (value) => {
      expect(make(value)).toEqual({ ok: false, code: "INVALID_RULES" });
    },
  );

  it("the same seed gives the same game for both values, apart from the setting", () => {
    const one = make(1);
    const two = make(2);
    if (!one.ok || !two.ok) throw new Error("not created");
    expect({ ...two.state, rules: { ...two.state.rules, fortifyMoves: 1 } }).toEqual(one.state);
    expect(two.events).toEqual(one.events);
  });
});

describe("a win by a fortify move (mission, rules.md 1.2)", () => {
  // Own: A 5, B 2, C 3. Mission: one territory with at least 6 armies.
  const mission = { type: "holdTerritories", count: 1, minArmies: 6 } as const;
  const base = (reach: RuleConfig["fortifyReach"], moves: 1 | 2) =>
    withMissions(setup(reach, moves, { conqueredThisTurn: true }, { A: 5, B: 2, C: 3, D: 1 }), {
      a: mission,
    });

  it.each(["connected", "adjacent"] as const)(
    "setting 2, fortifyReach %s: the first move wins, no turn end, no card, then GAME_OVER",
    (reach) => {
      const r = ok(base(reach, 2), move("tannenfeld", "rabenhain", 2)); // B 4: no win yet
      expect(r.state.winnerId).toBeNull();
      const win = ok(base(reach, 2), move("rabenhain", "eisenfurt", 1)); // A 6
      expect(win.state.winnerId).toBe("a");
      expect(win.state.winReason).toBe("mission");
      expect(win.state.activePlayerId).toBe("a");
      expect(win.state.phase).toBe("fortify");
      expect(win.state.turn).toBe(1);
      expect(win.state.secret.hand["a"]).toEqual([]);
      expect(types(win)).not.toContain("cardDrawn");
      expect(types(win)).not.toContain("turnStarted");
      expect(code(win.state, move("eisenfurt", "rabenhain", 1))).toBe("GAME_OVER");
      expect(code(win.state, { type: "endPhase" })).toBe("GAME_OVER");
    },
  );

  it.each(["connected", "adjacent"] as const)(
    "setting 2, fortifyReach %s: the second move wins, no turn end, no card",
    (reach) => {
      const first = ok(base(reach, 2), move("tannenfeld", "rabenhain", 2)); // B 4, C 1
      expect(first.state.winnerId).toBeNull();
      expect(first.state.activePlayerId).toBe("a");
      const win = ok(first.state, move("rabenhain", "eisenfurt", 3)); // A 8
      expect(win.state.winnerId).toBe("a");
      expect(win.state.activePlayerId).toBe("a");
      expect(win.state.turn).toBe(1);
      expect(win.state.secret.hand["a"]).toEqual([]);
      expect(types(win)).toEqual(["armiesFortified", "gameWon"]);
      expect(code(win.state, move("eisenfurt", "rabenhain", 1))).toBe("GAME_OVER");
    },
  );

  it.each(["connected", "adjacent"] as const)(
    "setting 1, fortifyReach %s: the single move wins as before",
    (reach) => {
      const win = ok(base(reach, 1), move("rabenhain", "eisenfurt", 1));
      expect(win.state.winnerId).toBe("a");
      expect(win.state.activePlayerId).toBe("a");
      expect(win.state.secret.hand["a"]).toEqual([]);
      expect(code(win.state, move("eisenfurt", "rabenhain", 1))).toBe("GAME_OVER");
    },
  );
});

describe("host actions and the fortify moves of the turn (rules.md 1.6, 1.7)", () => {
  const three = (moves: 1 | 2, overrides: Partial<GameState> = {}): GameState =>
    makeState({
      phase: "fortify",
      fortifyMoves: moves,
      players: ["a", "b", "c"],
      territories: {
        eisenfurt: ["a", 5],
        rabenhain: ["a", 2],
        grauwacht: ["b", 2],
        kupferstadt: ["c", 2],
        nebelkueste: ["c", 2],
      },
      overrides,
    });
  const host = (s: GameState, a: HostAction) => {
    const r = applyHostAction(s, a, rng);
    if (!r.ok) throw new Error(`unexpected ${r.code}`);
    return r;
  };

  it.each([0, 1])(
    "skipTurn after %s moves (setting 2) ends the turn: counter 0, card only for a conquest",
    (done) => {
      let s = three(2, { conqueredThisTurn: true });
      if (done === 1) s = ok(s, move("eisenfurt", "rabenhain", 1)).state;
      expect(s.fortifyMovesDone).toBe(done);
      const r = host(s, { type: "skipTurn", turn: s.turn });
      expect(r.state.activePlayerId).toBe("b");
      expect(r.state.phase).toBe("reinforce");
      expect(r.state.fortifyMovesDone).toBe(0);
      expect(r.state.secret.hand["a"]).toHaveLength(1);
      const plain = three(2);
      const none = host(plain, { type: "skipTurn", turn: plain.turn });
      expect(none.state.secret.hand["a"]).toEqual([]);
    },
  );

  it("a skipTurn with the current turn number hits the right turn after the first move; the old number is stale", () => {
    const s = ok(three(2), move("eisenfurt", "rabenhain", 1)).state;
    expect(applyHostAction(s, { type: "skipTurn", turn: s.turn - 1 }, rng)).toEqual({
      ok: false,
      code: "STALE_TURN",
    });
    expect(host(s, { type: "skipTurn", turn: s.turn }).state.activePlayerId).toBe("b");
  });

  it("removePlayer of the active player after 1 move: territories neutral, no card, counter 0, turn goes on", () => {
    const s = ok(three(2, { conqueredThisTurn: true }), move("eisenfurt", "rabenhain", 1)).state;
    const r = host(s, { type: "removePlayer", playerId: "a" });
    expect(r.state.activePlayerId).toBe("b");
    expect(r.state.phase).toBe("reinforce");
    expect(r.state.fortifyMovesDone).toBe(0);
    expect(r.state.secret.hand["a"] ?? []).toEqual([]);
    expect(r.state.secret.deck).toEqual(s.secret.deck);
    expect(r.state.territories["eisenfurt"]!.ownerId).toBeNull();
    expect(types(r)).not.toContain("cardDrawn");
  });

  it("removePlayer of another player leaves the counter and the second move of the active player alone", () => {
    const s = ok(three(2), move("eisenfurt", "rabenhain", 1)).state;
    const r = host(s, { type: "removePlayer", playerId: "c" });
    expect(r.state.activePlayerId).toBe("a");
    expect(r.state.phase).toBe("fortify");
    expect(r.state.fortifyMovesDone).toBe(1);
    expect(ok(r.state, move("rabenhain", "eisenfurt", 1)).state.activePlayerId).toBe("b");
  });
});

describe.each([1, 2] as const)("first move with fortifyMoves %i: reach and count", (moves) => {
  it("connected reaches C over B, adjacent does not", () => {
    expect(code(setup("connected", moves), move("eisenfurt", "tannenfeld", 3))).toBeUndefined();
    expect(code(setup("adjacent", moves), move("eisenfurt", "tannenfeld", 3))).toBe(
      "NOT_CONNECTED",
    );
  });

  it.each(["connected", "adjacent"] as const)(
    "%s: count 0, negative and fractional are INVALID_COUNT",
    (reach) => {
      const s = setup(reach, moves);
      for (const count of [0, -1, 1.5, Number.NaN, 5]) {
        expect(code(s, move("eisenfurt", "rabenhain", count)), String(count)).toBe("INVALID_COUNT");
      }
    },
  );

  it("a territory with 1 army is not an origin, and with all armies at 1 the connected view still lists the group but no move is valid", () => {
    const s = makeState({
      phase: "fortify",
      fortifyMoves: moves,
      territories: { eisenfurt: ["a", 1], rabenhain: ["a", 1] },
    });
    const view = viewFor(s, "a");
    expect(view.fortify).toMatchObject({ reach: "connected", movesDone: 0, movesMax: moves });
    expect(view.territories["eisenfurt"]!.maxMove).toBe(0);
    expect(view.territories["rabenhain"]!.maxMove).toBe(0);
    expect(code(s, move("eisenfurt", "rabenhain", 1))).toBe("INVALID_COUNT");
    const adjacent = viewFor(
      { ...s, rules: { ...s.rules, fortifyReach: "adjacent" } },
      "a",
    ).fortify;
    expect(adjacent).toMatchObject({ reach: "adjacent", targets: {} });
  });
});

describe("after the first move (setting 2) the view lists an origin with maxMove >= 1 and a target (question 36)", () => {
  it.each(["connected", "adjacent"] as const)("%s", (reach) => {
    const first = ok(setup(reach, 2), move("eisenfurt", "rabenhain", 1)).state;
    const view = viewFor(first, "a");
    const f = view.fortify!;
    const origins =
      f.reach === "connected"
        ? f.groups.flat().filter((id) => view.territories[id]!.maxMove >= 1)
        : Object.keys(f.targets).filter((id) => view.territories[id]!.maxMove >= 1);
    expect(origins.length).toBeGreaterThan(0);
    if (f.reach === "adjacent") expect(f.targets["rabenhain"]).toContain("eisenfurt");
  });
});
