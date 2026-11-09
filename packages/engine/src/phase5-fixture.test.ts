import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  STATE_VERSION,
  applyAction,
  createSeededRng,
  getMap,
  getRules,
  migrateState,
  viewFor,
} from "./index.js";
import type { GameState, Rng } from "./index.js";

// Rows written by the real Phase-5 server (apps/server/fixtures/README.md); read here, never changed.
interface Fixture {
  schemaMetaVersion: number;
  rooms: {
    label: string;
    room: { status: string; map_id: string; state_json: unknown };
    players: { id: string }[];
  }[];
}
const fixture = JSON.parse(
  readFileSync(new URL("../../../apps/server/fixtures/phase5-rooms.json", import.meta.url), "utf8"),
) as Fixture;

const noRng: Rng = {
  int: () => {
    throw new Error("rng used");
  },
};

const withState = fixture.rooms.filter((r) => r.room.state_json !== null);
const states = (label: string): unknown =>
  JSON.parse(
    JSON.stringify(fixture.rooms.find((r) => r.label === label)!.room.state_json),
  ) as unknown;

describe("Phase-5 states from the real server (plan 007, step 0)", () => {
  it("has a lobby room, two running rooms and a finished one", () => {
    expect(fixture.schemaMetaVersion).toBe(2);
    expect(fixture.rooms.map((r) => [r.label, r.room.status, r.room.map_id])).toEqual([
      ["lobby", "lobby", "welt"],
      ["playing-3p-welt", "playing", "welt"],
      ["playing-2p-neutral", "playing", "testland"],
      ["finished", "finished", "testland"],
    ]);
    expect(fixture.rooms[0]!.room.state_json).toBeNull();
  });

  it.each(withState.map((r) => [r.label] as const))(
    "%s: is a version 4 state; loading migrates it to 7 without the Rng",
    (label) => {
      const raw = states(label) as Record<string, unknown>;
      expect(raw["stateVersion"]).toBe(4);
      expect(raw["removedPlayerIds"]).toBeUndefined();
      const loaded = migrateState(raw, noRng);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      expect(loaded.migrated).toBe(true);
      expect(loaded.state.stateVersion).toBe(STATE_VERSION);
      expect(loaded.state.removedPlayerIds).toEqual([]);
      expect(loaded.state.fortifyMovesDone).toBe(0);
      expect(loaded.state.rules.fortifyMoves).toBe(1);
      // everything else is as stored
      const {
        removedPlayerIds: _r,
        stateVersion: _v,
        fortifyMovesDone: _d,
        conquestsThisTurn: _c,
        rules,
        secret,
        ...rest
      } = loaded.state;
      const { fortifyMoves: _m, missionDraft: _md, holdToWin: _hw, ...rulesRest } = rules;
      const {
        missionOffer: _mo,
        missionOfferDealt: _mod,
        discardedMission: _dm,
        victoryPending: _vp,
        ...secretRest
      } = secret;
      const { stateVersion: _o, rules: rawRules, secret: rawSecret, ...restRaw } = raw;
      expect(rest).toEqual(restRaw);
      expect(secretRest).toEqual(rawSecret);
      expect(rulesRest).toEqual(rawRules);
      // a second load of the migrated state changes nothing
      const again = migrateState(JSON.parse(JSON.stringify(loaded.state)), noRng);
      expect(again.ok && again.migrated).toBe(false);
    },
  );

  it.each(withState.map((r) => [r.label] as const))(
    "%s: every player gets a view and the game goes on",
    (label) => {
      const loaded = migrateState(states(label), noRng);
      if (!loaded.ok) throw new Error(loaded.code);
      const state: GameState = loaded.state;
      const map = getMap(state.mapId)!;
      expect(Object.keys(state.territories).sort()).toEqual(
        map.territories.map((t) => t.id).sort(),
      );
      expect(getRules(state.mapId)).toEqual(state.rules);
      for (const p of state.playerOrder) {
        expect(viewFor(state, p).secret.mission).toEqual(state.secret.mission[p]);
      }
      if (label === "finished") {
        expect(state.winnerId).not.toBeNull();
        expect(
          applyAction(state, state.activePlayerId, { type: "endPhase" }, createSeededRng(1)),
        ).toEqual({ ok: false, code: "GAME_OVER" });
      } else {
        expect(state.phase).toBe("attack");
        const a = applyAction(
          state,
          state.activePlayerId,
          { type: "endPhase" },
          createSeededRng(1),
        );
        expect(a.ok && a.state.phase).toBe("fortify");
      }
    },
  );

  it("the 2-player room has the neutral owner, the 3-player room on welt has none", () => {
    const two = states("playing-2p-neutral") as GameState;
    expect(Object.values(two.territories).some((t) => t.ownerId === null)).toBe(true);
    const three = states("playing-3p-welt") as GameState;
    expect(three.mapId).toBe("welt");
    expect(three.playerOrder).toHaveLength(3);
    expect(Object.values(three.territories).some((t) => t.ownerId === null)).toBe(false);
  });
});
