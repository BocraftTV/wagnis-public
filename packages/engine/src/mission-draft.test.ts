import { describe, expect, it } from "vitest";
import {
  applyAction,
  applyHostAction,
  createGame,
  createSeededRng,
  pendingChoosers,
  testland,
  testlandMissions,
  testlandRules,
  welt,
  weltRules,
} from "./index.js";
import type { Action, GameState, MapDefinition, Mission, RuleConfig } from "./index.js";
import { playRandomGame } from "./playbot.js";

const ids = ["p1", "p2", "p3", "p4", "p5", "p6"];
const draftRules: RuleConfig = { ...testlandRules, missionDraft: true };
const rng = (seed = 1) => createSeededRng(seed);

function start(n: number, seed: number, map: MapDefinition = testland, rules = draftRules) {
  const r = createGame({ map, rules, playerIds: ids.slice(0, n), rng: rng(seed) });
  if (!r.ok) throw new Error(r.code);
  return r;
}
const choose = (s: GameState, p: string, index: 0 | 1, seed = 9) => {
  const a: Action = { type: "chooseMission", index };
  return applyAction(s, p, a, rng(seed));
};
function chooseOk(s: GameState, p: string, index: 0 | 1): GameState {
  const r = choose(s, p, index);
  if (!r.ok) throw new Error(`unexpected ${r.code}`);
  return r.state;
}
const key = (m: Mission) => JSON.stringify(m);

describe("mission draft: dealing", () => {
  it("starts in missionChoice with no turn yet, one gameStarted event and nobody holding a mission", () => {
    const { state, events } = start(3, 1);
    expect(state.phase).toBe("missionChoice");
    expect(state.reinforcementsLeft).toBe(0);
    expect(events.map((e) => e.type)).toEqual(["gameStarted"]);
    expect(Object.values(state.secret.mission)).toEqual([null, null, null]);
    expect(pendingChoosers(state)).toEqual(["p1", "p2", "p3"]);
  });

  it.each([2, 3, 4, 5, 6])(
    "%i players: two different offers each, no mission twice in the game (seeds 1-60)",
    (n) => {
      for (let seed = 1; seed <= 60; seed++) {
        const { state } = start(n, seed, welt, { ...weltRules, missionDraft: true });
        const dealt = Object.values(state.secret.missionOfferDealt).flatMap((o) => o!);
        expect(dealt).toHaveLength(2 * n);
        expect(new Set(dealt.map(key)).size, `seed ${seed}`).toBe(2 * n);
        for (const p of ids.slice(0, n)) {
          const [a, b] = state.secret.missionOffer[p]!;
          expect(key(a)).not.toBe(key(b));
        }
      }
    },
  );

  it("is the same for the same seed", () => {
    expect(start(4, 7).state.secret.missionOffer).toEqual(start(4, 7).state.secret.missionOffer);
  });

  it("a self target is offered as the fallback; the dealt card stays as drawn", () => {
    let found = 0;
    for (let seed = 1; seed <= 80 && found < 3; seed++) {
      const { state } = start(3, seed);
      for (const p of ["p1", "p2", "p3"]) {
        const dealt = state.secret.missionOfferDealt[p]!;
        const offer = state.secret.missionOffer[p]!;
        dealt.forEach((m, i) => {
          if (m.type === "eliminatePlayer" && m.targetPlayerId === p) {
            expect(offer[i]).toEqual(testlandMissions.fallback);
            found++;
          } else {
            expect(offer[i]).toEqual(m);
          }
        });
      }
    }
    expect(found).toBeGreaterThan(0);
  });

  it("without the draft nothing changes: phase reinforce, missions dealt, no offers", () => {
    const r = createGame({
      map: testland,
      rules: testlandRules,
      playerIds: ["p1", "p2", "p3"],
      rng: rng(5),
    });
    if (!r.ok) throw new Error(r.code);
    expect(r.state.phase).toBe("reinforce");
    expect(Object.values(r.state.secret.missionOffer)).toEqual([null, null, null]);
    expect(Object.values(r.state.secret.mission).every((m) => m !== null)).toBe(true);
  });

  it("is ignored in domination (no missions, no offers)", () => {
    const r = createGame({
      map: testland,
      rules: { ...draftRules, victoryMode: "domination" },
      playerIds: ["p1", "p2"],
      rng: rng(1),
    });
    if (!r.ok) throw new Error(r.code);
    expect(r.state.phase).toBe("reinforce");
  });

  it("rejects a pool that is too small with INVALID_MISSIONS", () => {
    const small = {
      missions: testlandMissions.missions.slice(0, 2),
      fallback: testlandMissions.fallback,
    };
    const r = createGame({
      map: testland,
      rules: draftRules,
      playerIds: ["p1", "p2"],
      rng: rng(1),
      missions: small,
    });
    expect(r).toEqual({ ok: false, code: "INVALID_MISSIONS" });
  });

  it("every map pool is big enough for 6 players", () => {
    for (const [map, rules] of [
      [testland, draftRules],
      [welt, { ...weltRules, missionDraft: true }],
    ] as const) {
      expect(createGame({ map, rules, playerIds: ids, rng: rng(2) }).ok).toBe(true);
    }
  });
});

describe("mission draft: choosing", () => {
  const { state: s0 } = start(3, 1);

  it("the first turn only starts after the last choice; before that every other action is WRONG_PHASE", () => {
    const s1 = chooseOk(s0, "p2", 0);
    expect(s1.phase).toBe("missionChoice");
    const s2 = chooseOk(s1, "p3", 1);
    expect(s2.phase).toBe("missionChoice");
    for (const a of [
      { type: "endPhase" },
      { type: "placeArmies", territoryId: "eisenfurt", count: 1 },
    ] as Action[]) {
      for (const p of ["p1", "p2", "p3"]) {
        expect(applyAction(s2, p, a, rng())).toEqual({ ok: false, code: "WRONG_PHASE" });
      }
    }
    const r = choose(s2, "p1", 0);
    if (!r.ok) throw new Error(r.code);
    expect(r.state.phase).toBe("reinforce");
    expect(r.state.reinforcementsLeft).toBeGreaterThan(0);
    expect(r.state.turn).toBe(1);
    expect(r.events.map((e) => e.type)).toEqual([
      "missionChosen",
      "roundStarted",
      "phaseChanged",
      "turnStarted",
    ]);
  });

  it("the chosen card becomes the mission, the other the discarded one; the offers are gone", () => {
    const s1 = chooseOk(s0, "p1", 1);
    const dealt = s0.secret.missionOfferDealt["p1"]!;
    expect(s1.secret.mission["p1"]).toEqual(s0.secret.missionOffer["p1"]![1]);
    expect(s1.secret.originalMission["p1"]).toEqual(dealt[1]);
    expect(s1.secret.discardedMission["p1"]).toEqual(dealt[0]);
    expect(s1.secret.missionOffer["p1"]).toBeNull();
    expect(s1.secret.missionOfferDealt["p1"]).toBeNull();
    // nobody else is touched
    expect(s1.secret.missionOffer["p2"]).toEqual(s0.secret.missionOffer["p2"]);
  });

  it("works from any seat and in any order (not only the active player)", () => {
    const order = ["p3", "p1", "p2"];
    let s = s0;
    for (const p of order) s = chooseOk(s, p, 0);
    expect(s.phase).toBe("reinforce");
  });

  it("a second choice is ALREADY_CHOSEN, a bad index INVALID_CHOICE, a stranger UNKNOWN_PLAYER", () => {
    const s1 = chooseOk(s0, "p1", 0);
    expect(choose(s1, "p1", 1)).toEqual({ ok: false, code: "ALREADY_CHOSEN" });
    const bad = { type: "chooseMission", index: 2 } as unknown as Action;
    expect(applyAction(s0, "p2", bad, rng())).toEqual({ ok: false, code: "INVALID_CHOICE" });
    expect(applyAction(s0, "p2", { type: "chooseMission", index: 0.5 } as never, rng())).toEqual({
      ok: false,
      code: "INVALID_CHOICE",
    });
    expect(choose(s0, "nobody", 0)).toEqual({ ok: false, code: "UNKNOWN_PLAYER" });
  });

  it("outside missionChoice chooseMission is WRONG_PHASE", () => {
    let s = s0;
    for (const p of ["p1", "p2", "p3"]) s = chooseOk(s, p, 0);
    expect(choose(s, "p1", 0)).toEqual({ ok: false, code: "WRONG_PHASE" });
  });

  it("the input state is never changed", () => {
    const copy = JSON.stringify(s0);
    chooseOk(s0, "p1", 0);
    expect(JSON.stringify(s0)).toBe(copy);
  });

  it("choosing a replaced card keeps the self-target case readable from originalMission", () => {
    for (let seed = 1; seed <= 80; seed++) {
      const { state } = start(3, seed);
      const dealt = state.secret.missionOfferDealt["p1"]!;
      const i = dealt.findIndex((m) => m.type === "eliminatePlayer" && m.targetPlayerId === "p1");
      if (i < 0) continue;
      const s = chooseOk(state, "p1", i as 0 | 1);
      expect(s.secret.missionReplaced["p1"]).toBe(true);
      expect(s.secret.mission["p1"]).toEqual(testlandMissions.fallback);
      expect(s.secret.originalMission["p1"]).toEqual(dealt[i]);
      return;
    }
    throw new Error("no self target found");
  });
});

describe("mission draft: host", () => {
  const { state: s0 } = start(3, 3);

  it("skipTurn chooses at random for everybody still open, then the first turn starts", () => {
    const s1 = chooseOk(s0, "p2", 1);
    const r = applyHostAction(s1, { type: "skipTurn", turn: 1 }, rng(4));
    if (!r.ok) throw new Error(r.code);
    expect(r.state.phase).toBe("reinforce");
    expect(pendingChoosers(r.state)).toEqual([]);
    expect(r.state.secret.mission["p2"]).toEqual(s0.secret.missionOffer["p2"]![1]);
    for (const p of ["p1", "p3"]) {
      expect(s0.secret.missionOffer[p]).toContainEqual(r.state.secret.mission[p]);
      expect(r.state.secret.discardedMission[p]).not.toBeNull();
    }
    expect(r.events.filter((e) => e.type === "missionChosen")).toHaveLength(2);
    // same Rng, same outcome
    expect(applyHostAction(s1, { type: "skipTurn", turn: 1 }, rng(4))).toEqual(r);
  });

  it("removePlayer of the last open player starts the game; the offers of the removed lapse", () => {
    let s = chooseOk(s0, "p1", 0);
    s = chooseOk(s, "p2", 0);
    const r = applyHostAction(s, { type: "removePlayer", playerId: "p3" }, rng());
    if (!r.ok) throw new Error(r.code);
    expect(r.state.phase).toBe("reinforce");
    expect(r.state.secret.missionOffer["p3"]).toBeNull();
    expect(r.state.secret.missionOfferDealt["p3"]).toBeNull();
    expect(r.state.removedPlayerIds).toEqual(["p3"]);
    expect(r.state.activePlayerId).not.toBe("p3");
  });

  it("removePlayer of someone else while others are open keeps waiting; a card aimed at them becomes the fallback", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const { state } = start(3, seed);
      const aimed = ["p1", "p3"].find((q) =>
        state.secret.missionOffer[q]!.some(
          (m) => m.type === "eliminatePlayer" && m.targetPlayerId === "p2",
        ),
      );
      if (!aimed) continue;
      const r = applyHostAction(state, { type: "removePlayer", playerId: "p2" }, rng());
      if (!r.ok) throw new Error(r.code);
      expect(r.state.phase).toBe("missionChoice");
      expect(pendingChoosers(r.state).sort()).toEqual(["p1", "p3"]);
      const offer = r.state.secret.missionOffer[aimed]!;
      expect(offer.some((m) => m.type === "eliminatePlayer" && m.targetPlayerId === "p2")).toBe(
        false,
      );
      expect(offer).toContainEqual(testlandMissions.fallback);
      return;
    }
    throw new Error("no card aimed at p2 found");
  });

  it("removing the first player in missionChoice hands the first turn to the next one", () => {
    const first = s0.activePlayerId;
    let s = s0;
    for (const p of s0.playerOrder.filter((q) => q !== first)) s = chooseOk(s, p, 0);
    const r = applyHostAction(s, { type: "removePlayer", playerId: first }, rng());
    if (!r.ok) throw new Error(r.code);
    expect(r.state.phase).toBe("reinforce");
    expect(r.state.activePlayerId).not.toBe(first);
  });

  it("removing all but one ends the game in missionChoice (last player)", () => {
    const { state } = start(2, 1);
    const r = applyHostAction(state, { type: "removePlayer", playerId: "p2" }, rng());
    if (!r.ok) throw new Error(r.code);
    expect(r.state.winnerId).toBe("p1");
    expect(r.state.winReason).toBe("lastPlayer");
  });
});

describe("mission draft: random games keep every invariant", () => {
  it("plays through with the draft, offers always vanish and the first turn starts", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const n = 2 + (seed % 5);
      const { start: begin, steps } = playRandomGame({
        seed,
        players: n,
        rules: draftRules,
        maxActions: 200,
        hostRate: 0.02,
      });
      expect(begin.phase).toBe("missionChoice");
      let seenFirstTurn = false;
      for (const st of steps) {
        if (st.after.phase !== "missionChoice") seenFirstTurn = true;
        if (seenFirstTurn) {
          expect(pendingChoosers(st.after), `seed ${seed}`).toEqual([]);
        }
      }
      expect(seenFirstTurn, `seed ${seed}`).toBe(true);
    }
  });
});
