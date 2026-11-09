import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { STATE_VERSION, applyAction, createSeededRng, migrateState, viewFor } from "./index.js";
import type { GameState, Rng } from "./index.js";

// Rows written by the real server before plan 013 (apps/server/fixtures/README.md); read here, never changed.
interface Fixture {
  schemaMetaVersion: number;
  rooms: { label: string; room: { status: string; state_json: unknown } }[];
}
const fixture = JSON.parse(
  readFileSync(new URL("../../../apps/server/fixtures/phase8-rooms.json", import.meta.url), "utf8"),
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

describe("Phase-8 states from the real server (plan 013, step 4)", () => {
  it("has a lobby room, three running rooms and a finished one, all saved with schema 4", () => {
    expect(fixture.schemaMetaVersion).toBe(4);
    expect(fixture.rooms.map((r) => [r.label, r.room.status])).toEqual([
      ["lobby", "lobby"],
      ["playing-3p-welt-reinforce", "playing"],
      ["playing-2p-neutral-fortify", "playing"],
      ["playing-3p-attack-conquered", "playing"],
      ["finished", "finished"],
    ]);
  });

  it.each(withState.map((r) => [r.label] as const))(
    "%s: is a version 6 state; loading migrates it to 8 without the Rng and changes nothing else",
    (label) => {
      const stored = raw(label);
      expect(stored["stateVersion"]).toBe(6);
      expect(stored["conquestsThisTurn"]).toBeUndefined();
      expect(stored["secret"]).not.toHaveProperty("missionOffer");
      const loaded = migrateState(stored, noRng);
      expect(loaded.ok && loaded.migrated).toBe(true);
      if (!loaded.ok) return;
      const s = loaded.state;
      expect(s.stateVersion).toBe(STATE_VERSION);
      expect(s.conquestsThisTurn).toBe(s.conqueredThisTurn ? 1 : 0);
      expect(s.rules.missionDraft).toBe(false);
      expect(s.rules.holdToWin).toBe(false);
      const players = s.playerOrder;
      for (const p of players) {
        expect(s.secret.missionOffer[p]).toBeNull();
        expect(s.secret.missionOfferDealt[p]).toBeNull();
        expect(s.secret.discardedMission[p]).toBeNull();
        expect(s.secret.victoryPending[p]).toBe(false);
      }
      // everything else is as stored
      const {
        stateVersion: _v,
        conquestsThisTurn: _c,
        round: _rd,
        winnerIds: _wi,
        rules,
        secret,
        ...rest
      } = s;
      const { missionDraft: _md, holdToWin: _hw, roundLimit: _rl, ...rulesRest } = rules;
      const {
        missionOffer: _mo,
        missionOfferDealt: _mod,
        discardedMission: _dm,
        victoryPending: _vp,
        ...secretRest
      } = secret;
      const { stateVersion: _o, rules: rawRules, secret: rawSecret, ...restRaw } = stored;
      expect(rest).toEqual(restRaw);
      expect(rulesRest).toEqual(rawRules);
      expect(secretRest).toEqual(rawSecret);
      const again = migrateState(JSON.parse(JSON.stringify(s)), noRng);
      expect(again.ok && again.migrated).toBe(false);
    },
  );

  it("running games go on: the views are valid and an endPhase works for the active player", () => {
    for (const { label } of withState.filter((r) => r.room.status === "playing")) {
      const r = migrateState(raw(label), noRng);
      if (!r.ok) throw new Error(r.code);
      const state: GameState = r.state;
      const view = viewFor(state, state.activePlayerId);
      expect(view.conquestsThisTurn).toBe(state.conqueredThisTurn ? 1 : 0);
      if (state.phase === "reinforce" && state.reinforcementsLeft === 0) continue;
      const next = applyAction(
        state,
        state.activePlayerId,
        state.phase === "reinforce"
          ? {
              type: "placeArmies",
              territoryId: Object.entries(state.territories).find(
                ([, t]) => t.ownerId === state.activePlayerId,
              )![0],
              count: 1,
            }
          : { type: "endPhase" },
        createSeededRng(1),
      );
      expect(next.ok, label).toBe(true);
    }
  });
});
