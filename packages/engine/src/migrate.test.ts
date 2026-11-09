import { describe, expect, it } from "vitest";
import {
  STATE_VERSION,
  createGame,
  createSeededRng,
  migrate3to4,
  migrate4to5,
  migrate6to7,
  migrate7to8,
  migrate8to9,
  migrate5to6,
  migrateState,
  normalizeState,
  testland,
  testlandRules,
} from "./index.js";
import type { GameState, GameStateV3, Rng } from "./index.js";
import { makeState } from "./testkit.js";

const noRng: Rng = {
  int: () => {
    throw new Error("rng used");
  },
};

function fresh(players = ["a", "b", "c"]): GameState {
  const r = createGame({
    map: testland,
    rules: testlandRules,
    playerIds: players,
    rng: createSeededRng(1),
  });
  if (!r.ok) throw new Error(r.code);
  return r.state;
}

/** Strips what plan 011 added: a state as phase 6a stored it (version 5). */
function phase6a(s: GameState): Record<string, any> {
  const legacy = JSON.parse(JSON.stringify(s)) as Record<string, any>;
  delete legacy["fortifyMovesDone"];
  delete legacy["rules"].fortifyMoves;
  delete legacy["conquestsThisTurn"];
  delete legacy["rules"].missionDraft;
  delete legacy["rules"].holdToWin;
  delete legacy["secret"].missionOffer;
  delete legacy["secret"].missionOfferDealt;
  delete legacy["secret"].discardedMission;
  delete legacy["secret"].victoryPending;
  delete legacy["round"];
  delete legacy["winnerIds"];
  delete legacy["rules"].roundLimit;
  delete legacy["worldEvent"];
  delete legacy["rules"].worldEvents;
  delete legacy["secret"].eventDeck;
  legacy["stateVersion"] = 5;
  return legacy;
}

/** Strips what phase 6a added: a state as phases 4 and 5 stored it (version 4). */
function phase4(s: GameState): Record<string, any> {
  const legacy = phase6a(s);
  delete legacy["removedPlayerIds"];
  legacy["stateVersion"] = 4;
  return legacy;
}

/** Strips everything phase 4 added: a state in the phase 3 format. */
function phase3(s: GameState): Record<string, any> {
  const legacy = phase4(s);
  delete legacy["stateVersion"];
  delete legacy["winReason"];
  delete legacy["rules"].victoryMode;
  delete legacy["secret"].originalMission;
  delete legacy["secret"].missionReplaced;
  return legacy;
}

/** Strips the phase 3 fields too: a state as phase 2 saved it. */
function phase2(s: GameState): Record<string, any> {
  const legacy = phase3(s);
  delete legacy["lastTrade"];
  delete legacy["tradeSeq"];
  delete legacy["rules"].fortifyReach;
  delete legacy["rules"].cards;
  delete legacy["secret"].deck;
  delete legacy["secret"].discard;
  return legacy;
}

describe("migrateState", () => {
  it("STATE_VERSION is 9", () => expect(STATE_VERSION).toBe(9));

  it("turns an unversioned phase 3 state into version 9 as domination", () => {
    const old = phase3(fresh());
    const r = migrateState(old, noRng);
    if (!r.ok) throw new Error(r.code);
    expect(r.migrated).toBe(true);
    expect(r.state.stateVersion).toBe(9);
    expect(r.state.removedPlayerIds).toEqual([]);
    expect(r.state.rules.fortifyMoves).toBe(1);
    expect(r.state.fortifyMovesDone).toBe(0);
    expect(r.state.rules.victoryMode).toBe("domination");
    expect(r.state.winReason).toBeNull();
    expect(r.state.secret.mission).toEqual({ a: null, b: null, c: null });
    expect(r.state.secret.originalMission).toEqual({ a: null, b: null, c: null });
    expect(r.state.secret.missionReplaced).toEqual({ a: false, b: false, c: false });
    // everything else is as it was
    const {
      stateVersion: _v,
      winReason: _w,
      removedPlayerIds: _p,
      fortifyMovesDone: _f,
      conquestsThisTurn: _c,
      round: _rd,
      winnerIds: _wi,
      worldEvent: _we,
      ...rest
    } = r.state;
    const { rules: _r, secret: _s, ...restOld } = old;
    expect(rest).toMatchObject(restOld);
    expect(r.state.secret.deck).toEqual(old["secret"].deck);
  });

  it("a finished phase 3 game gets winReason lastPlayer, a running one null", () => {
    const done = { ...phase3(fresh()), winnerId: "b" };
    const r = migrateState(done, noRng);
    expect(r.ok && r.state.winReason).toBe("lastPlayer");
    const running = migrateState(phase3(fresh()), noRng);
    expect(running.ok && running.state.winReason).toBeNull();
  });

  it("an unversioned phase 2 state goes through normalizeState (-> 3), then 3 -> 4, 4 -> 5, 5 -> 6, 6 -> 7, 7 -> 8 and 8 -> 9", () => {
    const old = phase2(fresh());
    const r = migrateState(old, createSeededRng(2));
    if (!r.ok) throw new Error(r.code);
    expect(r.migrated).toBe(true);
    expect(r.state.stateVersion).toBe(9);
    expect(r.state.rules.victoryMode).toBe("domination");
    expect(r.state.rules.fortifyMoves).toBe(1);
    expect(r.state.secret.deck).toHaveLength(10);
    expect(r.state.rules.cards.mustTradeAt).toBe(5);
    expect(r.state.rules.fortifyReach).toBe("connected");
  });

  it("each step on its own: unversioned -> 3 (normalizeState) and every later step", () => {
    const v3 = normalizeState(phase2(fresh()) as never, createSeededRng(3));
    expect((v3 as unknown as Record<string, unknown>)["stateVersion"]).toBeUndefined();
    expect(v3.secret.deck).toHaveLength(10);
    const v4 = migrate3to4(v3);
    expect(v4.stateVersion).toBe(4);
    expect(v4.rules.victoryMode).toBe("domination");
    // explicit version 3 skips the first step and uses no Rng
    const explicit = migrateState({ ...v3, stateVersion: 3 }, noRng);
    expect(explicit.ok && explicit.migrated).toBe(true);
    expect(explicit.ok && explicit.state.stateVersion).toBe(9);
  });

  it("4 -> 5 adds removedPlayerIds: [] and nothing else, without the Rng and without touching the input", () => {
    const v4 = phase4(fresh());
    const copy = structuredClone(v4);
    const r = migrateState(v4, noRng);
    if (!r.ok) throw new Error(r.code);
    expect(r.migrated).toBe(true);
    expect(v4).toEqual(copy);
    expect(r.state.stateVersion).toBe(9);
    expect(r.state.removedPlayerIds).toEqual([]);
    expect(r.state.fortifyMovesDone).toBe(0);
    expect(r.state.rules.fortifyMoves).toBe(1);
    // the step on its own
    const direct = migrate4to5(copy as never);
    expect(direct).toEqual({ ...copy, removedPlayerIds: [], stateVersion: 5 });
    expect(migrate8to9(migrate7to8(migrate6to7(migrate5to6(direct))))).toEqual(r.state);
  });

  it("5 -> 6 sets fortifyMoves 1 and fortifyMovesDone 0 and nothing else, without the Rng and without touching the input", () => {
    const v5 = { ...phase6a(fresh()), removedPlayerIds: ["b"] };
    const copy: Record<string, any> = structuredClone(v5);
    const r = migrateState(v5, noRng);
    if (!r.ok) throw new Error(r.code);
    expect(r.migrated).toBe(true);
    expect(v5).toEqual(copy);
    expect(r.state.stateVersion).toBe(9);
    expect(r.state.rules.fortifyMoves).toBe(1);
    expect(r.state.fortifyMovesDone).toBe(0);
    expect(r.state.removedPlayerIds).toEqual(["b"]);
    const {
      fortifyMovesDone: _d,
      stateVersion: _s,
      rules,
      secret,
      conquestsThisTurn: _c,
      round: _rd,
      winnerIds: _wi,
      worldEvent: _we,
      ...rest
    } = r.state;
    const {
      fortifyMoves: _m,
      missionDraft: _md,
      holdToWin: _hw,
      roundLimit: _rl,
      worldEvents: _wev,
      ...rulesRest
    } = rules;
    const {
      missionOffer: _mo,
      missionOfferDealt: _mod,
      discardedMission: _dm,
      victoryPending: _vp,
      eventDeck: _ed,
      ...secretRest
    } = secret;
    const { stateVersion: _o, rules: oldRules, secret: oldSecret, ...restOld } = copy;
    expect(rest).toEqual(restOld);
    expect(rulesRest).toEqual(oldRules);
    expect(secretRest).toEqual(oldSecret);
    expect(migrate8to9(migrate7to8(migrate6to7(migrate5to6(copy as never))))).toEqual(r.state);
  });

  it("6 -> 7 adds the plan 013 fields with their old values and nothing else, without the Rng", () => {
    const base = { ...fresh(), conqueredThisTurn: true, conquestsThisTurn: 1 };
    const v6: Record<string, any> = JSON.parse(JSON.stringify(base));
    delete v6["conquestsThisTurn"];
    delete v6["rules"].missionDraft;
    delete v6["rules"].holdToWin;
    delete v6["secret"].missionOffer;
    delete v6["secret"].missionOfferDealt;
    delete v6["secret"].discardedMission;
    delete v6["secret"].victoryPending;
    delete v6["round"];
    delete v6["winnerIds"];
    delete v6["rules"].roundLimit;
    delete v6["worldEvent"];
    delete v6["rules"].worldEvents;
    delete v6["secret"].eventDeck;
    v6["stateVersion"] = 6;
    const copy = structuredClone(v6);
    const r = migrateState(v6, noRng);
    if (!r.ok) throw new Error(r.code);
    expect(r.migrated).toBe(true);
    expect(v6).toEqual(copy);
    expect(r.state.stateVersion).toBe(9);
    expect(r.state.conquestsThisTurn).toBe(1);
    expect(r.state.rules.missionDraft).toBe(false);
    expect(r.state.rules.holdToWin).toBe(false);
    expect(r.state.secret.missionOffer).toEqual({ a: null, b: null, c: null });
    expect(r.state.secret.missionOfferDealt).toEqual({ a: null, b: null, c: null });
    expect(r.state.secret.discardedMission).toEqual({ a: null, b: null, c: null });
    expect(r.state.secret.victoryPending).toEqual({ a: false, b: false, c: false });
    expect(r.state).toEqual({ ...base, round: 1 });
    expect(migrateState({ ...v6, conqueredThisTurn: false }, noRng)).toMatchObject({
      state: { conquestsThisTurn: 0 },
    });
  });

  it("7 -> 8 sets no round limit, round from turn and players, winnerIds from winnerId; no Rng, input untouched", () => {
    const base = { ...fresh(), turn: 8, round: 3 };
    const v7: Record<string, any> = JSON.parse(JSON.stringify(base));
    delete v7["round"];
    delete v7["winnerIds"];
    delete v7["rules"].roundLimit;
    delete v7["worldEvent"];
    delete v7["rules"].worldEvents;
    delete v7["secret"].eventDeck;
    v7["stateVersion"] = 7;
    const copy = structuredClone(v7);
    const r = migrateState(v7, noRng);
    if (!r.ok) throw new Error(r.code);
    expect(r.migrated).toBe(true);
    expect(v7).toEqual(copy);
    expect(r.state.stateVersion).toBe(9);
    expect(r.state.rules.roundLimit).toBeNull();
    // ceil(8 / 3 players) = 3
    expect(r.state.round).toBe(3);
    expect(r.state.winnerIds).toEqual([]);
    expect(r.state).toEqual(base);
    expect(migrate8to9(migrate7to8(copy as never))).toEqual(r.state);
    // a finished game keeps its winner in winnerIds
    const done = migrateState({ ...v7, winnerId: "b", winReason: "lastPlayer" }, noRng);
    expect(done.ok && done.state.winnerIds).toEqual(["b"]);
  });

  it("8 -> 9 sets no world events, no event in force and an empty event deck; no Rng, input untouched", () => {
    const base = fresh();
    const v8: Record<string, any> = JSON.parse(JSON.stringify(base));
    delete v8["worldEvent"];
    delete v8["rules"].worldEvents;
    delete v8["secret"].eventDeck;
    v8["stateVersion"] = 8;
    const copy = structuredClone(v8);
    const r = migrateState(v8, noRng);
    if (!r.ok) throw new Error(r.code);
    expect(r.migrated).toBe(true);
    expect(v8).toEqual(copy);
    expect(r.state.stateVersion).toBe(9);
    expect(r.state.rules.worldEvents).toBe(false);
    expect(r.state.worldEvent).toBeNull();
    expect(r.state.secret.eventDeck).toEqual([]);
    expect(r.state).toEqual(base);
    expect(migrate8to9(copy as never)).toEqual(r.state);
  });

  it("a version 9 state is returned as it is, even with removed players, and not migrated", () => {
    const s = { ...fresh(), removedPlayerIds: ["b"] };
    const r = migrateState(s, noRng);
    expect(r).toEqual({ ok: true, state: s, migrated: false });
  });

  it("a 2-player old state stays without a neutral owner", () => {
    // phase 3 had no neutral owner: two players, every territory owned by one of them
    const old = phase3(makeState({ territories: { eisenfurt: ["a", 4] }, players: ["a", "b"] }));
    for (const t of Object.values(old["territories"] as Record<string, any>)) {
      expect(t.ownerId).not.toBeNull();
    }
    const r = migrateState(old, noRng);
    if (!r.ok) throw new Error(r.code);
    expect(Object.values(r.state.territories).every((t) => t.ownerId !== null)).toBe(true);
    expect(r.state.playerOrder).toHaveLength(2);
  });

  it("a state at the current version is returned unchanged, not migrated, without the Rng", () => {
    const s = fresh();
    const copy = structuredClone(s);
    const r = migrateState(s, noRng);
    expect(r).toEqual({ ok: true, state: copy, migrated: false });
    expect(s).toEqual(copy);
  });

  it("an older state is migrated without changing the input", () => {
    const old = phase3(fresh());
    const copy = structuredClone(old);
    migrateState(old, noRng);
    expect(old).toEqual(copy);
  });

  it("a version 9 state keeps fortifyMoves 2 and a counter of 1 and is not migrated", () => {
    const s = fresh();
    const two = {
      ...s,
      rules: { ...s.rules, fortifyMoves: 2 as const },
      phase: "fortify" as const,
      fortifyMovesDone: 1,
    };
    expect(migrateState(two, noRng)).toEqual({ ok: true, state: two, migrated: false });
  });

  it("a newer version is STATE_VERSION_UNSUPPORTED and the input stays untouched", () => {
    const s = { ...fresh(), stateVersion: 10 };
    const copy = structuredClone(s);
    expect(migrateState(s, noRng)).toEqual({ ok: false, code: "STATE_VERSION_UNSUPPORTED" });
    expect(s).toEqual(copy);
    expect(migrateState({ ...s, stateVersion: 1e9 }, noRng)).toEqual({
      ok: false,
      code: "STATE_VERSION_UNSUPPORTED",
    });
  });

  it.each([["4"], [-1], [3.5], [2], [0], [null], [Number.NaN], [true], [{}]])(
    "an invalid stateVersion %j is STATE_VERSION_INVALID, the input stays untouched",
    (value) => {
      const s = { ...fresh(), stateVersion: value } as unknown as Record<string, unknown>;
      const copy = structuredClone(s);
      expect(migrateState(s, noRng)).toEqual({ ok: false, code: "STATE_VERSION_INVALID" });
      expect(s).toEqual(copy);
    },
  );

  it.each([[null], [undefined], ["state"], [[]], [7]])("rejects the non-object %j", (value) => {
    expect(migrateState(value, noRng)).toEqual({ ok: false, code: "STATE_VERSION_INVALID" });
  });

  it("normalizeState is still idempotent for a complete phase 3 state and uses no Rng", () => {
    const v3 = phase3(fresh()) as unknown as GameStateV3;
    expect(normalizeState(v3 as never, noRng)).toEqual(v3);
  });
});
