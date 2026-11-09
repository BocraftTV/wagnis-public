import { describe, expect, it } from "vitest";
import {
  applyAction,
  createDiceRng,
  createGame,
  createSeededRng,
  testland,
  testlandRules,
  viewFor,
} from "./index.js";
import type { Action, GameState, Mission } from "./index.js";
import { makeState, withCards, withMissions } from "./testkit.js";

const MARK_TARGET = "ZIELSPIELER-GEHEIM-7c1e";
const MARK_CONT = "KONTINENT-GEHEIM-33ab";
const kill = (targetPlayerId: string): Mission => ({ type: "eliminatePlayer", targetPlayerId });
const hold = (count: number, minArmies: number): Mission => ({
  type: "holdTerritories",
  count,
  minArmies,
});
const attack = (from: string, to: string, dice: number): Action => ({
  type: "attack",
  from,
  to,
  dice,
});

function ok(s: GameState, action: Action, faces: number[] = []) {
  const r = applyAction(s, s.activePlayerId, action, createDiceRng(faces));
  if (!r.ok) throw new Error(r.code);
  return r;
}
/** Every key of every object in a JSON string, to look for forbidden names without false hits from values. */
const keysOf = (value: unknown): Set<string> => {
  const out = new Set<string>();
  const walk = (v: unknown): void => {
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") {
      for (const [k, x] of Object.entries(v)) {
        out.add(k);
        walk(x);
      }
    }
  };
  walk(value);
  return out;
};

/** a active (eisenfurt 5 vs b's last territory rabenhain), c holds the rest. */
const board = (missions: Record<string, Mission | null>) =>
  withMissions(
    makeState({
      players: ["a", "b", "c"],
      territories: { eisenfurt: ["a", 5], rabenhain: ["b", 1] },
      fill: "c",
    }),
    missions,
  );

describe("viewFor: missions are secret", () => {
  const s = board({
    a: hold(6, 3),
    b: kill(MARK_TARGET),
    c: { type: "conquerContinents", continentIds: [MARK_CONT], extraContinents: 0 },
  });

  it("the owner sees mission and missionReplaced, others never see them (markers, JSON-wide)", () => {
    expect(viewFor(s, "b").secret.mission).toEqual(kill(MARK_TARGET));
    expect(viewFor(s, "b").secret.missionReplaced).toBe(false);
    expect(JSON.stringify(viewFor(s, "a"))).not.toContain(MARK_TARGET);
    expect(JSON.stringify(viewFor(s, "a"))).not.toContain(MARK_CONT);
    expect(JSON.stringify(viewFor(s, "c"))).not.toContain(MARK_TARGET);
    expect(JSON.stringify(viewFor(s, "b"))).not.toContain(MARK_CONT);
    // a stranger is not even a player: no secrets at all
    expect(viewFor(s, "nobody").secret.mission).toBeNull();
  });

  it("the switch to the fallback shows only in the holder's own view", () => {
    const after = ok(
      withMissions(s, { c: kill("b") }),
      attack("eisenfurt", "rabenhain", 3),
      [6, 5, 4, 1],
    ).state;
    expect(viewFor(after, "c").secret).toMatchObject({
      mission: testlandMissionsFallback(),
      missionReplaced: true,
    });
    expect(viewFor(after, "a").secret.missionReplaced).toBe(false);
    // everything a third party can see is identical to a run where c never targeted b
    const control = ok(
      withMissions(s, { c: hold(6, 2) }),
      attack("eisenfurt", "rabenhain", 3),
      [6, 5, 4, 1],
    ).state;
    for (const who of ["a", "b"]) {
      expect(JSON.stringify(viewFor(after, who))).toBe(JSON.stringify(viewFor(control, who)));
    }
  });

  it("originalMission and stateVersion are in no view before the game ends, not even the owner's, not after the switch", () => {
    const switched = ok(
      withMissions(s, { c: kill("b") }),
      attack("eisenfurt", "rabenhain", 3),
      [6, 5, 4, 1],
    ).state;
    const self = createGame({
      map: testland,
      rules: testlandRules,
      playerIds: ["p1", "p2", "p3"],
      rng: createSeededRng(14),
    });
    if (!self.ok) throw new Error(self.code);
    expect(self.state.secret.missionReplaced["p2"]).toBe(true); // seed 14: p2 drew the mission against p2
    for (const state of [s, switched, self.state]) {
      for (const who of [...state.playerOrder, "nobody"]) {
        const view = viewFor(state, who);
        expect(view.winnerId).toBeNull();
        const keys = keysOf(view);
        expect(keys.has("originalMission"), `${who}`).toBe(false);
        expect(keys.has("stateVersion")).toBe(false);
        expect(keys.has("rules")).toBe(false);
        expect(view.missions).toBeNull();
        expect(view.winReason).toBeNull();
      }
    }
    // the self-target holder knows the replacement but not what he drew
    const own = viewFor(self.state, "p2");
    expect(own.secret.missionReplaced).toBe(true);
    expect(JSON.stringify(own)).not.toContain('"eliminatePlayer"');
  });

  it("viewFor does not change the state and shares no mission object with it", () => {
    const copy = structuredClone(s);
    const view = viewFor(s, "b");
    expect(s).toEqual(copy);
    (view.secret.mission as { targetPlayerId: string }).targetPlayerId = "changed";
    expect(s.secret.mission["b"]).toEqual(kill(MARK_TARGET));
  });
});

describe("viewFor: the resolution after the game", () => {
  /** a eliminates b and wins with the elimination mission; c's mission pointed at b too, so it was replaced. */
  const finished = () => {
    const start = withMissions(board({ a: kill("b"), b: hold(6, 3), c: kill("b") }), {});
    return ok(start, attack("eisenfurt", "rabenhain", 3), [6, 5, 4, 1]).state;
  };

  it("is null before winnerId and filled after it, for every viewer", () => {
    const running = board({ a: kill("b"), b: hold(6, 3), c: hold(6, 2) });
    expect(viewFor(running, "a").missions).toBeNull();
    const done = finished();
    expect(done.winnerId).toBe("a");
    for (const who of ["a", "b", "c", "nobody"]) {
      const v = viewFor(done, who);
      expect(v.winReason).toBe("mission");
      expect(v.missions).toEqual({
        a: { mission: kill("b"), originalMission: null, discarded: null },
        b: { mission: hold(6, 3), originalMission: null, discarded: null },
        c: {
          mission: testlandMissionsFallback(),
          originalMission: kill("b"),
          discarded: null,
        },
      });
    }
  });

  it("shows originalMission only where the mission was replaced; the self-target case is readable from it", () => {
    const self = createGame({
      map: testland,
      rules: testlandRules,
      playerIds: ["p1", "p2", "p3"],
      rng: createSeededRng(14),
    });
    if (!self.ok) throw new Error(self.code);
    const over: GameState = { ...self.state, winnerId: "p1", winReason: "mission" };
    const reveal = viewFor(over, "p3").missions!;
    expect(reveal["p2"]!.originalMission).toEqual(kill("p2"));
    expect(reveal["p2"]!.mission).toEqual(testlandMissionsFallback());
    expect(reveal["p1"]!.originalMission).toBeNull();
    expect(reveal["p3"]!.originalMission).toBeNull();
  });

  it("winReason is lastPlayer for the last player; domination never reveals missions", () => {
    const alone = ok(
      makeState({ territories: { eisenfurt: ["a", 5], rabenhain: ["b", 1] }, fill: "a" }),
      attack("eisenfurt", "rabenhain", 3),
      [6, 5, 4, 1],
    ).state;
    expect(viewFor(alone, "b").winReason).toBe("lastPlayer");
    const dom: GameState = { ...alone, rules: { ...alone.rules, victoryMode: "domination" } };
    const v = viewFor(dom, "b");
    expect(v.victoryMode).toBe("domination");
    expect(v.missions).toBeNull();
    expect(v.secret.mission).toBeNull();
  });

  it("victoryMode is public and the same for everyone", () => {
    const s = board({});
    expect(viewFor(s, "a").victoryMode).toBe("missions");
    expect(viewFor(s, "c").victoryMode).toBe("missions");
  });
});

describe("viewFor: bonusEligible and the neutral owner", () => {
  const s = withCards(
    makeState({
      territories: { eisenfurt: ["a", 3], rabenhain: ["b", 2], tannenfeld: [null, 1] },
      fill: "b",
    }),
    {
      hand: {
        a: ["card-eisenfurt", "card-rabenhain", "card-tannenfeld", "card-joker-1"],
        b: ["card-salzmoor"],
      },
    },
  );

  it("is true exactly for cards of the owner's current territories; jokers, foreign and neutral are false", () => {
    const hand = viewFor(s, "a").secret.hand;
    expect(hand.map((c) => [c.id, c.bonusEligible])).toEqual([
      ["card-eisenfurt", true],
      ["card-rabenhain", false],
      ["card-tannenfeld", false],
      ["card-joker-1", false],
    ]);
  });

  it("follows the board: a territory lost is no longer eligible", () => {
    const lost: GameState = {
      ...s,
      territories: { ...s.territories, eisenfurt: { ownerId: "b", armies: 1 } },
    };
    expect(viewFor(lost, "a").secret.hand[0]!.bonusEligible).toBe(false);
  });

  it("appears only in the owner's own hand: not in another view, not in lastTrade", () => {
    expect(keysOf(viewFor(s, "b").secret.hand).has("bonusEligible")).toBe(true);
    const other = viewFor(s, "b");
    // a's cards are not in b's view at all, and a's view has no hand of b
    expect(JSON.stringify(other)).not.toContain("card-joker-1");
    const traded = ok(
      withCards(
        { ...s, phase: "reinforce" },
        { hand: { a: ["card-eisenfurt", "card-tannenfeld", "card-kupferstadt"] } },
      ),
      { type: "tradeCards", cardIds: ["card-eisenfurt", "card-tannenfeld", "card-kupferstadt"] },
    ).state;
    for (const who of ["a", "b"]) {
      const v = viewFor(traded, who);
      expect(v.lastTrade!.cards.length).toBe(3);
      expect(keysOf(v.lastTrade).has("bonusEligible")).toBe(false);
    }
    // b holds a card, a holds none: a's view has no bonusEligible anywhere
    const none = viewFor(withCards(s, { hand: { a: [], b: ["card-salzmoor"] } }), "a");
    expect(keysOf(none).has("bonusEligible")).toBe(false);
  });

  it("the neutral owner is ownerId null in the view and has no hand count", () => {
    const v = viewFor(s, "a");
    expect(v.territories["tannenfeld"]!.ownerId).toBeNull();
    expect(Object.keys(v.handCounts).sort()).toEqual(["a", "b"]);
  });
});

describe("the shape of state and view is pinned (no extra self-target field)", () => {
  const made = createGame({
    map: testland,
    rules: testlandRules,
    playerIds: ["p1", "p2", "p3"],
    rng: createSeededRng(1),
  });
  if (!made.ok) throw new Error(made.code);
  const state = made.state;

  it("GameState keys", () => {
    expect(Object.keys(state).sort()).toEqual(
      [
        "activePlayerId",
        "combatSeq",
        "conqueredThisTurn",
        "conquestsThisTurn",
        "fortifyMovesDone",
        "lastCombat",
        "lastTrade",
        "mapId",
        "pendingOccupation",
        "phase",
        "playerOrder",
        "reinforcementsLeft",
        "removedPlayerIds",
        "rules",
        "secret",
        "stateVersion",
        "territories",
        "tradeSeq",
        "turn",
        "winReason",
        "winnerId",
      ].sort(),
    );
  });
  it("secret keys", () => {
    expect(Object.keys(state.secret).sort()).toEqual(
      [
        "deck",
        "discard",
        "discardedMission",
        "hand",
        "mission",
        "missionOffer",
        "missionOfferDealt",
        "missionReplaced",
        "originalMission",
        "victoryPending",
      ].sort(),
    );
  });
  it("view and secret view keys", () => {
    const v = viewFor(state, "p1");
    expect(Object.keys(v).sort()).toEqual(
      [
        "activePlayerId",
        "conqueredThisTurn",
        "conquestsThisTurn",
        "deckCount",
        "discardCount",
        "fortify",
        "handCounts",
        "lastCombat",
        "lastTrade",
        "mapId",
        "missionChoice",
        "missions",
        "pendingOccupation",
        "phase",
        "playerOrder",
        "reinforcementsLeft",
        "removedPlayerIds",
        "secret",
        "territories",
        "turn",
        "victoryMode",
        "victoryPending",
        "winReason",
        "winnerId",
      ].sort(),
    );
    expect(Object.keys(v.secret).sort()).toEqual([
      "hand",
      "mission",
      "missionOffer",
      "missionProgress",
      "missionReplaced",
      "mustTrade",
      "suggestedSets",
      "victoryPending",
    ]);
  });
  it("resolution keys", () => {
    const over: GameState = { ...state, winnerId: "p1", winReason: "mission" };
    const reveal = viewFor(over, "p1").missions!;
    for (const entry of Object.values(reveal)) {
      expect(Object.keys(entry).sort()).toEqual(["discarded", "mission", "originalMission"]);
    }
  });
});

function testlandMissionsFallback(): Mission {
  return { type: "holdTerritories", count: 6, minArmies: 2 };
}
