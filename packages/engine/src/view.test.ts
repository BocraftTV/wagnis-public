import { describe, expect, it } from "vitest";
import {
  applyAction,
  cardCatalog,
  createDiceRng,
  createGame,
  createSeededRng,
  testland,
  testlandRules,
  viewFor,
} from "./index.js";
import type { Action, GameState, Mission } from "./index.js";
import { makeState, withCards } from "./testkit.js";

const MARK_ID = "GEHEIM-MISSION-B-9f3a";
const MARK_MISSION: Mission = { type: "eliminatePlayer", targetPlayerId: MARK_ID };
const MARK_CARD = "card-joker-2";

function state() {
  const r = createGame({
    map: testland,
    rules: testlandRules,
    playerIds: ["a", "b", "c"],
    rng: createSeededRng(5),
  });
  if (!r.ok) throw new Error(r.code);
  r.state.secret.mission["b"] = MARK_MISSION;
  r.state.secret.hand["b"] = [MARK_CARD, "card-salzmoor"];
  r.state.secret.mission["a"] = { type: "eliminatePlayer", targetPlayerId: "MISSION-A" };
  r.state.secret.hand["a"] = ["card-eisenfurt"];
  return r.state;
}

describe("viewFor", () => {
  it("never contains another player's secrets", () => {
    const json = JSON.stringify(viewFor(state(), "a"));
    expect(json).not.toContain(MARK_ID);
    expect(json).not.toContain(MARK_CARD);
    expect(json).not.toContain("card-salzmoor");
    expect(JSON.stringify(viewFor(state(), "c"))).not.toContain("MISSION-A");
  });

  it("contains the viewer's own secrets", () => {
    const view = viewFor(state(), "b");
    expect(view.secret.mission).toEqual(MARK_MISSION);
    expect(view.secret.hand).toEqual([
      { id: MARK_CARD, kind: "joker", territoryId: null, bonusEligible: false },
      {
        id: "card-salzmoor",
        kind: "cavalry",
        territoryId: "salzmoor",
        bonusEligible: state().territories["salzmoor"]!.ownerId === "b",
      },
    ]);
  });

  it("shows only hand sizes for everyone", () => {
    expect(viewFor(state(), "a").handCounts).toEqual({ a: 1, b: 2, c: 0 });
  });

  it("does not expose rules or the raw state shape", () => {
    const view = viewFor(state(), "a") as unknown as Record<string, unknown>;
    expect(view).not.toHaveProperty("rules");
    expect(Object.keys(view).sort()).toEqual(
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
        "pendingOccupation",
        "phase",
        "playerOrder",
        "reinforcementsLeft",
        "removedPlayerIds",
        "round",
        "roundLimit",
        "scores",
        "secret",
        "territories",
        "turn",
        "victoryMode",
        "victoryPending",
        "winReason",
        "winnerId",
        "winnerIds",
        "missions",
      ].sort(),
    );
  });
});

describe("viewFor: attack fields", () => {
  const strike = (dice: number): Action => ({
    type: "attack",
    from: "eisenfurt",
    to: "rabenhain",
    dice,
  });
  const play = (s: GameState, action: Action, faces: number[]): GameState => {
    const r = applyAction(s, s.activePlayerId, action, createDiceRng(faces));
    if (!r.ok) throw new Error(r.code);
    return r.state;
  };

  it("maxAttackDice is min(3, armies - 1), at least 0, for every territory and phase", () => {
    const armies = [1, 2, 3, 4, 10];
    const s = makeState({
      territories: {
        eisenfurt: ["a", armies[0]!],
        rabenhain: ["b", armies[1]!],
        grauwacht: ["a", armies[2]!],
        tannenfeld: ["b", armies[3]!],
        salzmoor: ["a", armies[4]!],
      },
    });
    for (const phase of ["reinforce", "attack", "fortify"] as const) {
      for (const viewer of ["a", "b"]) {
        const t = viewFor({ ...s, phase }, viewer).territories;
        expect(t["eisenfurt"]!.maxAttackDice).toBe(0);
        expect(t["rabenhain"]!.maxAttackDice).toBe(1);
        expect(t["grauwacht"]!.maxAttackDice).toBe(2);
        expect(t["tannenfeld"]!.maxAttackDice).toBe(3);
        expect(t["salzmoor"]!.maxAttackDice).toBe(3);
      }
    }
  });

  it("starts without attack state", () => {
    const v = viewFor(makeState({ territories: {} }), "a");
    expect(v.pendingOccupation).toBeNull();
    expect(v.lastCombat).toBeNull();
    expect(v.winnerId).toBeNull();
    expect(v.conqueredThisTurn).toBe(false);
  });

  it("pendingOccupation carries from, to, min and the derived max", () => {
    // 5 armies attack with 3 dice and win: min 3, 2 armies left in `from`, so max = 3 + (2 - 1) = 4.
    const s = play(
      makeState({ territories: { eisenfurt: ["a", 5], rabenhain: ["b", 1] } }),
      strike(3),
      [6, 5, 4, 1],
    );
    expect(s.pendingOccupation).toEqual({ from: "eisenfurt", to: "rabenhain", min: 3 }); // the state holds no max
    for (const viewer of ["a", "b"]) {
      expect(viewFor(s, viewer).pendingOccupation).toEqual({
        from: "eisenfurt",
        to: "rabenhain",
        min: 3,
        max: 4,
      });
    }
    const done = play(s, { type: "occupy", count: 3 }, []);
    expect(viewFor(done, "a").pendingOccupation).toBeNull();
  });

  it("shows lastCombat to everyone, with a seq that stays stable across views and turn changes", () => {
    const s = play(
      makeState({ territories: { eisenfurt: ["a", 5], rabenhain: ["b", 4] } }),
      strike(3),
      [3, 6, 1, 5, 3],
    );
    const first = viewFor(s, "a").lastCombat;
    expect(first).not.toBeNull();
    expect(first!.seq).toBe(1);
    expect(viewFor(s, "b").lastCombat).toEqual(first);
    expect(viewFor(s, "a").lastCombat).toEqual(first); // repeated view (reconnect): same seq
    expect(Object.keys(first!).sort()).toEqual([
      "attackerId",
      "defenderId",
      "from",
      "rolls",
      "seq",
      "summary",
      "to",
    ]);
    const cleared = play(play(s, { type: "endPhase" }, []), { type: "endPhase" }, []);
    expect(viewFor(cleared, "a").lastCombat).toBeNull();
    const again = play({ ...cleared, activePlayerId: "a", phase: "attack" }, strike(1), [6, 1, 1]);
    expect(viewFor(again, "a").lastCombat!.seq).toBe(2);
  });

  it("shows winnerId and conqueredThisTurn", () => {
    const s = play(
      makeState({ fill: "a", territories: { eisenfurt: ["a", 5], rabenhain: ["b", 1] } }),
      strike(1),
      [6, 1],
    );
    const v = viewFor(s, "b");
    expect(v.winnerId).toBe("a");
    expect(v.conqueredThisTurn).toBe(true);
  });

  it("whitelists the lastCombat fields even if a stored state carries extras", () => {
    const s = play(
      makeState({ territories: { eisenfurt: ["a", 5], rabenhain: ["b", 4] } }),
      strike(3),
      [3, 6, 1, 5, 3],
    );
    (s.lastCombat as unknown as Record<string, unknown>)["extra"] = "LEAK";
    (s.lastCombat!.rolls[0] as unknown as Record<string, unknown>)["extra"] = "LEAK";
    (s.lastCombat!.summary as unknown as Record<string, unknown>)["extra"] = "LEAK";
    expect(JSON.stringify(viewFor(s, "a"))).not.toContain("LEAK");
  });

  it("copies: changing a view never changes the state", () => {
    const s = play(
      makeState({ territories: { eisenfurt: ["a", 5], rabenhain: ["b", 4] } }),
      strike(3),
      [3, 6, 1, 5, 3],
    );
    const copy = structuredClone(s);
    const v = viewFor(s, "a");
    v.lastCombat!.rolls[0]!.attackerDice.push(99);
    v.lastCombat!.summary.rollCount = 99;
    expect(s).toEqual(copy);
  });

  it("keeps other players' secrets out when the new fields are filled (marker test)", () => {
    const s = play(
      makeState({ territories: { eisenfurt: ["a", 5], rabenhain: ["b", 1] } }),
      strike(3),
      [6, 5, 4, 1],
    );
    s.secret.mission["b"] = MARK_MISSION;
    s.secret.hand["b"] = [MARK_CARD];
    const json = JSON.stringify(viewFor(s, "a"));
    expect(json).not.toContain(MARK_ID);
    expect(json).not.toContain(MARK_CARD);
    expect(json).not.toContain("combatSeq");
    expect(json).not.toContain("rules");
  });
});

describe("viewFor: phase 3 fields", () => {
  /** a owns the chain eisenfurt - rabenhain - tannenfeld and salzmoor - dornental - nebelkueste. */
  const fortifyState = (reach: "connected" | "adjacent", overrides: Partial<GameState> = {}) =>
    makeState({
      phase: "fortify",
      territories: {
        eisenfurt: ["a", 3],
        rabenhain: ["a", 1],
        tannenfeld: ["a", 2],
        salzmoor: ["a", 4],
        dornental: ["a", 1],
        nebelkueste: ["a", 2],
      },
      overrides: { rules: { ...testlandRules, fortifyReach: reach }, ...overrides },
    });

  it("maxMove is armies - 1, at least 0, public, in every phase", () => {
    const s = fortifyState("connected");
    for (const phase of ["reinforce", "attack", "fortify"] as const) {
      for (const viewer of ["a", "b"]) {
        const t = viewFor({ ...s, phase }, viewer).territories;
        expect(t["eisenfurt"]!.maxMove).toBe(2);
        expect(t["rabenhain"]!.maxMove).toBe(0);
        expect(t["salzmoor"]!.maxMove).toBe(3);
        expect(t["grauwacht"]!.maxMove).toBe(0); // b's, 1 army
      }
    }
  });

  it("fortify is only there for the active player in the fortify phase", () => {
    const s = fortifyState("connected");
    expect(viewFor(s, "a").fortify).not.toBeNull();
    expect(viewFor(s, "b").fortify).toBeNull();
    for (const phase of ["reinforce", "attack"] as const) {
      expect(viewFor({ ...s, phase }, "a").fortify).toBeNull();
    }
    expect(viewFor({ ...s, winnerId: "a" }, "a").fortify).toBeNull();
  });

  it("connected: lists groups of linked own territories, only groups of 2 or more", () => {
    const f = viewFor(fortifyState("connected"), "a").fortify;
    expect(f).toEqual({
      reach: "connected",
      groups: [
        ["eisenfurt", "rabenhain", "tannenfeld"],
        ["salzmoor", "dornental", "nebelkueste"],
      ],
      movesDone: 0,
      movesMax: 1,
    });
    const lone = makeState({ phase: "fortify", territories: { eisenfurt: ["a", 3] } });
    expect(viewFor(lone, "a").fortify).toEqual({
      reach: "connected",
      groups: [],
      movesDone: 0,
      movesMax: 1,
    });
  });

  it("adjacent: lists the allowed targets for every origin that can move", () => {
    const f = viewFor(fortifyState("adjacent"), "a").fortify;
    expect(f).toEqual({
      reach: "adjacent",
      targets: {
        eisenfurt: ["rabenhain"],
        tannenfeld: ["rabenhain"],
        salzmoor: ["dornental"],
        nebelkueste: ["dornental"],
      },
      movesDone: 0,
      movesMax: 1,
    });
  });

  it.each(["connected", "adjacent"] as const)(
    "the highlights agree with what the engine accepts (%s)",
    (reach) => {
      const s = fortifyState(reach);
      const f = viewFor(s, "a").fortify!;
      const own = Object.keys(s.territories).filter((t) => s.territories[t]!.ownerId === "a");
      for (const from of own) {
        for (const to of own) {
          if (from === to || s.territories[from]!.armies < 2) continue;
          const shown =
            f.reach === "connected"
              ? f.groups.some((g) => g.includes(from) && g.includes(to))
              : (f.targets[from] ?? []).includes(to);
          const r = applyAction(s, "a", { type: "fortify", from, to, count: 1 }, createDiceRng([]));
          expect(r.ok, `${from} -> ${to}`).toBe(shown);
        }
      }
    },
  );

  const reinforceState = (hand: string[], overrides: Partial<GameState> = {}) =>
    makeState({
      phase: "reinforce",
      territories: { eisenfurt: ["a", 2], tannenfeld: ["a", 2] },
      overrides: { reinforcementsLeft: 3, ...overrides },
    });
  const withHand = (s: GameState, hand: string[]): GameState => withCards(s, { hand: { a: hand } });
  const INF = ["card-eisenfurt", "card-tannenfeld", "card-kupferstadt"];

  it("suggestedSets and mustTrade: only for the owner, suggestedSets only in the own reinforce phase", () => {
    const s = withHand(reinforceState([]), [...INF, "card-rabenhain", "card-salzmoor"]);
    const own = viewFor(s, "a");
    expect(own.secret.mustTrade).toBe(true);
    expect(own.secret.suggestedSets).toEqual([
      {
        cardIds: ["card-eisenfurt", "card-tannenfeld", "card-kupferstadt"],
        value: 4,
        bonusTerritoryId: "eisenfurt",
      },
    ]);
    const other = viewFor(s, "b");
    expect(other.secret.suggestedSets).toEqual([]);
    expect(other.secret.mustTrade).toBe(false);
    expect(other.secret.hand).toEqual([]);
    for (const phase of ["attack", "fortify"] as const) {
      const v = viewFor({ ...s, phase }, "a");
      expect(v.secret.suggestedSets).toEqual([]);
      expect(v.secret.mustTrade).toBe(false);
      expect(v.secret.hand).toHaveLength(5);
    }
  });

  it("suggestedSets and mustTrade are empty once the game is over", () => {
    const s = withHand(reinforceState([]), [...INF, "card-rabenhain", "card-salzmoor"]);
    const v = viewFor({ ...s, winnerId: "a" }, "a");
    expect(v.secret.suggestedSets).toEqual([]);
    expect(v.secret.mustTrade).toBe(false);
  });

  it("mustTrade is false below 5 cards, suggestedSets can be empty", () => {
    const s = withHand(reinforceState([]), ["card-eisenfurt", "card-tannenfeld"]);
    const v = viewFor(s, "a");
    expect(v.secret.mustTrade).toBe(false);
    expect(v.secret.suggestedSets).toEqual([]);
  });

  it("suggestedSets is never empty with mustTrade (5 cards of any mix)", () => {
    for (const hand of [
      ["card-eisenfurt", "card-tannenfeld", "card-rabenhain", "card-salzmoor", "card-grauwacht"],
      ["card-eisenfurt", "card-tannenfeld", "card-rabenhain", "card-salzmoor", "card-joker-1"],
      ["card-joker-1", "card-joker-2", "card-eisenfurt", "card-tannenfeld", "card-rabenhain"],
    ]) {
      const v = viewFor(withHand(reinforceState([]), hand), "a");
      expect(v.secret.mustTrade).toBe(true);
      expect(v.secret.suggestedSets.length, hand.join()).toBeGreaterThan(0);
    }
  });

  it("shows lastTrade, deckCount and discardCount to everyone, never the contents", () => {
    const base = withHand(reinforceState([]), [...INF, "card-rabenhain"]);
    const s = withCards(base, { deck: ["card-dornental", "card-nebelkueste"], discard: [] });
    const r = applyAction(s, "a", { type: "tradeCards", cardIds: INF }, createDiceRng([]));
    if (!r.ok) throw new Error(r.code);
    for (const viewer of ["a", "b"]) {
      const v = viewFor(r.state, viewer);
      expect(v.lastTrade).toEqual({
        seq: 1,
        playerId: "a",
        cards: [
          { id: "card-eisenfurt", kind: "infantry", territoryId: "eisenfurt" },
          { id: "card-tannenfeld", kind: "infantry", territoryId: "tannenfeld" },
          { id: "card-kupferstadt", kind: "infantry", territoryId: "kupferstadt" },
        ],
        armies: 4,
        bonusTerritoryId: "eisenfurt",
      });
      expect(v.deckCount).toBe(2);
      expect(v.discardCount).toBe(3);
    }
    // The card that stayed in a's hand and the deck do not show up for b.
    const json = JSON.stringify(viewFor(r.state, "b"));
    expect(json).not.toContain("card-rabenhain");
    expect(json).not.toContain("card-dornental");
    expect(json).not.toContain("card-nebelkueste");
    // lastTrade clears at the turn change, tradeSeq stays.
    const next = applyAction(
      { ...r.state, reinforcementsLeft: 0, phase: "fortify" },
      "a",
      { type: "endPhase" },
      createDiceRng([]),
    );
    if (!next.ok) throw new Error(next.code);
    expect(viewFor(next.state, "b").lastTrade).toBeNull();
    expect(next.state.tradeSeq).toBe(1);
  });

  it("marker test: other hands, deck and discard pile are nowhere in the JSON of another view", () => {
    const s = withCards(
      makeState({
        players: ["a", "b", "c"],
        phase: "reinforce",
        territories: { eisenfurt: ["a", 2] },
        overrides: { lastTrade: null },
      }),
      {
        hand: { b: ["card-rabenhain", "card-joker-1"], c: ["card-salzmoor"] },
        deck: ["card-dornental", "card-nebelkueste"],
        discard: ["card-kupferstadt"],
      },
    );
    for (const viewer of ["a", "c"]) {
      const json = JSON.stringify(viewFor(s, viewer));
      for (const id of [
        "card-rabenhain",
        "card-joker-1",
        "card-dornental",
        "card-nebelkueste",
        "card-kupferstadt",
      ]) {
        expect(json, `${viewer} sees ${id}`).not.toContain(id);
      }
      expect(json).not.toContain('"deck"');
      expect(json).not.toContain('"discard"');
    }
    expect(JSON.stringify(viewFor(s, "c"))).toContain("card-salzmoor");
    expect(JSON.stringify(viewFor(s, "a"))).not.toContain("card-salzmoor");
  });

  it("whitelists the lastTrade fields even if a stored state carries extras", () => {
    const s = withHand(reinforceState([]), INF);
    const r = applyAction(s, "a", { type: "tradeCards", cardIds: INF }, createDiceRng([]));
    if (!r.ok) throw new Error(r.code);
    (r.state.lastTrade as unknown as Record<string, unknown>)["extra"] = "LEAK";
    (r.state.lastTrade!.cards[0] as unknown as Record<string, unknown>)["extra"] = "LEAK";
    expect(JSON.stringify(viewFor(r.state, "b"))).not.toContain("LEAK");
  });

  it("copies: changing a view never changes the state", () => {
    const s = withHand(reinforceState([]), INF);
    const copy = structuredClone(s);
    const v = viewFor(s, "a");
    v.secret.hand[0]!.kind = "joker";
    v.secret.suggestedSets[0]!.cardIds.push("x");
    expect(s).toEqual(copy);
  });

  it("keeps the snapshot below 20 KB for any hand size, even 44 cards", () => {
    const size = (jokers: number): number => {
      const rules = { ...testlandRules, cards: { ...testlandRules.cards, jokers } };
      const all = cardCatalog(testland, rules).map((c) => c.id);
      const s = withCards(
        makeState({
          phase: "reinforce",
          territories: { eisenfurt: ["a", 2] },
          overrides: { rules },
        }),
        { hand: { a: all } },
      );
      const v = viewFor(s, "a");
      expect(v.secret.suggestedSets.length).toBeLessThanOrEqual(4);
      return JSON.stringify(v).length;
    };
    const small = size(3); // 11 cards
    expect(small).toBeLessThan(20_000);
    expect(size(12)).toBeLessThan(20_000); // 20 cards
    expect(size(36)).toBeLessThan(20_000); // 44 cards: 8 territories + 36 jokers
    expect(size(36)).toBeLessThan(small * 4); // dominated by the hand itself, not by the sets
  });
});
