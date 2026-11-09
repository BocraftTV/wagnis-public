import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STATE_VERSION, applyAction, createSeededRng, migrateState } from "./index.js";
import type { GameState, Rng } from "./index.js";

// Rows written by the real server before plan 011 (apps/server/fixtures/README.md); read here, never changed.
interface Fixture {
  schemaMetaVersion: number;
  rooms: { label: string; room: { status: string; state_json: unknown } }[];
}
const fixture = JSON.parse(
  readFileSync(new URL("../../../apps/server/fixtures/phase7-rooms.json", import.meta.url), "utf8"),
) as Fixture;

const noRng: Rng = {
  int: () => {
    throw new Error("rng used");
  },
};

const withState = fixture.rooms.filter((r) => r.room.state_json !== null);
const raw = (label: string): Record<string, unknown> =>
  JSON.parse(
    JSON.stringify(fixture.rooms.find((r) => r.label === label)!.room.state_json),
  ) as Record<string, unknown>;
const load = (label: string): GameState => {
  const r = migrateState(raw(label), noRng);
  if (!r.ok) throw new Error(r.code);
  return r.state;
};

describe("Phase-7 states from the real server (plan 011, step 0)", () => {
  it("has a lobby room, three running rooms and a finished one, all saved with schema 3", () => {
    expect(fixture.schemaMetaVersion).toBe(3);
    expect(fixture.rooms.map((r) => [r.label, r.room.status])).toEqual([
      ["lobby", "lobby"],
      ["playing-3p-welt-reinforce", "playing"],
      ["playing-2p-neutral-fortify", "playing"],
      ["playing-3p-attack-conquered", "playing"],
      ["finished", "finished"],
    ]);
    expect(fixture.rooms[0]!.room.state_json).toBeNull();
  });

  it.each(withState.map((r) => [r.label] as const))(
    "%s: is a version 5 state; loading migrates it to 8 without the Rng",
    (label) => {
      const stored = raw(label);
      expect(stored["stateVersion"]).toBe(5);
      expect(stored["fortifyMovesDone"]).toBeUndefined();
      expect((stored["rules"] as Record<string, unknown>)["fortifyMoves"]).toBeUndefined();
      const loaded = migrateState(stored, noRng);
      expect(loaded.ok && loaded.migrated).toBe(true);
      if (!loaded.ok) return;
      expect(loaded.state.stateVersion).toBe(STATE_VERSION);
      expect(loaded.state.rules.fortifyMoves).toBe(1);
      expect(loaded.state.fortifyMovesDone).toBe(0);
      // everything else is as stored
      const {
        stateVersion: _v,
        fortifyMovesDone: _d,
        conquestsThisTurn: _c,
        round: _rd,
        winnerIds: _wi,
        rules,
        secret,
        ...rest
      } = loaded.state;
      const {
        fortifyMoves: _m,
        missionDraft: _md,
        holdToWin: _hw,
        roundLimit: _rl,
        ...rulesRest
      } = rules;
      const {
        missionOffer: _mo,
        missionOfferDealt: _mod,
        discardedMission: _dm,
        victoryPending: _vp,
        ...secretRest
      } = secret;
      const { stateVersion: _o, rules: rawRules, secret: rawSecret, ...restRaw } = stored;
      expect(rest).toEqual(restRaw);
      expect(secretRest).toEqual(rawSecret);
      expect(rulesRest).toEqual(rawRules);
      const again = migrateState(JSON.parse(JSON.stringify(loaded.state)), noRng);
      expect(again.ok && again.migrated).toBe(false);
    },
  );

  it("the room in the fortify phase goes on with one move per turn", () => {
    const state = load("playing-2p-neutral-fortify");
    expect(state.phase).toBe("fortify");
    expect(state.fortifyMovesDone).toBe(0);
    const me = state.activePlayerId;
    const own = Object.entries(state.territories).filter(([, t]) => t.ownerId === me);
    const from = own.find(([, t]) => t.armies >= 2)![0];
    // the first legal move ends the turn (rules.md 5.3, setting 1); the legal target is found by trying
    const moved = own
      .filter(([id]) => id !== from)
      .map(([id]) =>
        applyAction(state, me, { type: "fortify", from, to: id, count: 1 }, createSeededRng(1)),
      )
      .find((r) => r.ok);
    expect(moved?.ok).toBe(true);
    if (!moved?.ok) return;
    expect(moved.state.activePlayerId).not.toBe(me);
    expect(moved.state.turn).toBe(state.turn + 1);
    expect(moved.state.phase).toBe("reinforce");
    expect(moved.state.fortifyMovesDone).toBe(0);
  });
});
