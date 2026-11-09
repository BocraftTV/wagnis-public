import { describe, expect, it } from "vitest";
import {
  applyAction,
  cardCatalog,
  createDiceRng,
  testland,
  testlandRules,
  viewFor,
} from "./index.js";
import type { Action, GameState } from "./index.js";
import { makeState, withCards } from "./testkit.js";

const INF = ["card-eisenfurt", "card-tannenfeld", "card-kupferstadt"];
const CAV = ["card-rabenhain", "card-salzmoor", "card-nebelkueste"];
const ART = ["card-grauwacht", "card-dornental"];

const WIN = [6, 6, 6, 1]; // 3 attacker dice (6,6,6) against 1 defender die (1)

function play(s: GameState, player: string, a: Action, faces: number[] = []): GameState {
  const r = applyAction(s, player, a, createDiceRng(faces));
  if (!r.ok) throw new Error(`${r.code} for ${JSON.stringify(a)}`);
  return r.state;
}

/** a (many armies) attacks b's last territory; c keeps its territories, so the game goes on. */
function threePlayers(overrides: Partial<GameState> = {}): GameState {
  return makeState({
    players: ["a", "b", "c"],
    territories: {
      eisenfurt: ["a", 9],
      rabenhain: ["b", 1],
      grauwacht: ["a", 3],
      tannenfeld: ["c", 3],
      salzmoor: ["c", 3],
      dornental: ["c", 3],
      kupferstadt: ["c", 3],
      nebelkueste: ["c", 3],
    },
    overrides,
  });
}

describe("cards on elimination", () => {
  it("gives the conqueror both hands, empties the loser's, no instant trade", () => {
    const s = withCards(threePlayers({ reinforcementsLeft: 0 }), {
      hand: { a: [INF[0]!], b: [CAV[0]!, CAV[1]!, ART[0]!] },
      deck: [],
    });
    const r = applyAction(
      s,
      "a",
      { type: "attack", from: "eisenfurt", to: "rabenhain", dice: 3 },
      createDiceRng(WIN),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.secret.hand["a"]).toEqual([INF[0], CAV[0], CAV[1], ART[0]]);
    expect(r.state.secret.hand["b"]).toEqual([]);
    expect(r.state.winnerId).toBeNull();
    // No trade happened: same phase, no trade record, no armies from cards.
    expect(r.state.phase).toBe("attack");
    expect(r.state.lastTrade).toBeNull();
    expect(r.state.reinforcementsLeft).toBe(0);
    const types = r.events.map((e) => e.type);
    expect(types).toEqual([
      "attackRolled",
      "territoryConquered",
      "armiesMoved",
      "playerEliminated",
      "cardsTaken",
    ]);
    expect(r.events.at(-1)).toEqual({
      type: "cardsTaken",
      playerId: "a",
      fromPlayerId: "b",
      count: 3,
    });
    expect(JSON.stringify(r.events)).not.toContain("card-");
    // Public counts moved, contents only for the owner.
    expect(viewFor(r.state, "c").handCounts).toEqual({ a: 4, b: 0, c: 0 });
  });

  it("emits no cardsTaken when the loser held no cards", () => {
    const s = withCards(threePlayers(), { hand: { a: [INF[0]!] }, deck: [] });
    const r = applyAction(
      s,
      "a",
      { type: "attack", from: "eisenfurt", to: "rabenhain", dice: 3 },
      createDiceRng(WIN),
    );
    expect(r.ok && r.events.some((e) => e.type === "cardsTaken")).toBe(false);
    expect(r.ok && r.state.secret.hand["a"]).toEqual([INF[0]]);
  });

  it("also takes the cards with a blitz", () => {
    const s = withCards(threePlayers(), { hand: { b: [CAV[0]!] }, deck: [] });
    const next = play(s, "a", { type: "blitz", from: "eisenfurt", to: "rabenhain" }, WIN);
    expect(next.secret.hand["a"]).toEqual([CAV[0]]);
    expect(next.secret.hand["b"]).toEqual([]);
  });

  it("applies the mandatory trade only in the conqueror's next reinforce phase", () => {
    let s = withCards(threePlayers({ reinforcementsLeft: 0 }), {
      hand: { a: [INF[0]!, INF[1]!], b: [CAV[0]!, CAV[1]!, ART[0]!] },
      deck: [...ART.slice(1), "card-joker-1"],
    });
    s = play(s, "a", { type: "attack", from: "eisenfurt", to: "rabenhain", dice: 3 }, WIN);
    s = play(s, "a", { type: "occupy", count: 3 });
    // 5 cards now, but attack phase: nothing is blocked there.
    expect(s.secret.hand["a"]).toHaveLength(5);
    s = play(s, "a", { type: "endPhase" });
    s = play(s, "a", { type: "endPhase" }); // end of turn: a conquered, draws a card (6)
    expect(s.secret.hand["a"]).toHaveLength(6);
    expect(s.activePlayerId).toBe("c"); // b is out and skipped
    s = play(s, "c", {
      type: "placeArmies",
      territoryId: "tannenfeld",
      count: s.reinforcementsLeft,
    });
    for (let i = 0; i < 3; i++) s = play(s, "c", { type: "endPhase" });
    expect(s.activePlayerId).toBe("a");
    expect(s.phase).toBe("reinforce");
    const blocked = applyAction(
      s,
      "a",
      { type: "placeArmies", territoryId: "eisenfurt", count: 1 },
      createDiceRng([]),
    );
    expect(blocked).toEqual({ ok: false, code: "MUST_TRADE" });
    expect(viewFor(s, "c").handCounts["a"]).toBe(6);
  });

  it("with 11 cards after a takeover needs three sets (11 -> 8 -> 5 -> 2)", () => {
    const rules = { ...testlandRules, cards: { ...testlandRules.cards, jokers: 3 } };
    const all = cardCatalog(testland, rules).map((c) => c.id);
    expect(all).toHaveLength(11);
    let s = withCards(threePlayers({ rules, reinforcementsLeft: 0 }), {
      hand: { a: [], b: all },
      deck: [],
      discard: [],
    });
    s = play(s, "a", { type: "attack", from: "eisenfurt", to: "rabenhain", dice: 3 }, WIN);
    s = play(s, "a", { type: "occupy", count: 3 });
    expect(s.secret.hand["a"]).toEqual(all);
    s = play(s, "a", { type: "endPhase" });
    s = play(s, "a", { type: "endPhase" }); // deck and discard are empty: no draw
    expect(s.secret.hand["a"]).toHaveLength(11);
    s = play(s, "c", {
      type: "placeArmies",
      territoryId: "tannenfeld",
      count: s.reinforcementsLeft,
    });
    for (let i = 0; i < 3; i++) s = play(s, "c", { type: "endPhase" });
    expect(s.activePlayerId).toBe("a");
    const place: Action = { type: "placeArmies", territoryId: "eisenfurt", count: 1 };
    const locked = (st: GameState) => {
      const r = applyAction(st, "a", place, createDiceRng([]));
      return !r.ok && r.code === "MUST_TRADE";
    };
    expect(locked(s)).toBe(true);
    s = play(s, "a", { type: "tradeCards", cardIds: INF });
    expect(locked(s)).toBe(true); // 8
    s = play(s, "a", { type: "tradeCards", cardIds: CAV });
    expect(locked(s)).toBe(true); // 5
    s = play(s, "a", { type: "tradeCards", cardIds: [...ART, "card-joker-1"] });
    expect(s.secret.hand["a"]).toHaveLength(2);
    expect(locked(s)).toBe(false);
  });
});

describe("cards at game end", () => {
  // Two players: a takes b's last territory and wins.
  const lastStand = (): GameState =>
    withCards(
      makeState({
        territories: Object.fromEntries(
          testland.territories.map((t) => [t.id, ["a", 5] as [string, number]]),
        ),
        overrides: {},
      }),
      {},
    );

  it("moves the loser's hand to the winner, draws no card and stays consistent", () => {
    const base = lastStand();
    const territories = { ...base.territories, rabenhain: { ownerId: "b", armies: 1 } };
    const s = withCards(
      { ...base, territories },
      {
        hand: { a: [INF[0]!], b: [CAV[0]!, CAV[1]!] },
        deck: ["card-joker-1", "card-joker-2"],
        discard: [],
      },
    );
    const r = applyAction(
      s,
      "a",
      { type: "attack", from: "eisenfurt", to: "rabenhain", dice: 3 },
      createDiceRng(WIN),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const end = r.state;
    expect(end.winnerId).toBe("a");
    expect(end.pendingOccupation).toBeNull();
    expect(end.secret.hand["a"]).toEqual([INF[0], CAV[0], CAV[1]]);
    expect(end.secret.hand["b"]).toEqual([]);
    expect(end.secret.deck).toEqual(["card-joker-1", "card-joker-2"]); // no draw
    const types = r.events.map((e) => e.type);
    expect(types.indexOf("cardsTaken")).toBeLessThan(types.indexOf("gameWon"));
    expect(types).not.toContain("cardDrawn");
    // Every card still in exactly one place.
    const placed = [
      ...Object.values(end.secret.hand).flat(),
      ...end.secret.deck,
      ...end.secret.discard,
    ];
    expect(new Set(placed).size).toBe(placed.length);
    // Over: every further action is GAME_OVER, including a turn end that would draw.
    for (const a of [{ type: "endPhase" }, { type: "tradeCards", cardIds: INF }] as Action[]) {
      expect(applyAction(end, "a", a, createDiceRng([]))).toEqual({ ok: false, code: "GAME_OVER" });
    }
    expect(viewFor(end, "b").handCounts).toEqual({ a: 3, b: 0 });
  });
});
