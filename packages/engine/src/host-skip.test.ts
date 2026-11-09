import { describe, expect, it } from "vitest";
import {
  applyAction,
  applyHostAction,
  calculateReinforcements,
  createDiceRng,
  createSeededRng,
  testland,
  testlandRules,
  viewFor,
} from "./index.js";
import type { Action, GameState, HostAction, Rng } from "./index.js";
import { makeState, scenarioS3, totalArmies, withCards, withMissions } from "./testkit.js";

// Plan 007, section 6: `skipTurn` (rules.md 1.6, 1.7). testland: eisenfurt-rabenhain, eisenfurt-grauwacht,
// rabenhain-tannenfeld, grauwacht-tannenfeld, grauwacht-salzmoor, salzmoor-dornental, salzmoor-kupferstadt,
// dornental-nebelkueste, kupferstadt-nebelkueste.

const noRng: Rng = {
  int: () => {
    throw new Error("rng used");
  },
};
const skip = (turn: number): HostAction => ({ type: "skipTurn", turn });
function okHost(s: GameState, action: HostAction, rng: Rng = noRng) {
  const r = applyHostAction(s, action, rng);
  if (!r.ok) throw new Error(`unexpected ${r.code}`);
  return r;
}
const act = (s: GameState, action: Action, faces: number[], player = s.activePlayerId) => {
  const r = applyAction(s, player, action, createDiceRng(faces));
  if (!r.ok) throw new Error(`unexpected ${r.code}`);
  return r;
};
const types = (r: { events: { type: string }[] }) => r.events.map((e) => e.type);

describe("skipTurn in scenario S3 (a active, reinforce, 3 reinforcements, 5 cards, turn 7)", () => {
  it("passes the turn to b: reinforcements lapse, a keeps armies and hand, no card without a conquest", () => {
    const s = scenarioS3();
    const r = okHost(s, skip(7));
    expect(r.state.activePlayerId).toBe("b");
    expect(r.state.turn).toBe(8);
    expect(r.state.phase).toBe("reinforce");
    // b: 3 territories -> max(3, floor(3 / 3)) = 3; no continent
    expect(r.state.reinforcementsLeft).toBe(
      calculateReinforcements(testland, testlandRules, r.state.territories, "b"),
    );
    expect(r.state.reinforcementsLeft).toBe(3);
    // nothing was placed for a: every army on the board is as before
    expect(r.state.territories).toEqual(s.territories);
    expect(totalArmies(r.state)).toBe(totalArmies(s));
    expect(r.state.secret.hand["a"]).toEqual(s.secret.hand["a"]);
    expect(r.state.secret.hand["a"]).toHaveLength(5);
    expect(r.state.secret.deck).toEqual(s.secret.deck);
    expect(r.state.secret.deck).toHaveLength(2);
    expect(types(r)).toEqual(["turnSkipped", "phaseChanged", "turnStarted"]);
    expect(r.events[0]).toEqual({ type: "turnSkipped", playerId: "a", turn: 7 });
    expect(r.events[2]).toEqual({ type: "turnStarted", playerId: "b", turn: 8, reinforcements: 3 });
    expect(r.state.pendingOccupation).toBeNull();
    expect(r.state.winnerId).toBeNull();
  });

  it("the mandatory trade of a is not looked at, but is back in a's next turn", () => {
    const s = scenarioS3();
    const toB = okHost(s, skip(7)).state;
    expect(applyAction(toB, "a", { type: "endPhase" }, noRng)).toEqual({
      ok: false,
      code: "NOT_YOUR_TURN",
    });
    const toC = okHost(toB, skip(8)).state;
    const toA = okHost(toC, skip(9)).state;
    expect(toA.activePlayerId).toBe("a");
    expect(toA.turn).toBe(10);
    expect(
      applyAction(toA, "a", { type: "placeArmies", territoryId: "eisenfurt", count: 1 }, noRng),
    ).toEqual({ ok: false, code: "MUST_TRADE" });
    expect(applyAction(toA, "a", { type: "endPhase" }, noRng)).toEqual({
      ok: false,
      code: "MUST_TRADE",
    });
    expect(viewFor(toA, "a").secret.mustTrade).toBe(true);
  });

  it("a stale turn is STALE_TURN and changes nothing; the same turn twice is stale the second time", () => {
    const s = scenarioS3();
    const before = JSON.stringify(s);
    expect(applyHostAction(s, skip(6), noRng)).toEqual({ ok: false, code: "STALE_TURN" });
    expect(applyHostAction(s, skip(8), noRng)).toEqual({ ok: false, code: "STALE_TURN" });
    expect(JSON.stringify(s)).toBe(before);
    const first = okHost(s, skip(7));
    expect(first.state.turn).toBe(8);
    expect(applyHostAction(first.state, skip(7), noRng)).toEqual({
      ok: false,
      code: "STALE_TURN",
    });
  });

  it("GAME_OVER comes before STALE_TURN", () => {
    const s = { ...scenarioS3(), winnerId: "a", winReason: "mission" as const };
    expect(applyHostAction(s, skip(7), noRng)).toEqual({ ok: false, code: "GAME_OVER" });
    expect(applyHostAction(s, skip(1), noRng)).toEqual({ ok: false, code: "GAME_OVER" });
  });

  it("never changes the input state, on success either", () => {
    const s = scenarioS3();
    const before = JSON.stringify(s);
    okHost(s, skip(7));
    expect(JSON.stringify(s)).toBe(before);
  });

  it.each(["reinforce", "attack", "fortify"] as const)("works in the %s phase, too", (phase) => {
    const s = scenarioS3({
      phase,
      overrides: { reinforcementsLeft: phase === "reinforce" ? 3 : 0 },
    });
    const r = okHost(s, skip(7));
    expect(r.state.activePlayerId).toBe("b");
    expect(r.state.phase).toBe("reinforce");
    expect(r.state.turn).toBe(8);
  });
});

describe("skipTurn after a conquest in the turn", () => {
  // a attacks tannenfeld from rabenhain (4 armies, 3 dice) with 6-5-4 against b's 3-2: b loses both armies,
  // minimum = maximum = 3, the engine moves in; rabenhain keeps 1. b still holds salzmoor and dornental.
  const conquered = (): GameState => {
    const s = scenarioS3({ phase: "attack", hands: { a: 2, b: 2, c: 0 }, discard: 1 });
    const r = act(
      s,
      { type: "attack", from: "rabenhain", to: "tannenfeld", dice: 3 },
      [6, 5, 4, 3, 2],
    );
    expect(r.state.territories["tannenfeld"]).toEqual({ ownerId: "a", armies: 3 });
    expect(r.state.pendingOccupation).toBeNull();
    expect(r.state.conqueredThisTurn).toBe(true);
    return { ...r.state, reinforcementsLeft: 0 };
  };

  it("a draws exactly one card (the top of the deck) and b's first view counts it", () => {
    const s = conquered();
    expect(s.secret.deck).toHaveLength(5);
    const top = s.secret.deck[0]!;
    const r = okHost(s, skip(7));
    expect(r.state.secret.hand["a"]).toHaveLength(3);
    expect(r.state.secret.hand["a"]!.at(-1)).toBe(top);
    expect(r.state.secret.deck).toHaveLength(4);
    expect(types(r)).toEqual(["turnSkipped", "cardDrawn", "phaseChanged", "turnStarted"]);
    const viewB = viewFor(r.state, "b");
    expect(viewB.activePlayerId).toBe("b");
    expect(viewB.handCounts).toEqual({ a: 3, b: 2, c: 0 });
    expect(viewB.deckCount).toBe(4);
    expect(viewB.conqueredThisTurn).toBe(false);
  });

  it("with an empty deck the discard pile is reshuffled through the injected Rng", () => {
    const s0 = conquered();
    const s = withCards(s0, { deck: [], discard: s0.secret.deck });
    const r = okHost(s, skip(7), createSeededRng(3));
    expect(types(r)).toContain("deckReshuffled");
    expect(r.state.secret.hand["a"]).toHaveLength(3);
    expect(r.state.secret.deck).toHaveLength(4);
    expect(r.state.secret.discard).toEqual([]);
  });
});

describe("skipTurn with an open move-in (plan 004, section 6: win at the move-in)", () => {
  // a holds eisenfurt, rabenhain, tannenfeld with 2 armies, grauwacht 5; b holds salzmoor, dornental, kupferstadt,
  // nebelkueste with 1. Attack grauwacht -> salzmoor with 3 dice (6-5-4 against 2): the minimum is 3, the maximum 4.
  const open = (hold: { count: number; minArmies: number } | null): GameState => {
    const base = withMissions(
      makeState({
        players: ["a", "b"],
        territories: {
          eisenfurt: ["a", 2],
          rabenhain: ["a", 2],
          tannenfeld: ["a", 2],
          grauwacht: ["a", 5],
        },
        fill: "b",
      }),
      { a: hold ? { type: "holdTerritories", ...hold } : null },
    );
    const r = act(
      base,
      { type: "attack", from: "grauwacht", to: "salzmoor", dice: 3 },
      [6, 5, 4, 2],
    );
    expect(r.state.pendingOccupation).toEqual({ from: "grauwacht", to: "salzmoor", min: 3 });
    expect(r.state.winnerId).toBeNull();
    return r.state;
  };

  it("counts as occupy with the minimum: 5 territories with 2 armies win by mission, no turn end, no card", () => {
    const s = open({ count: 5, minArmies: 2 });
    const r = okHost(s, skip(1));
    expect(r.state.territories["grauwacht"]).toEqual({ ownerId: "a", armies: 2 });
    expect(r.state.territories["salzmoor"]).toEqual({ ownerId: "a", armies: 3 });
    expect(r.state.pendingOccupation).toBeNull();
    expect(r.state.winnerId).toBe("a");
    expect(r.state.winReason).toBe("mission");
    expect(r.state.turn).toBe(1);
    expect(r.state.activePlayerId).toBe("a");
    expect(r.state.secret.hand["a"]).toEqual([]);
    expect(types(r)).toEqual(["turnSkipped", "gameWon"]);
    // afterwards every action and every host action is GAME_OVER
    expect(applyAction(r.state, "a", { type: "endPhase" }, noRng)).toEqual({
      ok: false,
      code: "GAME_OVER",
    });
    expect(applyHostAction(r.state, skip(1), noRng)).toEqual({ ok: false, code: "GAME_OVER" });
  });

  it("another, unmet mission: the minimum stays, the turn changes, a draws the card for the conquest", () => {
    const s = open({ count: 6, minArmies: 2 });
    const r = okHost(s, skip(1));
    expect(r.state.territories["grauwacht"]).toEqual({ ownerId: "a", armies: 2 });
    expect(r.state.territories["salzmoor"]).toEqual({ ownerId: "a", armies: 3 });
    expect(r.state.pendingOccupation).toBeNull();
    expect(r.state.winnerId).toBeNull();
    expect(r.state.activePlayerId).toBe("b");
    expect(r.state.turn).toBe(2);
    expect(r.state.secret.hand["a"]).toHaveLength(1);
    expect(types(r)).toEqual(["turnSkipped", "cardDrawn", "phaseChanged", "turnStarted"]);
  });
});

describe("skipTurn and the turn order", () => {
  it("passes over players who are out", () => {
    // c holds nothing: a -> b -> a
    const s = makeState({
      players: ["a", "b", "c"],
      territories: { eisenfurt: ["a", 3], tannenfeld: ["b", 3] },
      fill: "b",
      overrides: { reinforcementsLeft: 3, turn: 4 },
    });
    const toB = okHost(s, skip(4)).state;
    expect(toB.activePlayerId).toBe("b");
    const toA = okHost(toB, skip(5)).state;
    expect(toA.activePlayerId).toBe("a");
    expect(toA.turn).toBe(6);
  });

  it("the start-of-turn check of the successor still runs: a satisfied mission wins at the turn start", () => {
    const s = withMissions(scenarioS3({ hands: { a: 0, b: 0, c: 0 } }), {
      b: { type: "holdTerritories", count: 3, minArmies: 1 },
    });
    const r = okHost(s, skip(7));
    expect(r.state.winnerId).toBe("b");
    expect(r.state.winReason).toBe("mission");
    expect(r.state.activePlayerId).toBe("b");
    expect(types(r)).toEqual(["turnSkipped", "phaseChanged", "turnStarted", "gameWon"]);
  });

  it("the host may skip any player's turn, also a player with an eliminate mission and a pending hand", () => {
    const s = scenarioS3({ hands: { a: 5, b: 4, c: 0 }, discard: 1 });
    const r = okHost(okHost(s, skip(7)).state, skip(8));
    expect(r.state.activePlayerId).toBe("c");
    expect(r.state.secret.hand["b"]).toHaveLength(4);
  });
});
