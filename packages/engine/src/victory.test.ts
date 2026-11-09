import { describe, expect, it } from "vitest";
import { applyAction, checkVictory, createDiceRng, testlandMissions, viewFor } from "./index.js";
import type { Action, ActionResult, GameEvent, GameState, Mission, Rng } from "./index.js";
import { makeState, withCards, withMissions } from "./testkit.js";

// testland: eisenfurt-rabenhain, eisenfurt-grauwacht, rabenhain-tannenfeld, grauwacht-tannenfeld,
// grauwacht-salzmoor, salzmoor-dornental, salzmoor-kupferstadt, dornental-nebelkueste, kupferstadt-nebelkueste.
// nordreich: eisenfurt, rabenhain, grauwacht, tannenfeld. suedmark: the other four.

const noRng: Rng = {
  int: () => {
    throw new Error("rng used");
  },
};
const hold = (count: number, minArmies: number): Mission => ({
  type: "holdTerritories",
  count,
  minArmies,
});
const kill = (targetPlayerId: string): Mission => ({ type: "eliminatePlayer", targetPlayerId });
const attack = (from: string, to: string, dice: number): Action => ({
  type: "attack",
  from,
  to,
  dice,
});
const skip: Action = { type: "endPhase" };

function ok(s: GameState, action: Action, faces: number[] | Rng = [], player = s.activePlayerId) {
  const rng = Array.isArray(faces) ? (faces.length ? createDiceRng(faces) : noRng) : faces;
  const r: ActionResult = applyAction(s, player, action, rng);
  if (!r.ok) throw new Error(`unexpected ${r.code}`);
  return r;
}
const types = (events: GameEvent[]) => events.map((e) => e.type);
const codeOf = (s: GameState, a: Action) => {
  const r = applyAction(s, s.activePlayerId, a, noRng);
  return r.ok ? "OK" : r.code;
};

describe("eliminatePlayer missions", () => {
  /** a (active) holds eisenfurt 5; b's only territory is rabenhain; c holds the rest. */
  const three = (missions: Record<string, Mission | null>) =>
    withMissions(
      makeState({
        players: ["a", "b", "c"],
        territories: { eisenfurt: ["a", 5], rabenhain: ["b", 1] },
        fill: "c",
      }),
      missions,
    );

  it("the holder eliminates the target himself: instant win, no move-in open", () => {
    const r = ok(
      three({ a: kill("b"), b: hold(6, 2), c: hold(6, 2) }),
      attack("eisenfurt", "rabenhain", 3),
      [6, 5, 4, 1],
    );
    expect(r.state.winnerId).toBe("a");
    expect(r.state.winReason).toBe("mission");
    expect(r.state.pendingOccupation).toBeNull();
    expect(types(r.events)).toContain("playerEliminated");
    expect(r.events.at(-1)).toEqual({ type: "gameWon", playerId: "a", reason: "mission" });
    expect(codeOf(r.state, skip)).toBe("GAME_OVER");
  });

  it("a third party eliminates the target: the holder gets the fallback, the eliminator does not win", () => {
    const s = three({ a: hold(6, 3), b: hold(6, 2), c: kill("b") });
    const r = ok(s, attack("eisenfurt", "rabenhain", 3), [6, 5, 4, 1]);
    expect(r.state.winnerId).toBeNull();
    expect(r.state.winReason).toBeNull();
    expect(r.state.secret.mission["c"]).toEqual(testlandMissions.fallback);
    expect(r.state.secret.missionReplaced).toEqual({ a: false, b: false, c: true });
    expect(r.state.secret.originalMission["c"]).toEqual(kill("b"));
    // the eliminator's own mission is untouched and the open move-in goes on
    expect(r.state.secret.mission["a"]).toEqual(hold(6, 3));
    expect(r.state.pendingOccupation).not.toBeNull();
  });

  it("the replacement creates no event and no public view field", () => {
    const s = three({ a: hold(6, 3), b: hold(6, 2), c: kill("b") });
    const plain = three({ a: hold(6, 3), b: hold(6, 2), c: hold(6, 2) });
    const withTarget = ok(s, attack("eisenfurt", "rabenhain", 3), [6, 5, 4, 1]);
    const without = ok(plain, attack("eisenfurt", "rabenhain", 3), [6, 5, 4, 1]);
    expect(withTarget.events).toEqual(without.events);
    for (const who of ["a", "b"]) {
      expect(JSON.stringify(viewFor(withTarget.state, who))).toEqual(
        JSON.stringify(viewFor(without.state, who)),
      );
    }
  });

  it("the eliminated player's own mission stays unchanged", () => {
    const s = three({ a: hold(6, 3), b: kill("c"), c: hold(6, 2) });
    const r = ok(s, attack("eisenfurt", "rabenhain", 3), [6, 5, 4, 1]);
    expect(r.state.secret.mission["b"]).toEqual(kill("c"));
    expect(r.state.secret.missionReplaced["b"]).toBe(false);
  });

  it("order: cards taken, missions replaced, then the check (the conqueror is not the one who wins by it)", () => {
    const s = withCards(three({ a: hold(6, 3), b: hold(6, 2), c: kill("b") }), {
      hand: { a: ["card-joker-1"], b: ["card-salzmoor", "card-dornental"], c: [] },
      deck: [],
    });
    const r = ok(s, attack("eisenfurt", "rabenhain", 3), [6, 5, 4, 1]);
    expect(types(r.events).indexOf("playerEliminated")).toBeLessThan(
      types(r.events).indexOf("cardsTaken"),
    );
    expect(r.state.secret.hand["a"]).toEqual(["card-joker-1", "card-salzmoor", "card-dornental"]);
    expect(r.state.secret.hand["b"]).toEqual([]);
    expect(r.state.secret.mission["c"]).toEqual(testlandMissions.fallback);
  });

  it("a replacement that is already met wins at the start of the holder's next turn", () => {
    // c holds six territories with 2 armies each: the fallback { 6, 2 } is met the moment it is dealt
    const s = withMissions(
      makeState({
        players: ["a", "b", "c"],
        territories: {
          eisenfurt: ["a", 5],
          rabenhain: ["b", 1],
          grauwacht: ["c", 2],
          tannenfeld: ["c", 2],
          salzmoor: ["c", 2],
          dornental: ["c", 2],
          kupferstadt: ["c", 2],
          nebelkueste: ["c", 2],
        },
      }),
      { a: hold(6, 3), b: hold(6, 3), c: kill("b") },
    );
    const conquered = ok(s, attack("eisenfurt", "rabenhain", 3), [6, 5, 4, 1]).state;
    expect(conquered.winnerId).toBeNull(); // not in a's turn
    const occupied = ok(conquered, { type: "occupy", count: 3 }).state;
    expect(occupied.winnerId).toBeNull();
    const toFortify = ok(occupied, skip).state;
    const next = ok(toFortify, skip);
    expect(next.state.activePlayerId).toBe("c"); // b is out and skipped
    expect(next.state.winnerId).toBe("c");
    expect(next.state.winReason).toBe("mission");
    expect(types(next.events).slice(-2)).toEqual(["turnStarted", "gameWon"]);
    expect(applyAction(next.state, "c", skip, noRng)).toEqual({ ok: false, code: "GAME_OVER" });
  });

  it("... but only if it is still met then: a second conquest in the same turn breaks it", () => {
    const s = withMissions(
      makeState({
        players: ["a", "b", "c"],
        territories: {
          eisenfurt: ["a", 5],
          rabenhain: ["b", 1],
          grauwacht: ["c", 2],
          tannenfeld: ["c", 2],
          salzmoor: ["c", 2],
          dornental: ["c", 2],
          kupferstadt: ["c", 2],
          nebelkueste: ["c", 2],
        },
      }),
      { a: hold(8, 9), b: hold(6, 3), c: kill("b") },
    );
    let t = ok(s, attack("eisenfurt", "rabenhain", 3), [6, 5, 4, 1]).state;
    t = ok(t, { type: "occupy", count: 3 }).state; // rabenhain 3, eisenfurt 2
    t = ok(t, attack("rabenhain", "tannenfeld", 2), [6, 5, 1, 1]).state; // c drops to five territories
    expect(t.territories["tannenfeld"]!.ownerId).toBe("a");
    expect(t.winnerId).toBeNull();
    const next = ok(ok(t, skip).state, skip);
    expect(next.state.activePlayerId).toBe("c");
    expect(next.state.winnerId).toBeNull();
  });
});

describe("win check timing", () => {
  const mk = (
    territories: Record<string, [string, number]>,
    missions: Record<string, Mission | null>,
  ) => withMissions(makeState({ territories, fill: "b" }), missions);

  it("a mission met in someone else's turn does not win; it wins when that player's turn starts", () => {
    // b holds six territories: { 5, 1 } is met all the time, but a is the active player
    const s = mk({ eisenfurt: ["a", 5], rabenhain: ["a", 2] }, { b: hold(5, 1), a: hold(8, 9) });
    const placed = ok(
      { ...s, phase: "reinforce", reinforcementsLeft: 1 },
      { type: "placeArmies", territoryId: "eisenfurt", count: 1 },
    );
    expect(placed.state.winnerId).toBeNull();
    const toFortify = ok(ok(s, skip).state, skip);
    expect(toFortify.state.activePlayerId).toBe("b");
    expect(toFortify.state.winnerId).toBe("b");
    expect(toFortify.state.winReason).toBe("mission");
    expect(types(toFortify.events).slice(-2)).toEqual(["turnStarted", "gameWon"]);
  });

  it("a mission broken in the meantime does not win", () => {
    const s = mk(
      { eisenfurt: ["a", 5], grauwacht: ["a", 1], tannenfeld: ["a", 1] },
      { b: hold(5, 1), a: hold(8, 9) },
    );
    // b: rabenhain, salzmoor, dornental, kupferstadt, nebelkueste = 5, met now
    let t = ok(s, attack("eisenfurt", "rabenhain", 3), [6, 5, 4, 1]).state;
    t = ok(t, { type: "occupy", count: 3 }).state;
    expect(t.winnerId).toBeNull();
    const next = ok(ok(t, skip).state, skip);
    expect(next.state.activePlayerId).toBe("b");
    expect(next.state.winnerId).toBeNull();
  });

  it("placeArmies can complete a holdTerritories mission", () => {
    const s = withMissions(
      makeState({
        phase: "reinforce",
        overrides: { reinforcementsLeft: 2 },
        territories: {
          eisenfurt: ["a", 2],
          rabenhain: ["a", 2],
          grauwacht: ["a", 2],
          tannenfeld: ["a", 2],
          salzmoor: ["a", 1],
        },
      }),
      { a: hold(5, 2) },
    );
    const first = ok(s, { type: "placeArmies", territoryId: "eisenfurt", count: 1 });
    expect(first.state.winnerId).toBeNull();
    const r = ok(first.state, { type: "placeArmies", territoryId: "salzmoor", count: 1 });
    expect(r.state.winnerId).toBe("a");
    expect(r.events.at(-1)).toEqual({ type: "gameWon", playerId: "a", reason: "mission" });
  });

  it("tradeCards can complete a mission through the territory bonus", () => {
    // 3 x infantry: eisenfurt, tannenfeld, kupferstadt. Bonus +2 on eisenfurt lifts it from 1 to 3 armies.
    const s = withCards(
      withMissions(
        makeState({
          phase: "reinforce",
          territories: {
            eisenfurt: ["a", 1],
            rabenhain: ["a", 3],
            grauwacht: ["a", 3],
            tannenfeld: ["a", 3],
          },
        }),
        { a: hold(4, 3) },
      ),
      { hand: { a: ["card-eisenfurt", "card-tannenfeld", "card-kupferstadt"] } },
    );
    expect(s.winnerId).toBeNull();
    const r = ok(s, {
      type: "tradeCards",
      cardIds: ["card-eisenfurt", "card-tannenfeld", "card-kupferstadt"],
    });
    expect(r.state.territories["eisenfurt"]!.armies).toBe(3);
    expect(r.state.winnerId).toBe("a");
    expect(r.state.winReason).toBe("mission");
  });

  it("fortify checks the mover before the turn ends: no turn end, no card, no turn change", () => {
    const s = withCards(
      withMissions(
        makeState({
          phase: "fortify",
          territories: {
            eisenfurt: ["a", 5],
            rabenhain: ["a", 1],
            grauwacht: ["a", 3],
            tannenfeld: ["a", 3],
          },
          overrides: { conqueredThisTurn: true },
        }),
        { a: hold(4, 3) },
      ),
      { deck: ["card-salzmoor"], hand: { a: [] } },
    );
    const r = ok(s, { type: "fortify", from: "eisenfurt", to: "rabenhain", count: 2 });
    expect(r.state.winnerId).toBe("a");
    expect(r.state.activePlayerId).toBe("a");
    expect(r.state.turn).toBe(s.turn);
    expect(r.state.secret.hand["a"]).toEqual([]);
    expect(r.state.secret.deck).toEqual(["card-salzmoor"]);
    expect(types(r.events)).toEqual(["armiesFortified", "gameWon"]);
  });

  it("endPhase never wins and never draws attention: the mission stays unmet through the whole turn", () => {
    const s = mk({ eisenfurt: ["a", 5] }, { a: hold(8, 9), b: hold(8, 9) });
    const r = ok(s, skip);
    expect(r.state.winnerId).toBeNull();
    expect(r.state.phase).toBe("fortify");
  });

  it("checkVictory on its own: no win without a mission or when already decided", () => {
    const s = mk({ eisenfurt: ["a", 5] }, { a: null });
    expect(checkVictory(s, []).state).toBe(s);
    const won = { ...s, winnerId: "b", winReason: "lastPlayer" as const };
    expect(checkVictory(won, []).state).toBe(won);
  });

  it("domination ignores missions", () => {
    const s = withMissions(
      makeState({ territories: { eisenfurt: ["a", 5], rabenhain: ["b", 1] }, fill: "b" }),
      { a: kill("b") },
    );
    const dom: GameState = { ...s, rules: { ...s.rules, victoryMode: "domination" } };
    const r = ok(dom, attack("eisenfurt", "rabenhain", 3), [6, 5, 4, 1]);
    expect(r.state.winnerId).toBeNull(); // b still holds other territories
  });
});

describe("last player left (condition a)", () => {
  it("wins in both modes, with reason lastPlayer", () => {
    for (const victoryMode of ["missions", "domination"] as const) {
      const s = makeState({ territories: { eisenfurt: ["a", 5], rabenhain: ["b", 1] }, fill: "a" });
      const r = ok(
        { ...s, rules: { ...s.rules, victoryMode } },
        attack("eisenfurt", "rabenhain", 3),
        [6, 5, 4, 1],
      );
      expect(r.state.winnerId).toBe("a");
      expect(r.state.winReason).toBe("lastPlayer");
      expect(r.state.pendingOccupation).toBeNull();
      expect(r.events.at(-1)).toEqual({ type: "gameWon", playerId: "a", reason: "lastPlayer" });
    }
  });

  it("a) and b) at the same time: the winner is the same, the reason is lastPlayer", () => {
    // a holds the rest of nordreich, b's last territory is tannenfeld: the conquest completes nordreich too
    const s = withMissions(
      makeState({
        territories: {
          eisenfurt: ["a", 1],
          rabenhain: ["a", 4],
          grauwacht: ["a", 1],
          tannenfeld: ["b", 1],
        },
        fill: "a",
      }),
      { a: { type: "conquerContinents", continentIds: ["nordreich"], extraContinents: 0 } },
    );
    const r = ok(s, attack("rabenhain", "tannenfeld", 3), [6, 5, 4, 1]);
    expect(r.state.winnerId).toBe("a");
    expect(r.state.winReason).toBe("lastPlayer");
  });

  it("elimination with taken cards ends the game in a consistent state", () => {
    const s = withCards(
      makeState({ territories: { eisenfurt: ["a", 5], rabenhain: ["b", 1] }, fill: "a" }),
      {
        hand: {
          a: ["card-joker-1", "card-joker-2", "card-eisenfurt"],
          b: [
            "card-rabenhain",
            "card-grauwacht",
            "card-tannenfeld",
            "card-salzmoor",
            "card-dornental",
            "card-kupferstadt",
            "card-nebelkueste",
          ],
        },
        deck: [],
        discard: [],
      },
    );
    const r = ok(s, attack("eisenfurt", "rabenhain", 3), [6, 5, 4, 1]);
    expect(r.state.winnerId).toBe("a");
    expect(r.state.secret.hand["a"]).toHaveLength(10);
    expect(r.state.secret.hand["b"]).toEqual([]);
    expect(r.state.secret.deck).toEqual([]);
  });

  it("elimination with the whole deck in the loser's hand (testland has 10 cards) is consistent", () => {
    const all = [
      "card-eisenfurt",
      "card-rabenhain",
      "card-grauwacht",
      "card-tannenfeld",
      "card-salzmoor",
      "card-dornental",
      "card-kupferstadt",
      "card-nebelkueste",
      "card-joker-1",
      "card-joker-2",
    ];
    const s = withCards(
      makeState({ territories: { eisenfurt: ["a", 5], rabenhain: ["b", 1] }, fill: "a" }),
      { hand: { a: [], b: all }, deck: [], discard: [] },
    );
    const r = ok(s, attack("eisenfurt", "rabenhain", 3), [6, 5, 4, 1]);
    expect(r.state.winnerId).toBe("a");
    expect(r.state.secret.hand["a"]).toEqual(all);
    expect(r.state.secret.hand["b"]).toEqual([]);
    expect(types(r.events)).toContain("cardsTaken");
  });

  it("2 players with a neutral owner: eliminating the opponent wins although neutral territories remain", () => {
    for (const victoryMode of ["missions", "domination"] as const) {
      const base = makeState({
        territories: { eisenfurt: ["a", 5], rabenhain: ["b", 1] },
        fill: null,
      });
      const s = withMissions(
        { ...base, rules: { ...base.rules, victoryMode } },
        { a: hold(8, 9), b: hold(8, 9) },
      );
      expect(Object.values(s.territories).some((t) => t.ownerId === null)).toBe(true);
      const r = ok(s, attack("eisenfurt", "rabenhain", 3), [6, 5, 4, 1]);
      expect(r.state.winnerId).toBe("a");
      expect(r.state.winReason).toBe("lastPlayer");
      expect(Object.values(r.state.territories).some((t) => t.ownerId === null)).toBe(true);
    }
  });

  it("holding every territory still ends the game (the old provisional rule is covered by a)", () => {
    const s = makeState({ territories: { eisenfurt: ["a", 5], rabenhain: ["b", 1] }, fill: "a" });
    const r = ok(s, attack("eisenfurt", "rabenhain", 3), [6, 5, 4, 1]);
    expect(r.state.winnerId).toBe("a");
  });
});

describe("win during a conquest (question 21): plan section 6 scenario with fixed numbers", () => {
  const board = (grauwacht: number, mission: Mission) =>
    withMissions(
      makeState({
        territories: {
          eisenfurt: ["a", 2],
          rabenhain: ["a", 2],
          tannenfeld: ["a", 2],
          grauwacht: ["a", grauwacht],
          salzmoor: ["b", 1],
          dornental: ["b", 1],
          kupferstadt: ["b", 1],
          nebelkueste: ["b", 1],
        },
      }),
      { a: mission, b: hold(6, 3) },
    );
  const strike = attack("grauwacht", "salzmoor", 3);

  it("after the attack: move-in open (min 3, max 4), no winner although the interim state looks met", () => {
    const r = ok(board(5, hold(5, 2)), strike, [6, 5, 4, 2]);
    expect(r.state.pendingOccupation).toEqual({ from: "grauwacht", to: "salzmoor", min: 3 });
    expect(viewFor(r.state, "a").pendingOccupation).toEqual({
      from: "grauwacht",
      to: "salzmoor",
      min: 3,
      max: 4,
    });
    expect(r.state.territories["grauwacht"]!.armies).toBe(2);
    expect(r.state.territories["salzmoor"]!.armies).toBe(3);
    expect(r.state.winnerId).toBeNull();
    expect(r.state.winReason).toBeNull();
    expect(types(r.events)).not.toContain("gameWon");
    expect(types(r.events)).not.toContain("playerEliminated"); // b keeps three territories
  });

  it("run A: occupy 4 leaves 4 territories with 2+ armies: no win, the game goes on", () => {
    const attacked = ok(board(5, hold(5, 2)), strike, [6, 5, 4, 2]).state;
    const r = ok(attacked, { type: "occupy", count: 4 });
    expect(r.state.territories["grauwacht"]!.armies).toBe(1);
    expect(r.state.territories["salzmoor"]!.armies).toBe(4);
    expect(r.state.winnerId).toBeNull();
    expect(r.state.phase).toBe("attack");
    expect(r.state.pendingOccupation).toBeNull();
    expect(applyAction(r.state, "a", skip, noRng).ok).toBe(true);
  });

  it("run B: occupy 3 gives five territories with 2+ armies: win now, game over, no card", () => {
    const attacked = withCards(ok(board(5, hold(5, 2)), strike, [6, 5, 4, 2]).state, {
      deck: ["card-salzmoor"],
    });
    const r = ok(attacked, { type: "occupy", count: 3 });
    expect(r.state.winnerId).toBe("a");
    expect(r.state.winReason).toBe("mission");
    expect(r.state.pendingOccupation).toBeNull();
    expect(r.events.at(-1)).toEqual({ type: "gameWon", playerId: "a", reason: "mission" });
    expect(r.state.secret.hand["a"]).toEqual([]);
    for (const a of [
      skip,
      attack("grauwacht", "salzmoor", 1),
      { type: "occupy", count: 3 } as Action,
    ]) {
      expect(codeOf(r.state, a)).toBe("GAME_OVER");
    }
  });

  it("run C: an automatic move-in (min = max) is checked right after it: only four territories, no win", () => {
    const r = ok(board(3, hold(5, 2)), attack("grauwacht", "salzmoor", 2), [6, 5, 2]);
    expect(r.state.territories["grauwacht"]!.armies).toBe(1);
    expect(r.state.territories["salzmoor"]!.armies).toBe(2);
    expect(r.state.pendingOccupation).toBeNull();
    expect(r.state.winnerId).toBeNull();
  });

  it("run C2: an automatic move-in that completes the mission wins at once", () => {
    // grauwacht 3 -> after moving 2 in: grauwacht 1, salzmoor 2; a mission { 4, 2 } counts e, r, t, s = 4
    const r = ok(board(3, hold(4, 2)), attack("grauwacht", "salzmoor", 2), [6, 5, 2]);
    expect(r.state.winnerId).toBe("a");
    expect(r.state.pendingOccupation).toBeNull();
  });

  it("run D: a conquest that completes a continent wins before occupy", () => {
    const s = withMissions(
      makeState({
        territories: {
          eisenfurt: ["a", 1],
          rabenhain: ["a", 4],
          grauwacht: ["a", 1],
          tannenfeld: ["b", 1],
        },
        fill: "b",
      }),
      {
        a: { type: "conquerContinents", continentIds: ["nordreich"], extraContinents: 0 },
        b: hold(6, 3),
      },
    );
    const r = ok(s, attack("rabenhain", "tannenfeld", 3), [6, 5, 4, 1]);
    expect(r.state.winnerId).toBe("a");
    expect(r.state.winReason).toBe("mission");
    expect(r.state.pendingOccupation).toBeNull();
    expect(codeOf(r.state, { type: "occupy", count: 3 })).toBe("GAME_OVER");
  });

  it("holdTerritories with minArmies 1 is also only checked after occupy", () => {
    const s = withMissions(
      makeState({
        territories: {
          eisenfurt: ["a", 1],
          rabenhain: ["a", 1],
          tannenfeld: ["a", 1],
          grauwacht: ["a", 5],
          salzmoor: ["b", 1],
        },
        fill: "b",
      }),
      { a: hold(5, 1), b: hold(8, 9) },
    );
    const attacked = ok(s, strike, [6, 5, 4, 2]);
    expect(attacked.state.pendingOccupation).not.toBeNull();
    expect(attacked.state.winnerId).toBeNull();
    expect(ok(attacked.state, { type: "occupy", count: 3 }).state.winnerId).toBe("a");
  });
});
