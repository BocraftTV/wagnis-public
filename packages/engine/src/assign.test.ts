import { describe, expect, it } from "vitest";
import {
  missionSatisfied,
  createGame,
  createSeededRng,
  testland,
  testlandMissions,
  testlandRules,
} from "./index.js";
import type { GameState, Mission, MissionSet, RuleConfig } from "./index.js";

const ids = ["p1", "p2", "p3", "p4", "p5", "p6"];

function start(n: number, seed: number, rules: RuleConfig = testlandRules, missions?: MissionSet) {
  const r = createGame({
    map: testland,
    rules,
    playerIds: ids.slice(0, n),
    rng: createSeededRng(seed),
    missions,
  });
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
const key = (m: Mission) => JSON.stringify(m);
const selfTarget = (m: Mission | null, p: string) =>
  m?.type === "eliminatePlayer" && m.targetPlayerId === p;

describe("mission deal", () => {
  it.each([2, 3, 4, 5, 6])(
    "%i players: exactly one mission each, none dealt twice (seeds 1-100)",
    (n) => {
      for (let seed = 1; seed <= 100; seed++) {
        const s = start(n, seed);
        const players = ids.slice(0, n);
        expect(Object.keys(s.secret.mission).sort()).toEqual(players);
        const dealt = players.map((p) => s.secret.originalMission[p]!);
        expect(dealt.every((m) => m !== null)).toBe(true);
        expect(new Set(dealt.map(key)).size, `seed ${seed}`).toBe(n);
        for (const p of players) {
          expect(s.secret.mission[p]).not.toBeNull();
          // the current mission is the dealt one, or the fallback after a self target
          const replaced = s.secret.missionReplaced[p]!;
          expect(replaced).toBe(selfTarget(s.secret.originalMission[p]!, p));
          expect(key(s.secret.mission[p]!)).toBe(
            key(replaced ? testlandMissions.fallback : s.secret.originalMission[p]!),
          );
        }
      }
    },
  );

  it("the same seed gives the same deal, another seed another one", () => {
    expect(start(4, 9).secret).toEqual(start(4, 9).secret);
    const all = new Set(
      Array.from({ length: 30 }, (_, i) => key(start(4, i + 1).secret.mission["p1"]!)),
    );
    expect(all.size).toBeGreaterThan(1);
  });

  it("2 players: no eliminatePlayer mission, original or current (seeds 1-200)", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const s = start(2, seed);
      for (const p of ["p1", "p2"]) {
        expect(s.secret.originalMission[p]!.type).not.toBe("eliminatePlayer");
        expect(s.secret.mission[p]!.type).not.toBe("eliminatePlayer");
        expect(s.secret.missionReplaced[p]).toBe(false);
      }
    }
  });

  it("self target (3 players, seed 14): p2 draws the mission against p2 and gets the fallback", () => {
    const s = start(3, 14);
    expect(s.secret.originalMission["p2"]).toEqual({
      type: "eliminatePlayer",
      targetPlayerId: "p2",
    });
    expect(s.secret.mission["p2"]).toEqual(testlandMissions.fallback);
    expect(s.secret.missionReplaced).toEqual({ p1: false, p2: true, p3: false });
    // nobody else was touched
    expect(s.secret.mission["p1"]).toEqual(s.secret.originalMission["p1"]);
    expect(s.secret.mission["p3"]).toEqual(s.secret.originalMission["p3"]);
  });

  it("self target for two players at once (seed 57): both get the fallback, which may be shared", () => {
    const s = start(3, 57);
    expect(s.secret.missionReplaced).toEqual({ p1: false, p2: true, p3: true });
    expect(s.secret.mission["p2"]).toEqual(testlandMissions.fallback);
    expect(s.secret.mission["p3"]).toEqual(testlandMissions.fallback);
    expect(s.secret.originalMission["p2"]).toEqual({
      type: "eliminatePlayer",
      targetPlayerId: "p2",
    });
    expect(s.secret.originalMission["p3"]).toEqual({
      type: "eliminatePlayer",
      targetPlayerId: "p3",
    });
  });

  it("originalMission and mission do not share objects with the map list or each other", () => {
    const s = start(3, 1);
    expect(s.secret.missionReplaced).toEqual({ p1: false, p2: false, p3: false });
    const m = s.secret.mission["p1"]!;
    expect(s.secret.originalMission["p1"]).toEqual(m);
    expect(s.secret.originalMission["p1"]).not.toBe(m);
    for (const list of testlandMissions.missions) expect(list).not.toBe(m);
    expect(s.secret.mission["p2"]).not.toBe(testlandMissions.fallback);
  });

  it("domination deals nothing: mission and originalMission are null, nothing replaced", () => {
    const s = start(3, 1, { ...testlandRules, victoryMode: "domination" });
    expect(s.secret.mission).toEqual({ p1: null, p2: null, p3: null });
    expect(s.secret.originalMission).toEqual({ p1: null, p2: null, p3: null });
    expect(s.secret.missionReplaced).toEqual({ p1: false, p2: false, p3: false });
    expect(s.rules.victoryMode).toBe("domination");
  });

  it("missions are shuffled last: the board, start player and deck equal the domination game of the same seed", () => {
    for (const n of [3, 4, 6]) {
      for (let seed = 1; seed <= 10; seed++) {
        const a: GameState = start(n, seed);
        const b: GameState = start(n, seed, { ...testlandRules, victoryMode: "domination" });
        expect(a.territories).toEqual(b.territories);
        expect(a.playerOrder).toEqual(b.playerOrder);
        expect(a.secret.deck).toEqual(b.secret.deck);
      }
    }
  });

  it("an invalid or missing mission list gives INVALID_MISSIONS; domination does not need one", () => {
    const base = {
      map: testland,
      rules: testlandRules,
      playerIds: ["a", "b", "c"],
      rng: createSeededRng(1),
    };
    expect(createGame({ ...base, missions: { ...testlandMissions, missions: [] } })).toEqual({
      ok: false,
      code: "INVALID_MISSIONS",
    });
    const unknownMap = { ...testland, id: "elsewhere" };
    expect(createGame({ ...base, map: unknownMap })).toEqual({
      ok: false,
      code: "INVALID_MISSIONS",
    });
    expect(
      createGame({
        ...base,
        map: unknownMap,
        rules: { ...testlandRules, victoryMode: "domination" },
      }).ok,
    ).toBe(true);
    expect(createGame({ ...base, missions: testlandMissions }).ok).toBe(true);
  });

  it("no game is won at the start and no mission is met (seeds 1-200, 2-6 players)", () => {
    for (const n of [2, 3, 4, 5, 6]) {
      for (let seed = 1; seed <= 200; seed++) {
        const s = start(n, seed);
        expect(s.winnerId).toBeNull();
        for (const p of s.playerOrder)
          expect(missionSatisfied(s, testland, p), `seed ${seed} ${p}`).toBe(false);
      }
    }
  });

  it("the start-of-turn check runs in createGame: a mission already met by the first player wins at once", () => {
    // Not possible with testland's list; a custom list whose missions every start position meets
    const easy: MissionSet = {
      missions: [
        { type: "holdTerritories", count: 1, minArmies: 1 },
        { type: "holdTerritories", count: 2, minArmies: 1 },
      ],
      fallback: { type: "holdTerritories", count: 1, minArmies: 1 },
    };
    const r = createGame({
      map: testland,
      rules: testlandRules,
      playerIds: ["p1", "p2"],
      rng: createSeededRng(4),
      missions: easy,
    });
    if (!r.ok) throw new Error(r.code);
    expect(r.state.winnerId).toBe(r.state.activePlayerId);
    expect(r.state.winReason).toBe("mission");
    expect(r.events.at(-1)).toEqual({
      type: "gameWon",
      playerId: r.state.activePlayerId,
      reason: "mission",
    });
    // the other player's mission is met too, but nobody wins in another player's turn
    expect(r.events.filter((e) => e.type === "gameWon")).toHaveLength(1);
  });
});
