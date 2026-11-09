import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  STATE_VERSION,
  applyAction,
  createSeededRng,
  getMap,
  getRules,
  migrateState,
  testlandRules,
  viewFor,
} from "./index.js";
import type { GameState, Rng } from "./index.js";

// Rows written by the real Phase-4 server (apps/server/fixtures/README.md); read here, never changed.
interface Fixture {
  rooms: {
    label: string;
    room: { status: string; state_json: unknown };
    players: { id: string }[];
  }[];
}
const fixture = JSON.parse(
  readFileSync(new URL("../../../apps/server/fixtures/phase4-rooms.json", import.meta.url), "utf8"),
) as Fixture;

const noRng: Rng = {
  int: () => {
    throw new Error("rng used");
  },
};

const playing = fixture.rooms.filter((r) => r.room.status === "playing");

describe("Phase-4 states from the real server", () => {
  it("has a lobby room and two running rooms", () => {
    expect(fixture.rooms.map((r) => r.label)).toEqual([
      "lobby",
      "playing-3p",
      "playing-2p-neutral",
    ]);
    expect(fixture.rooms[0]!.room.state_json).toBeNull();
  });

  it.each(playing.map((r) => [r.label, r] as const))(
    "%s: migrates 4 -> 5 on load and keeps accepting actions",
    (_label, r) => {
      const raw = JSON.parse(JSON.stringify(r.room.state_json)) as unknown;
      const loaded = migrateState(raw, noRng);
      expect(loaded.ok).toBe(true);
      if (!loaded.ok) return;
      // version 4 is no longer current: it goes through 4 -> 5 (plan 007)
      expect(loaded.migrated).toBe(true);
      const state: GameState = loaded.state;
      expect(state.stateVersion).toBe(STATE_VERSION);
      expect(state.removedPlayerIds).toEqual([]);
      expect(state.mapId).toBe("testland");
      // the old state carries its own rules, equal to what testland has today
      expect(state.rules).toEqual(testlandRules);
      expect(getRules(state.mapId)).toEqual(state.rules);
      const map = getMap(state.mapId)!;
      expect(Object.keys(state.territories).sort()).toEqual(
        map.territories.map((t) => t.id).sort(),
      );

      // every player gets a view; their own mission is in it
      for (const p of state.playerOrder) {
        const view = viewFor(state, p);
        expect(view.secret.mission).toEqual(state.secret.mission[p]);
      }
      // the active player in the attack phase ends it, then the turn goes on
      expect(state.phase).toBe("attack");
      const a = applyAction(state, state.activePlayerId, { type: "endPhase" }, createSeededRng(1));
      expect(a.ok).toBe(true);
      if (a.ok) expect(a.state.phase).toBe("fortify");
    },
  );

  it("the 2-player room still has the neutral owner", () => {
    const state = playing.find((r) => r.label === "playing-2p-neutral")!.room
      .state_json as GameState;
    expect(Object.values(state.territories).some((t) => t.ownerId === null)).toBe(true);
  });
});
