import { describe, expect, it } from "vitest";
import { applyHostAction, viewFor } from "./index.js";
import type { GameState, HostAction, Rng } from "./index.js";
import { scenarioS3, withCards } from "./testkit.js";

// Plan 007, section 6: `viewFor` after host actions (rules.md 7, 1.6).

const noRng: Rng = {
  int: () => {
    throw new Error("rng used");
  },
};
const remove = (playerId: string): HostAction => ({ type: "removePlayer", playerId });
function okHost(s: GameState, action: HostAction): GameState {
  const r = applyHostAction(s, action, noRng);
  if (!r.ok) throw new Error(`unexpected ${r.code}`);
  return r.state;
}
const ids = ["a", "b", "c"];

describe("viewFor with removed players", () => {
  const s3 = () => scenarioS3({ hands: { a: 2, b: 4, c: 0 }, discard: 1 });

  it("removedPlayerIds is the same for every viewer, in the order of removal, and is a copy", () => {
    const s = okHost(okHost(scenarioS3(), remove("c")), remove("b"));
    for (const p of ids) {
      const v = viewFor(s, p);
      expect(v.removedPlayerIds).toEqual(["c", "b"]);
      expect(v.removedPlayerIds).not.toBe(s.removedPlayerIds);
    }
    expect(viewFor(scenarioS3(), "a").removedPlayerIds).toEqual([]);
  });

  it("handCounts keeps a key for the removed player with 0; deck and discard counts are numbers only", () => {
    const s = okHost(s3(), remove("b"));
    const v = viewFor(s, "a");
    expect(v.handCounts).toEqual({ a: 2, b: 0, c: 0 });
    expect(v.deckCount).toBe(3);
    expect(v.discardCount).toBe(5);
    expect(v.playerOrder).toEqual(ids);
  });

  it("viewFor(state, removedId) carries no secrets, even if the state still held some for him", () => {
    const s = okHost(s3(), remove("b"));
    const dirty = withCards(
      {
        ...s,
        secret: {
          ...s.secret,
          mission: { ...s.secret.mission, b: { type: "holdTerritories", count: 1, minArmies: 1 } },
        },
      },
      { hand: { b: ["card-eisenfurt"] } },
    );
    expect(viewFor(dirty, "b").secret).toEqual({
      mission: null,
      missionReplaced: false,
      hand: [],
      allyHands: {},
      suggestedSets: [],
      mustTrade: false,
      missionOffer: null,
      victoryPending: false,
      missionProgress: null,
    });
  });

  it("no view contains the discard pile: cards that are only on the pile appear in no message", () => {
    const s0 = s3();
    const s = okHost(s0, remove("b"));
    const inHands = new Set(Object.values(s.secret.hand).flat());
    const onlyOnPile = s.secret.discard.filter((id) => !inHands.has(id));
    expect(onlyOnPile.length).toBe(5);
    for (const p of ids) {
      const wire = JSON.stringify(viewFor(s, p));
      for (const id of onlyOnPile) expect(wire, `${p} sees ${id}`).not.toContain(`"${id}"`);
      for (const id of s.secret.deck) expect(wire).not.toContain(`"${id}"`);
    }
  });

  it("the replacement of a mission aimed at the removed player shows in no other view, and there is no new key", () => {
    const s0 = s3();
    const s = okHost(s0, remove("b"));
    // a's own view shows the replacement; the others' views do not change at all because of a's mission
    expect(viewFor(s, "a").secret.mission).toEqual({
      type: "holdTerritories",
      count: 6,
      minArmies: 2,
    });
    expect(viewFor(s, "a").secret.missionReplaced).toBe(true);
    for (const p of ["b", "c"]) {
      const wire = JSON.stringify(viewFor(s, p));
      expect(wire).not.toContain("eliminatePlayer");
      expect(wire).not.toContain("originalMission");
      expect(wire).not.toContain("stateVersion");
      expect(viewFor(s, p).missions).toBeNull();
    }
    // the same board with a different mission for a (not aimed at b) gives byte-identical views for b and c,
    // except for what the removal itself changes: nothing depends on a's mission
    const other = scenarioS3({
      hands: { a: 2, b: 4, c: 0 },
      discard: 1,
      missions: {
        a: { type: "holdTerritories", count: 5, minArmies: 2 },
        b: { type: "holdTerritories", count: 5, minArmies: 2 },
        c: { type: "holdTerritories", count: 4, minArmies: 3 },
      },
    });
    const t = okHost(other, remove("b"));
    for (const p of ["c"]) {
      expect(JSON.stringify(viewFor(s, p))).toBe(JSON.stringify(viewFor(t, p)));
    }
  });

  it("the resolution after a last-player win leaves out the removed players and keeps originals aimed at them", () => {
    const s = okHost(okHost(s3(), remove("c")), remove("b"));
    expect(s.winnerId).toBe("a");
    expect(s.winReason).toBe("lastPlayer");
    for (const p of ids) {
      const v = viewFor(s, p);
      expect(Object.keys(v.missions!)).toEqual(["a"]);
      expect(v.missions!["a"]).toEqual({
        mission: { type: "holdTerritories", count: 6, minArmies: 2 },
        originalMission: { type: "eliminatePlayer", targetPlayerId: "b" },
        discarded: null,
      });
      expect(v.removedPlayerIds).toEqual(["c", "b"]);
      expect(v.winnerId).toBe("a");
    }
  });

  it("without missions (domination) the resolution stays null", () => {
    const s = okHost(
      okHost(
        scenarioS3({
          overrides: { rules: { ...scenarioS3().rules, victoryMode: "domination" } },
          missions: { a: null, b: null, c: null },
        }),
        remove("c"),
      ),
      remove("b"),
    );
    expect(s.winnerId).toBe("a");
    expect(viewFor(s, "a").missions).toBeNull();
  });
});
