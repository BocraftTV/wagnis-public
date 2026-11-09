import { describe, expect, it } from "vitest";
import { applyAction, createDiceRng, createSeededRng, viewFor } from "./index.js";
import type { Action, GameEvent, GameState, Rng } from "./index.js";
import { makeState, withCards } from "./testkit.js";

/** Rng that must not be used: a draw from a non-empty deck needs no randomness. */
const noRng: Rng = {
  int: () => {
    throw new Error("rng used");
  },
};

const DECK = ["card-salzmoor", "card-dornental", "card-kupferstadt"];

function fortifyState(conquered: boolean, overrides: Partial<GameState> = {}): GameState {
  return withCards(
    makeState({
      phase: "fortify",
      territories: { eisenfurt: ["a", 4], rabenhain: ["a", 2] },
      overrides: { conqueredThisTurn: conquered, ...overrides },
    }),
    { deck: [...DECK], discard: [] },
  );
}

const skip: Action = { type: "endPhase" };
const move: Action = { type: "fortify", from: "eisenfurt", to: "rabenhain", count: 1 };

function ok(s: GameState, a: Action, rng: Rng): { state: GameState; events: GameEvent[] } {
  const r = applyAction(s, s.activePlayerId, a, rng);
  if (!r.ok) throw new Error(r.code);
  return r;
}

describe.each([
  ["endPhase", skip],
  ["fortify", move],
] as const)("card draw at the end of a turn (%s)", (_name, action) => {
  it("draws no card without a conquest and uses no rng", () => {
    const r = ok(fortifyState(false), action, noRng);
    expect(r.state.secret.hand["a"]).toEqual([]);
    expect(r.state.secret.deck).toEqual(DECK);
    expect(r.events.map((e) => e.type)).not.toContain("cardDrawn");
  });

  it("draws exactly the top card after a conquest, and the event does not show it", () => {
    const r = ok(fortifyState(true), action, noRng);
    expect(r.state.secret.hand["a"]).toEqual(["card-salzmoor"]);
    expect(r.state.secret.deck).toEqual(["card-dornental", "card-kupferstadt"]);
    const drawn = r.events.filter((e) => e.type === "cardDrawn");
    expect(drawn).toEqual([{ type: "cardDrawn", playerId: "a" }]);
    expect(JSON.stringify(r.events)).not.toContain("card-");
  });

  it("orders the events end of turn -> draw -> turn change, and the card is already counted for the next player", () => {
    const r = ok(fortifyState(true), action, noRng);
    const types = r.events.map((e) => e.type);
    const draw = types.indexOf("cardDrawn");
    expect(draw).toBeGreaterThan(-1);
    expect(draw).toBeLessThan(types.indexOf("phaseChanged"));
    expect(draw).toBeLessThan(types.indexOf("turnStarted"));
    expect(r.state.activePlayerId).toBe("b");
    expect(viewFor(r.state, "b").handCounts).toEqual({ a: 1, b: 0 });
    expect(r.state.conqueredThisTurn).toBe(false);
  });
});

describe("card draw with three conquests in one turn", () => {
  it("gives genuinely one card", () => {
    // a attacks with 3 dice against single armies and wins every roll (6-6-6 against 1).
    const start = withCards(
      makeState({
        territories: { eisenfurt: ["a", 20] },
        fill: "b",
        overrides: { phase: "attack" },
      }),
      { deck: [...DECK] },
    );
    const rng = createDiceRng([6, 6, 6, 1, 6, 6, 6, 1, 6, 6, 1, 1]);
    const play = (s: GameState, a: Action): GameState => {
      const r = applyAction(s, "a", a, rng);
      if (!r.ok) throw new Error(`${r.code} for ${JSON.stringify(a)}`);
      return r.state;
    };
    let s = play(start, { type: "attack", from: "eisenfurt", to: "rabenhain", dice: 3 });
    s = play(s, { type: "occupy", count: 3 });
    s = play(s, { type: "attack", from: "eisenfurt", to: "grauwacht", dice: 3 });
    s = play(s, { type: "occupy", count: 3 });
    s = play(s, { type: "attack", from: "rabenhain", to: "tannenfeld", dice: 2 });
    expect(s.conqueredThisTurn).toBe(true);
    expect(Object.values(s.territories).filter((t) => t.ownerId === "a")).toHaveLength(4);
    if (s.pendingOccupation) s = play(s, { type: "occupy", count: s.pendingOccupation.min });
    s = play(s, skip);
    expect(s.secret.hand["a"]).toEqual([]);
    s = play(s, skip);
    expect(s.activePlayerId).toBe("b");
    expect(s.secret.hand["a"]).toEqual(["card-salzmoor"]);
    expect(viewFor(s, "b").handCounts["a"]).toBe(1);
  });
});

describe("empty deck", () => {
  const PILE = [
    "card-eisenfurt",
    "card-rabenhain",
    "card-grauwacht",
    "card-tannenfeld",
    "card-joker-1",
  ];

  it("shuffles the discard pile over the rng, uses it as the deck and empties the discard pile", () => {
    const s = withCards(fortifyState(true), { deck: [], discard: [...PILE] });
    const r = ok(s, skip, createSeededRng(7));
    const types = r.events.map((e) => e.type);
    expect(types.indexOf("deckReshuffled")).toBeLessThan(types.indexOf("cardDrawn"));
    expect(r.state.secret.discard).toEqual([]);
    const drawn = r.state.secret.hand["a"]!;
    expect(drawn).toHaveLength(1);
    // Fixed seed, fixed expectation: every card still exists exactly once.
    expect([...drawn, ...r.state.secret.deck].sort()).toEqual([...PILE].sort());
    expect(r.state.secret.deck).toHaveLength(4);
    expect(drawn).toEqual(["card-tannenfeld"]);
    expect(r.state.secret.deck).toEqual([
      "card-rabenhain",
      "card-grauwacht",
      "card-joker-1",
      "card-eisenfurt",
    ]);
  });

  it("is deterministic for the same seed", () => {
    const s = withCards(fortifyState(true), { deck: [], discard: [...PILE] });
    expect(ok(s, skip, createSeededRng(9)).state).toEqual(ok(s, skip, createSeededRng(9)).state);
  });

  it("draws nothing with deck and discard pile both empty, and the turn ends anyway", () => {
    const s = withCards(fortifyState(true), { deck: [], discard: [] });
    const r = ok(s, skip, noRng);
    expect(r.state.secret.hand["a"]).toEqual([]);
    expect(r.state.activePlayerId).toBe("b");
    expect(r.events.map((e) => e.type)).toEqual(["phaseChanged", "turnStarted"]);
  });

  it("keeps the hand of a player who already holds cards", () => {
    const s = withCards(fortifyState(true), { hand: { a: ["card-joker-2"] } });
    expect(ok(s, skip, noRng).state.secret.hand["a"]).toEqual(["card-joker-2", "card-salzmoor"]);
  });
});
