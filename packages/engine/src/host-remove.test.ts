import { describe, expect, it } from "vitest";
import {
  applyAction,
  applyHostAction,
  calculateReinforcements,
  createDiceRng,
  createGame,
  createSeededRng,
  isEliminated,
  testland,
  testlandRules,
  viewFor,
} from "./index.js";
import type { Action, GameState, HostAction, Rng } from "./index.js";
import { makeState, scenarioS3, withMissions } from "./testkit.js";

// Plan 007, section 6: `removePlayer` (rules.md 1.6, 1.7). testland: eisenfurt-rabenhain, eisenfurt-grauwacht,
// rabenhain-tannenfeld, grauwacht-tannenfeld, grauwacht-salzmoor, salzmoor-dornental, salzmoor-kupferstadt,
// dornental-nebelkueste, kupferstadt-nebelkueste.

const noRng: Rng = {
  int: () => {
    throw new Error("rng used");
  },
};
const remove = (playerId: string): HostAction => ({ type: "removePlayer", playerId });
function okHost(s: GameState, action: HostAction, rng: Rng = noRng) {
  const r = applyHostAction(s, action, rng);
  if (!r.ok) throw new Error(`unexpected ${r.code}`);
  return r;
}
const act = (s: GameState, action: Action, faces: number[] = [], player = s.activePlayerId) => {
  const r = applyAction(s, player, action, faces.length ? createDiceRng(faces) : noRng);
  if (!r.ok) throw new Error(`unexpected ${r.code}`);
  return r;
};
const types = (r: { events: { type: string }[] }) => r.events.map((e) => e.type);
const cardTotal = (s: GameState): number =>
  Object.values(s.secret.hand).reduce((n, h) => n + h.length, 0) +
  s.secret.deck.length +
  s.secret.discard.length;

describe("removePlayer b (scenario S3, a active, hands a 2 / b 4 / c 0, discard 1, deck 3)", () => {
  const s3 = () => scenarioS3({ hands: { a: 2, b: 4, c: 0 }, discard: 1 });

  it("b's territories turn neutral with the same armies; the cards are conserved", () => {
    const s = s3();
    const r = okHost(s, remove("b"));
    expect(r.state.territories["tannenfeld"]).toEqual({ ownerId: null, armies: 2 });
    expect(r.state.territories["salzmoor"]).toEqual({ ownerId: null, armies: 1 });
    expect(r.state.territories["dornental"]).toEqual({ ownerId: null, armies: 3 });
    // everyone else's territories are untouched
    for (const id of ["eisenfurt", "rabenhain", "grauwacht", "kupferstadt", "nebelkueste"]) {
      expect(r.state.territories[id]).toEqual(s.territories[id]);
    }
    expect(types(r)).toEqual(["playerRemoved"]);
    expect(r.events[0]).toEqual({
      type: "playerRemoved",
      playerId: "b",
      territoryCount: 3,
      discardedCount: 4,
    });
    expect(r.state.removedPlayerIds).toEqual(["b"]);
    expect(r.state.playerOrder).toEqual(["a", "b", "c"]);
    // hand to the discard pile (appended in hand order), deck untouched, hand count 0
    expect(r.state.secret.hand["b"]).toEqual([]);
    expect(r.state.secret.discard).toEqual([...s.secret.discard, ...s.secret.hand["b"]!]);
    expect(r.state.secret.discard).toHaveLength(5);
    expect(r.state.secret.deck).toEqual(s.secret.deck);
    expect(r.state.secret.deck).toHaveLength(3);
    expect(viewFor(r.state, "a").handCounts).toEqual({ a: 2, b: 0, c: 0 });
    expect(cardTotal(r.state)).toBe(cardTotal(s));
    expect(cardTotal(r.state)).toBe(10);
    // b's mission is gone and b is out of the game
    expect(r.state.secret.mission["b"]).toBeNull();
    expect(r.state.secret.originalMission["b"]).toBeNull();
    expect(r.state.secret.missionReplaced["b"]).toBe(false);
    expect(isEliminated(r.state, "b")).toBe(true);
    // a's turn goes on unchanged
    expect(r.state.activePlayerId).toBe("a");
    expect(r.state.turn).toBe(7);
    expect(r.state.phase).toBe("reinforce");
    expect(r.state.reinforcementsLeft).toBe(3);
    expect(r.state.winnerId).toBeNull();
  });

  it("a's eliminate mission aimed at b becomes the fallback; the original stays; no event, no other change", () => {
    const s = s3();
    expect(s.secret.mission["a"]).toEqual({ type: "eliminatePlayer", targetPlayerId: "b" });
    const r = okHost(s, remove("b"));
    expect(r.state.secret.mission["a"]).toEqual({
      type: "holdTerritories",
      count: 6,
      minArmies: 2,
    });
    expect(r.state.secret.missionReplaced["a"]).toBe(true);
    expect(r.state.secret.originalMission["a"]).toEqual({
      type: "eliminatePlayer",
      targetPlayerId: "b",
    });
    // c's mission is not touched, nothing in the events talks about missions
    expect(r.state.secret.mission["c"]).toEqual(s.secret.mission["c"]);
    expect(r.state.secret.missionReplaced["c"]).toBe(false);
    expect(JSON.stringify(r.events)).not.toMatch(/mission/i);
  });

  it("the replacement is not checked in this action, even if it is already met; a wins at the next own action", () => {
    // a holds 6 territories with 2 armies each: the fallback { 6, 2 } is met the moment it is assigned
    const s = withMissions(
      makeState({
        players: ["a", "b", "c"],
        territories: {
          eisenfurt: ["a", 2],
          rabenhain: ["a", 2],
          grauwacht: ["a", 2],
          tannenfeld: ["a", 2],
          salzmoor: ["a", 2],
          dornental: ["a", 2],
          kupferstadt: ["b", 1],
          nebelkueste: ["c", 1],
        },
        phase: "reinforce",
        overrides: { reinforcementsLeft: 3, turn: 5 },
      }),
      { a: { type: "eliminatePlayer", targetPlayerId: "b" } },
    );
    const r = okHost(s, remove("b"));
    expect(r.state.secret.missionReplaced["a"]).toBe(true);
    expect(r.state.winnerId).toBeNull();
    expect(r.state.winReason).toBeNull();
    expect(types(r)).toEqual(["playerRemoved"]);
    // the next action of a checks it
    const after = act(r.state, { type: "placeArmies", territoryId: "eisenfurt", count: 1 });
    expect(after.state.winnerId).toBe("a");
    expect(after.state.winReason).toBe("mission");
  });

  it("the replacement that is already met also wins at the start of a's next turn", () => {
    const s = withMissions(
      makeState({
        players: ["a", "b", "c"],
        territories: {
          eisenfurt: ["a", 2],
          rabenhain: ["a", 2],
          grauwacht: ["a", 2],
          tannenfeld: ["a", 2],
          salzmoor: ["a", 2],
          dornental: ["a", 2],
          kupferstadt: ["b", 1],
          nebelkueste: ["c", 1],
        },
        active: "c",
        phase: "fortify",
        overrides: { turn: 5 },
      }),
      { a: { type: "eliminatePlayer", targetPlayerId: "b" } },
    );
    const removed = okHost(s, remove("b")).state;
    expect(removed.winnerId).toBeNull();
    // c ends the turn; b is out, so the turn goes to a, whose start-of-turn check wins
    const next = act(removed, { type: "endPhase" });
    expect(next.state.activePlayerId).toBe("a");
    expect(next.state.winnerId).toBe("a");
    expect(next.state.winReason).toBe("mission");
  });

  it("an open move-in of the active player stays open when someone else is removed", () => {
    const base = scenarioS3({ phase: "attack", hands: { a: 2, b: 4, c: 0 } });
    // a attacks salzmoor (1 army) from grauwacht (5 armies) with 3 dice: conquest, move-in min 3
    const attacked = act(
      base,
      { type: "attack", from: "grauwacht", to: "salzmoor", dice: 3 },
      [6, 5, 4, 2],
    );
    expect(attacked.state.pendingOccupation).not.toBeNull();
    const r = okHost({ ...attacked.state, reinforcementsLeft: 0 }, remove("c"));
    expect(r.state.pendingOccupation).toEqual(attacked.state.pendingOccupation);
    expect(r.state.activePlayerId).toBe("a");
    expect(r.state.conqueredThisTurn).toBe(true);
    expect(applyAction(r.state, "a", { type: "endPhase" }, noRng)).toEqual({
      ok: false,
      code: "OCCUPY_PENDING",
    });
  });

  it("never changes the input state, on success either", () => {
    const s = s3();
    const before = JSON.stringify(s);
    okHost(s, remove("b"));
    okHost(s, remove("c"));
    expect(JSON.stringify(s)).toBe(before);
  });

  it("removing a player who is not active checks only condition a): with two left there is no decision", () => {
    const r = okHost(s3(), remove("b"));
    expect(r.state.winnerId).toBeNull();
    const r2 = okHost(r.state, remove("c"));
    expect(r2.state.winnerId).toBe("a");
    expect(r2.state.winReason).toBe("lastPlayer");
    expect(types(r2)).toEqual(["playerRemoved", "gameWon"]);
  });
});

describe("removePlayer of the active player (scenario S3, b active)", () => {
  const withConquest = (extra: Partial<GameState> = {}, hands = { a: 2, b: 4, c: 0 }): GameState =>
    scenarioS3({
      phase: "attack",
      hands,
      discard: 1,
      overrides: { activePlayerId: "b", conqueredThisTurn: true, ...extra },
    });

  it("no card for the conquest, the turn goes to c with a computed reinforcement, the start check runs", () => {
    const s = withConquest();
    const r = okHost(s, remove("b"));
    expect(r.state.activePlayerId).toBe("c");
    expect(r.state.turn).toBe(8);
    expect(r.state.phase).toBe("reinforce");
    expect(r.state.conqueredThisTurn).toBe(false);
    expect(r.state.pendingOccupation).toBeNull();
    expect(r.state.reinforcementsLeft).toBe(
      calculateReinforcements(testland, testlandRules, r.state.territories, "c"),
    );
    // b drew nothing; the deck is as before, b's cards are on the discard pile
    expect(r.state.secret.deck).toEqual(s.secret.deck);
    expect(r.state.secret.hand["b"]).toEqual([]);
    expect(r.state.secret.discard).toHaveLength(5);
    expect(types(r)).toEqual(["playerRemoved", "phaseChanged", "turnStarted"]);
    expect(r.events.at(-1)).toEqual({
      type: "turnStarted",
      playerId: "c",
      turn: 8,
      reinforcements: r.state.reinforcementsLeft,
    });
  });

  it("an open move-in of the removed player is gone with his territories; the conquest stays neutral", () => {
    const s = withConquest({
      pendingOccupation: { from: "dornental", to: "salzmoor", min: 2 },
    });
    const r = okHost(s, remove("b"));
    expect(r.state.pendingOccupation).toBeNull();
    expect(r.state.territories["salzmoor"]!.ownerId).toBeNull();
    expect(r.state.territories["dornental"]!.ownerId).toBeNull();
    expect(r.state.activePlayerId).toBe("c");
    // the next player is not stuck in an occupation
    expect(
      applyAction(
        r.state,
        "c",
        { type: "placeArmies", territoryId: "kupferstadt", count: 1 },
        noRng,
      ).ok,
    ).toBe(true);
  });

  it("an open mandatory trade is moot: nothing stays locked", () => {
    const s = withConquest({ phase: "reinforce", conqueredThisTurn: false }, { a: 0, b: 5, c: 0 });
    const r = okHost(s, remove("b"));
    expect(r.state.secret.hand["b"]).toEqual([]);
    expect(r.state.activePlayerId).toBe("c");
    const c = act(r.state, {
      type: "placeArmies",
      territoryId: "kupferstadt",
      count: r.state.reinforcementsLeft,
    });
    expect(c.state.reinforcementsLeft).toBe(0);
    expect(viewFor(r.state, "c").secret.mustTrade).toBe(false);
  });

  it("the start-of-turn check of the successor includes his mission", () => {
    const s = withMissions(withConquest(), {
      c: { type: "holdTerritories", count: 2, minArmies: 2 },
    });
    const r = okHost(s, remove("b"));
    expect(r.state.winnerId).toBe("c");
    expect(r.state.winReason).toBe("mission");
    expect(types(r)).toEqual(["playerRemoved", "phaseChanged", "turnStarted", "gameWon"]);
  });

  it("passes over players who are out: the next one is not eliminated and not removed", () => {
    // a holds one territory, c none (out), b active and removed: the turn goes to a, never to c
    const s = makeState({
      players: ["a", "b", "c"],
      territories: { eisenfurt: ["a", 3], tannenfeld: ["b", 3] },
      fill: null,
      active: "b",
      overrides: { turn: 9 },
    });
    // a holds eisenfurt and b tannenfeld; everything else is neutral
    const r = okHost(s, remove("b"));
    expect(r.state.winnerId).toBe("a"); // only a is left: condition a)
    const s2 = makeState({
      players: ["a", "b", "c", "d"],
      territories: { eisenfurt: ["a", 3], tannenfeld: ["b", 3], kupferstadt: ["d", 2] },
      fill: null,
      active: "b",
      overrides: { turn: 9 },
    });
    const r2 = okHost(s2, remove("b"));
    expect(r2.state.activePlayerId).toBe("d"); // c holds nothing: skipped
    expect(r2.state.winnerId).toBeNull();
  });
});

describe("removePlayer and the last player", () => {
  const twoPlayers = (): GameState => {
    const r = createGame({
      map: testland,
      rules: testlandRules,
      playerIds: ["a", "b"],
      rng: createSeededRng(1),
    });
    if (!r.ok) throw new Error(r.code);
    expect(Object.values(r.state.territories).some((t) => t.ownerId === null)).toBe(true);
    return r.state;
  };

  it.each(["a", "b"])(
    "2 players plus neutral: removing the other one in %s's turn gives the win",
    (turnOf) => {
      const s0 = twoPlayers();
      const s: GameState = { ...s0, activePlayerId: turnOf };
      const removed = turnOf === "a" ? "b" : "a";
      const winner = turnOf;
      const neutralBefore = Object.entries(s.territories).filter(([, t]) => t.ownerId === null);
      const r = okHost(s, remove(removed));
      expect(r.state.winnerId).toBe(winner);
      expect(r.state.winReason).toBe("lastPlayer");
      expect(types(r)).toEqual(["playerRemoved", "gameWon"]);
      // neutral territories stay as they are (plus the removed player's, now neutral)
      for (const [id] of neutralBefore) expect(r.state.territories[id]!.ownerId).toBeNull();
      // afterwards everything is GAME_OVER
      expect(applyAction(r.state, winner, { type: "endPhase" }, noRng)).toEqual({
        ok: false,
        code: "GAME_OVER",
      });
      expect(applyHostAction(r.state, { type: "skipTurn", turn: r.state.turn }, noRng)).toEqual({
        ok: false,
        code: "GAME_OVER",
      });
      expect(applyHostAction(r.state, remove(winner), noRng)).toEqual({
        ok: false,
        code: "GAME_OVER",
      });
    },
  );

  it("the winner of a removal in another player's turn wins without his own action", () => {
    const s = { ...twoPlayers(), activePlayerId: "b" };
    const r = okHost(s, remove("a"));
    expect(r.state.winnerId).toBe("b");
    expect(r.state.pendingOccupation).toBeNull();
  });
});

describe("neutral territories after a removal (3 players)", () => {
  // a holds eisenfurt 3, rabenhain 4, grauwacht 5; after b's removal tannenfeld (2) and salzmoor (1) are neutral.
  const afterRemoval = (): GameState =>
    okHost(scenarioS3({ phase: "attack", overrides: { reinforcementsLeft: 0 } }), remove("b"))
      .state;

  it("the neutral defender rolls the maximum: 2 dice with 2 armies, 1 die with 1 army; defenderId null", () => {
    const s = afterRemoval();
    const dice = createDiceRng([6, 5, 4, 3, 2]);
    const r = applyAction(
      s,
      "a",
      { type: "attack", from: "rabenhain", to: "tannenfeld", dice: 3 },
      dice,
    );
    if (!r.ok) throw new Error(r.code);
    expect(dice.remaining()).toBe(0);
    const roll = r.events.find((e) => e.type === "attackRolled")!;
    expect(roll).toMatchObject({ defenderId: null, defenderDice: [3, 2], defenderLosses: 2 });
    expect(r.state.territories["tannenfeld"]).toEqual({ ownerId: "a", armies: 3 });
    expect(r.state.lastCombat!.defenderId).toBeNull();
    expect(types(r)).not.toContain("playerEliminated");
    expect(r.state.conqueredThisTurn).toBe(true);
    // the conquest counts for the card at the end of the turn
    const fortify = act(r.state, { type: "endPhase" });
    const end = act(fortify.state, { type: "endPhase" });
    expect(end.state.secret.hand["a"]).toHaveLength(6);

    const one = createDiceRng([6, 5, 4, 3]);
    const r1 = applyAction(
      s,
      "a",
      { type: "attack", from: "grauwacht", to: "salzmoor", dice: 3 },
      one,
    );
    if (!r1.ok) throw new Error(r1.code);
    expect(one.remaining()).toBe(0);
    expect(r1.events.find((e) => e.type === "attackRolled")).toMatchObject({
      defenderId: null,
      defenderDice: [3],
    });
  });

  it("neutral territories give no continent bonus and do not count towards floor(territories / divisor)", () => {
    const s = afterRemoval();
    // a holds 3 territories; nordreich has tannenfeld (neutral): no +2. With divisor 1 and minimum 1 the count is 3.
    const rules = { ...testlandRules, minReinforcement: 1, territoryDivisor: 1 };
    expect(calculateReinforcements(testland, rules, s.territories, "a")).toBe(3);
    // c holds kupferstadt and nebelkueste; suedmark has two neutral territories: no +3
    expect(calculateReinforcements(testland, rules, s.territories, "c")).toBe(2);
    // after a takes tannenfeld the bonus is a's
    const taken = {
      ...s.territories,
      tannenfeld: { ownerId: "a", armies: 3 },
    };
    expect(calculateReinforcements(testland, rules, taken, "a")).toBe(4 + 2);
  });
});

describe("removePlayer: errors and edge cases", () => {
  it("checks GAME_OVER, UNKNOWN_PLAYER and PLAYER_REMOVED in this order", () => {
    const s = scenarioS3();
    expect(applyHostAction(s, remove("zed"), noRng)).toEqual({ ok: false, code: "UNKNOWN_PLAYER" });
    expect(applyHostAction(s, remove("constructor"), noRng)).toEqual({
      ok: false,
      code: "UNKNOWN_PLAYER",
    });
    const done = okHost(s, remove("b")).state;
    expect(applyHostAction(done, remove("b"), noRng)).toEqual({
      ok: false,
      code: "PLAYER_REMOVED",
    });
    const over = { ...s, winnerId: "a", winReason: "mission" as const };
    expect(applyHostAction(over, remove("zed"), noRng)).toEqual({ ok: false, code: "GAME_OVER" });
    expect(applyHostAction(over, remove("b"), noRng)).toEqual({ ok: false, code: "GAME_OVER" });
  });

  it("the input state of every failed call is deep-equal before and after", () => {
    const s = scenarioS3();
    const before = JSON.stringify(s);
    applyHostAction(s, remove("zed"), noRng);
    applyHostAction(s, { type: "skipTurn", turn: 99 }, noRng);
    expect(JSON.stringify(s)).toBe(before);
  });

  it("a player who is already eliminated can be removed: only the mark (and his meaningless mission) changes", () => {
    // c holds nothing: out since the conquest of his last territory; his cards went to the conqueror
    const s = makeState({
      players: ["a", "b", "c"],
      territories: { eisenfurt: ["a", 3] },
      fill: "b",
      overrides: { turn: 3 },
    });
    expect(isEliminated(s, "c")).toBe(true);
    const r = okHost(s, remove("c"));
    expect(r.state.removedPlayerIds).toEqual(["c"]);
    expect(r.events[0]).toEqual({
      type: "playerRemoved",
      playerId: "c",
      territoryCount: 0,
      discardedCount: 0,
    });
    expect(r.state.territories).toEqual(s.territories);
    expect(r.state.secret.hand).toEqual(s.secret.hand);
    expect(r.state.secret.discard).toEqual(s.secret.discard);
    expect(r.state.activePlayerId).toBe("a");
    expect(r.state.winnerId).toBeNull();
  });

  it("removing several players keeps the order of removal", () => {
    const s = makeState({
      players: ["a", "b", "c", "d"],
      territories: {
        eisenfurt: ["a", 2],
        tannenfeld: ["b", 2],
        kupferstadt: ["c", 2],
        nebelkueste: ["d", 2],
      },
      fill: "a",
    });
    const r = okHost(okHost(s, remove("d")).state, remove("b"));
    expect(r.state.removedPlayerIds).toEqual(["d", "b"]);
    expect(r.state.playerOrder).toEqual(["a", "b", "c", "d"]);
    expect(viewFor(r.state, "a").handCounts).toEqual({ a: 0, b: 0, c: 0, d: 0 });
  });

  it("in domination mode there are no missions to replace", () => {
    const s = scenarioS3({
      overrides: { rules: { ...testlandRules, victoryMode: "domination" } },
      missions: { a: null, b: null, c: null },
    });
    const r = okHost(s, remove("b"));
    expect(r.state.secret.mission).toEqual({ a: null, b: null, c: null });
    expect(r.state.secret.missionReplaced).toEqual({ a: false, b: false, c: false });
  });
});
