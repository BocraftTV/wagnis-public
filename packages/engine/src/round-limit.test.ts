import { describe, expect, it } from "vitest";
import {
  createGame,
  createSeededRng,
  applyHostAction,
  scoreboard,
  testland,
  testlandRules,
  viewFor,
} from "./index.js";
import { playRandomGame } from "./playbot.js";
import type { GameState, Mission, Rng } from "./index.js";
import { makeState, withMissions } from "./testkit.js";

// testland: nordreich (bonus 2) = eisenfurt, rabenhain, grauwacht, tannenfeld; suedmark (bonus 3) = salzmoor,
// dornental, kupferstadt, nebelkueste.

const noRng: Rng = {
  int: () => {
    throw new Error("rng used");
  },
};

function skip(s: GameState): { state: GameState; types: string[] } {
  const r = applyHostAction(s, { type: "skipTurn", turn: s.turn }, noRng);
  if (!r.ok) throw new Error(r.code);
  return { state: r.state, types: r.events.map((e) => e.type) };
}

const three = (extra: Partial<GameState> = {}): GameState =>
  makeState({
    players: ["a", "b", "c"],
    territories: {
      eisenfurt: ["a", 2],
      rabenhain: ["a", 1],
      grauwacht: ["b", 1],
      tannenfeld: ["b", 1],
      salzmoor: ["c", 1],
      dornental: ["c", 1],
      kupferstadt: ["c", 1],
      nebelkueste: ["c", 1],
    },
    overrides: extra,
  });

describe("round counter (rules.md 11.1)", () => {
  it("counts rounds over 7 turns with 3 players: turn 7 is round 3", () => {
    let s = three();
    const rounds = [s.round];
    for (let i = 0; i < 6; i++) {
      s = skip(s).state;
      rounds.push(s.round);
    }
    expect(s.turn).toBe(7);
    expect(rounds).toEqual([1, 1, 1, 2, 2, 2, 3]);
  });

  it("roundStarted comes once per wrap, before the phase change and turnStarted", () => {
    let s = three();
    const all: string[][] = [];
    for (let i = 0; i < 4; i++) {
      const r = skip(s);
      s = r.state;
      all.push(r.types);
    }
    expect(all.map((t) => t.includes("roundStarted"))).toEqual([false, false, true, false]);
    const t = all[2]!;
    expect(t.indexOf("roundStarted")).toBeLessThan(t.indexOf("phaseChanged"));
    expect(t.indexOf("phaseChanged")).toBeLessThan(t.indexOf("turnStarted"));
  });

  it("starts at round 1 for the first player", () => {
    expect(three().round).toBe(1);
  });

  it("stays right when the start player is out: the round ends after the last player", () => {
    // a has no territory; b and c play. b is the first player still in.
    let s = makeState({
      players: ["a", "b", "c"],
      active: "b",
      territories: { eisenfurt: ["b", 1], salzmoor: ["c", 1] },
      fill: "b",
    });
    s = { ...s, round: 4 };
    s = skip(s).state; // b -> c
    expect(s.activePlayerId).toBe("c");
    expect(s.round).toBe(4);
    s = skip(s).state; // c -> b: a is skipped, new round
    expect(s.activePlayerId).toBe("b");
    expect(s.round).toBe(5);
  });

  it("without a limit nobody is scored, however many rounds pass", () => {
    let s = three({ round: 40 });
    for (let i = 0; i < 6; i++) s = skip(s).state;
    expect(s.winnerId).toBeNull();
    expect(s.round).toBe(42);
  });
});

describe("round limit and score (rules.md 11.2)", () => {
  const limited = (extra: Partial<GameState> = {}): GameState =>
    three({ rules: { ...testlandRules, roundLimit: 8 }, ...extra });

  it("the turn of the last player in the last round scores instead of passing on", () => {
    let s = limited({ round: 8, activePlayerId: "b" });
    s = skip(s).state; // b is not last: c plays on
    expect(s.activePlayerId).toBe("c");
    expect(s.winnerId).toBeNull();
    const r = skip(s);
    expect(r.state.winReason).toBe("roundLimit");
    expect(r.state.winnerId).not.toBeNull();
    expect(r.types).not.toContain("roundStarted");
    expect(r.types).not.toContain("turnStarted");
    expect(r.types.at(-1)).toBe("gameWon");
  });

  it("rounds before the limit just go on", () => {
    const s = skip(limited({ round: 7, activePlayerId: "c" })).state;
    expect(s.winnerId).toBeNull();
    expect(s.round).toBe(8);
    expect(s.activePlayerId).toBe("a");
  });

  it("points = territories + bonus of every continent held completely", () => {
    const s = makeState({
      players: ["a", "b"],
      territories: {
        eisenfurt: ["a", 1],
        rabenhain: ["a", 1],
        grauwacht: ["a", 1],
        tannenfeld: ["a", 1],
        salzmoor: ["b", 3],
      },
      fill: "b",
    });
    const board = scoreboard(s);
    expect(board).toEqual([
      { playerId: "a", territories: 4, continentBonus: 2, points: 6, armies: 4 },
      { playerId: "b", territories: 4, continentBonus: 3, points: 7, armies: 6 },
    ]);
  });

  it("most points win; the neutral owner never counts", () => {
    let s = makeState({
      players: ["a", "b", "c"],
      active: "c",
      territories: {
        eisenfurt: ["a", 1],
        rabenhain: ["a", 1],
        grauwacht: ["a", 1],
        tannenfeld: ["b", 1],
        salzmoor: ["c", 1],
        dornental: ["c", 1],
      },
      fill: null,
      overrides: { rules: { ...testlandRules, roundLimit: 8 }, round: 8 },
    });
    s = skip(s).state;
    expect(s.winReason).toBe("roundLimit");
    expect(s.winnerId).toBe("a");
    expect(s.winnerIds).toEqual(["a"]);
  });

  const tied = (bArmies: number): GameState =>
    makeState({
      players: ["a", "b", "c"],
      active: "c",
      territories: {
        eisenfurt: ["a", 3],
        rabenhain: ["a", 2],
        grauwacht: ["b", 1],
        tannenfeld: ["b", bArmies],
        salzmoor: ["c", 1],
        dornental: ["c", 2],
      },
      fill: null,
      overrides: { rules: { ...testlandRules, roundLimit: 8 }, round: 8 },
    });

  it("a tie in points is decided by the armies in total", () => {
    const s = skip(tied(2)).state; // a 5, b 3, c 3
    expect(s.winnerId).toBe("a");
    expect(s.winnerIds).toEqual(["a"]);
  });

  it("level in points and armies: all of them win together, winnerId is the first in seat order", () => {
    const r = skip(tied(4)); // a 5, b 5, c 3
    expect(r.state.winnerId).toBe("a");
    expect(r.state.winnerIds).toEqual(["a", "b"]);
    expect(r.types.filter((t) => t === "gameWon")).toHaveLength(2);
  });

  it("the view carries scores only for a round-limit win, plus round and limit for everyone", () => {
    const running = limited({ round: 5 });
    expect(viewFor(running, "a")).toMatchObject({ round: 5, roundLimit: 8, scores: null });
    expect(viewFor(running, "a").winnerIds).toEqual([]);
    const done = skip({ ...limited({ round: 8 }), activePlayerId: "c" }).state;
    const v = viewFor(done, "b");
    expect(v.scores).toHaveLength(3);
    expect(v.winnerIds).toEqual(done.winnerIds);
    expect(v.winReason).toBe("roundLimit");
  });

  it("a player who was removed or is out is not in the score", () => {
    const s = makeState({
      players: ["a", "b", "c"],
      territories: { eisenfurt: ["a", 1], salzmoor: ["b", 1] },
      fill: "a",
    });
    expect(scoreboard(s).map((e) => e.playerId)).toEqual(["a", "b"]);
  });

  it("a normal win sets winnerIds to the winner", () => {
    const s = makeState({
      players: ["a", "b"],
      territories: { eisenfurt: ["a", 5] },
      fill: "b",
    });
    expect(s.winnerIds).toEqual([]);
  });
});

describe("round limit with a held mission (rules.md 11.2, question 53)", () => {
  const hold: Mission = { type: "holdTerritories", count: 2, minArmies: 1 };
  const last = (rulesHold: boolean): GameState =>
    withMissions(
      makeState({
        players: ["b", "a"],
        active: "a",
        territories: {
          eisenfurt: ["a", 1],
          rabenhain: ["a", 1],
          grauwacht: ["b", 1],
          tannenfeld: ["b", 1],
          salzmoor: ["b", 1],
          dornental: ["b", 1],
          kupferstadt: ["b", 1],
          nebelkueste: ["b", 1],
        },
        overrides: { rules: { ...testlandRules, roundLimit: 8, holdToWin: rulesHold }, round: 8 },
      }),
      { a: hold, b: null },
    );

  it("a met mission with a marker wins by mission before the score (b would win the score)", () => {
    const base = last(true);
    const s = { ...base, secret: { ...base.secret, victoryPending: { a: true, b: false } } };
    const r = skip(s).state;
    expect(r.winReason).toBe("mission");
    expect(r.winnerId).toBe("a");
  });

  it("the mission is checked again: no longer met means the score decides", () => {
    const base = last(true);
    const s = {
      ...base,
      territories: { ...base.territories, rabenhain: { ownerId: "b", armies: 1 } },
      secret: { ...base.secret, victoryPending: { a: true, b: false } },
    };
    // a holds only one territory now, so the mission (2) is no longer met
    const r = skip(s).state;
    expect(r.winReason).toBe("roundLimit");
    expect(r.winnerId).toBe("b");
  });

  it("with holdToWin the marker is set at the end of the last turn and counts; without the option the score decides", () => {
    const r = skip(last(true)).state;
    // endTurn sets the marker itself: the mission is met at the end of a's own turn
    expect(r.winReason).toBe("mission");
    const off = skip(last(false)).state;
    expect(off.winReason).toBe("roundLimit");
    expect(off.winnerId).toBe("b");
  });
});

describe("round limit in setup and in random games", () => {
  const make = (roundLimit: unknown, n = 3) =>
    createGame({
      map: testland,
      rules: { ...testlandRules, roundLimit: roundLimit as never },
      playerIds: ["a", "b", "c", "d"].slice(0, n),
      rng: createSeededRng(1),
    });

  it.each([[null], [8], [12], [16]])("accepts the round limit %j", (limit) => {
    const r = make(limit);
    if (!r.ok) throw new Error(r.code);
    expect(r.state.round).toBe(1);
    expect(r.state.winnerIds).toEqual([]);
    expect(r.state.rules.roundLimit).toBe(limit);
    expect(r.events.map((e) => e.type)).toEqual(["gameStarted", "roundStarted", "turnStarted"]);
  });

  it.each([[0], [7], [9], [10.5], ["8"], [undefined], [-1]])(
    "rejects the round limit %j with INVALID_RULES",
    (limit) => expect(make(limit)).toEqual({ ok: false, code: "INVALID_RULES" }),
  );

  it("random games with a limit of 8: the round only grows by 1, ends in a score and nothing happens after", () => {
    let scored = 0;
    for (let seed = 1; seed <= 30; seed++) {
      const { steps } = playRandomGame({
        seed,
        players: 3,
        rules: { ...testlandRules, victoryMode: "domination", roundLimit: 8 },
        aggression: 0.1,
        maxActions: 3000,
      });
      let round = 1;
      for (const step of steps) {
        const s = step.after;
        expect(s.round - round, `seed ${seed}`).toBeGreaterThanOrEqual(0);
        expect(s.round - round, `seed ${seed}`).toBeLessThanOrEqual(1);
        round = s.round;
        expect(s.round).toBeLessThanOrEqual(8);
        if (s.winReason === "roundLimit") {
          scored++;
          expect(s.round).toBe(8);
          expect(s.winnerIds).toContain(s.winnerId);
          const board = scoreboard(s);
          const top = Math.max(...board.map((e) => e.points));
          expect(
            board.filter((e) => s.winnerIds.includes(e.playerId)).every((e) => e.points === top),
          ).toBe(true);
        }
      }
    }
    expect(scored).toBeGreaterThan(0);
  });
});
