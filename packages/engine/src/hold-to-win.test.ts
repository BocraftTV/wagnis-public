import { describe, expect, it } from "vitest";
import { applyAction, applyHostAction, createDiceRng, testlandRules } from "./index.js";
import type { Action, GameState, Mission, Rng } from "./index.js";
import { makeState, withMissions } from "./testkit.js";

// testland: eisenfurt-rabenhain, eisenfurt-grauwacht, rabenhain-tannenfeld, grauwacht-tannenfeld,
// grauwacht-salzmoor, salzmoor-dornental, salzmoor-kupferstadt, dornental-nebelkueste, kupferstadt-nebelkueste.

const noRng: Rng = {
  int: () => {
    throw new Error("rng used");
  },
};
const hold = (count: number, minArmies = 1): Mission => ({
  type: "holdTerritories",
  count,
  minArmies,
});
const holdRules = { ...testlandRules, holdToWin: true };

function ok(s: GameState, action: Action, faces: number[] = []): GameState {
  const rng = faces.length ? createDiceRng(faces) : noRng;
  const r = applyAction(s, s.activePlayerId, action, rng);
  if (!r.ok) throw new Error(`unexpected ${r.code}`);
  return r.state;
}
/** Places every reinforcement on the first own territory and ends the turn (no attack, no fortify). */
function passTurn(s: GameState): GameState {
  const me = s.activePlayerId;
  let state = s;
  if (state.reinforcementsLeft > 0) {
    const [id] = Object.entries(state.territories).find(([, t]) => t.ownerId === me)!;
    state = ok(state, { type: "placeArmies", territoryId: id, count: state.reinforcementsLeft });
  }
  while (state.activePlayerId === me && state.winnerId === null) {
    state = ok(state, { type: "endPhase" });
  }
  return state;
}

/** a owns the four northern territories (mission: hold 4), b the rest with `bArmies` in salzmoor. */
function base(
  missions: Record<string, Mission | null>,
  extra: Partial<GameState> = {},
  rules = holdRules,
): GameState {
  return withMissions(
    makeState({
      territories: {
        eisenfurt: ["a", 3],
        rabenhain: ["a", 1],
        grauwacht: ["a", 1],
        tannenfeld: ["a", 1],
        salzmoor: ["b", 10],
      },
      overrides: { rules, ...extra },
    }),
    missions,
  );
}

describe("holdToWin", () => {
  it("a mission met at the end of the turn does not win; the next own turn start does, if still met", () => {
    let s = base({ a: hold(4), b: hold(8) });
    s = passTurn(s); // a ends the turn with the mission met
    expect(s.winnerId).toBeNull();
    expect(s.secret.victoryPending["a"]).toBe(true);
    expect(s.secret.victoryPending["b"]).toBe(false);
    expect(s.activePlayerId).toBe("b");
    s = passTurn(s); // b does nothing; a's turn begins
    expect(s.winnerId).toBe("a");
    expect(s.winReason).toBe("mission");
    expect(s.activePlayerId).toBe("a");
  });

  it("without the option the same position wins at the next turn start without any marker (control)", () => {
    const s = base({ a: hold(4), b: hold(8) }, {}, testlandRules);
    const done = passTurn(passTurn(s));
    expect(done.secret.victoryPending["a"]).toBe(false);
    expect(done.winnerId).toBe("a");
  });

  it("a conquest that meets the mission in the middle of the turn does not win; the end of the turn sets the marker", () => {
    // a holds 3 (mission 4): attacking salzmoor from grauwacht conquers the 4th... salzmoor has 10 armies, so
    // give b a weak neighbour instead: b's salzmoor only has 1 army here
    let s = withMissions(
      makeState({
        territories: {
          eisenfurt: ["a", 3],
          rabenhain: ["a", 1],
          grauwacht: ["a", 5],
          salzmoor: ["b", 1],
          dornental: ["b", 1],
        },
        fill: "b",
        overrides: { rules: holdRules },
      }),
      { a: hold(4), b: hold(8) },
    );
    s = ok(s, { type: "attack", from: "grauwacht", to: "salzmoor", dice: 3 }, [6, 5, 4, 1]);
    expect(s.territories["salzmoor"]!.ownerId).toBe("a");
    s = ok(s, { type: "occupy", count: 3 });
    expect(s.winnerId).toBeNull(); // met mid-turn, but held missions only win at a turn start
    s = passTurn(s);
    expect(s.secret.victoryPending["a"]).toBe(true);
  });

  it("an opponent who breaks the mission in between stops the win; the marker is gone at a's next turn start", () => {
    let s = base({ a: hold(4), b: hold(8) });
    s = passTurn(s);
    expect(s.secret.victoryPending["a"]).toBe(true);
    // b takes grauwacht from a (1 army) with salzmoor's 10 armies
    s = ok(s, { type: "placeArmies", territoryId: "salzmoor", count: s.reinforcementsLeft });
    s = ok(s, { type: "endPhase" });
    s = ok(s, { type: "attack", from: "salzmoor", to: "grauwacht", dice: 3 }, [6, 5, 4, 1]);
    s = ok(s, { type: "occupy", count: 3 });
    expect(s.secret.victoryPending["a"]).toBe(true); // stays until a's turn: no information for b
    s = passTurn(s);
    expect(s.winnerId).toBeNull();
    expect(s.activePlayerId).toBe("a");
    expect(s.secret.victoryPending["a"]).toBe(false);
  });

  it("no marker, no win: a mission that happens to be met at the turn start is not enough", () => {
    // a's turn comes next, a holds 4, but never ended a turn with the mission met
    let s = base({ a: hold(4), b: hold(8) }, { activePlayerId: "b" as never });
    s = passTurn(s);
    expect(s.activePlayerId).toBe("a");
    expect(s.winnerId).toBeNull();
    expect(s.secret.victoryPending["a"]).toBe(false);
  });

  it("blitzkrieg and eliminatePlayer still win at once", () => {
    const blitz = withMissions(
      makeState({
        territories: { eisenfurt: ["a", 30], nebelkueste: ["b", 1] },
        overrides: { rules: holdRules },
      }),
      { a: { type: "blitzkrieg", count: 1 }, b: null },
    );
    const won = ok(
      blitz,
      { type: "attack", from: "eisenfurt", to: "rabenhain", dice: 3 },
      [6, 5, 4, 1],
    );
    expect(won.winnerId).toBe("a");

    const kill = withMissions(
      makeState({
        players: ["a", "b", "c"],
        territories: { eisenfurt: ["a", 5], rabenhain: ["b", 1] },
        fill: "c",
        overrides: { rules: holdRules },
      }),
      { a: { type: "eliminatePlayer", targetPlayerId: "b" }, b: hold(6), c: hold(6) },
    );
    const done = ok(
      kill,
      { type: "attack", from: "eisenfurt", to: "rabenhain", dice: 3 },
      [6, 5, 4, 1],
    );
    expect(done.winnerId).toBe("a");
  });

  it("the last player standing wins at once", () => {
    const s = withMissions(
      makeState({
        territories: { eisenfurt: ["a", 5], rabenhain: ["b", 1] },
        fill: "a",
        overrides: { rules: holdRules },
      }),
      { a: hold(8), b: hold(8) },
    );
    const won = ok(
      s,
      { type: "attack", from: "eisenfurt", to: "rabenhain", dice: 3 },
      [6, 5, 4, 1],
    );
    expect(won.winnerId).toBe("a");
    expect(won.winReason).toBe("lastPlayer");
  });

  it("the host's skipTurn ends the turn like any other: the marker is set", () => {
    const s = base({ a: hold(4), b: hold(8) });
    const r = applyHostAction(s, { type: "skipTurn", turn: s.turn }, noRng);
    if (!r.ok) throw new Error(r.code);
    expect(r.state.secret.victoryPending["a"]).toBe(true);
    expect(r.state.winnerId).toBeNull();
  });

  it("removePlayer clears the marker of the removed player", () => {
    let s = passTurn(base({ a: hold(4), b: hold(8) }));
    expect(s.secret.victoryPending["a"]).toBe(true);
    const r = applyHostAction(s, { type: "removePlayer", playerId: "a" }, noRng);
    if (!r.ok) throw new Error(r.code);
    s = r.state;
    expect(s.secret.victoryPending["a"]).toBe(false);
  });
});
