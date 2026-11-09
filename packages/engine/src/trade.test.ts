import { describe, expect, it } from "vitest";
import {
  applyAction,
  cardCatalog,
  createSeededRng,
  findSuggestedSets,
  testland,
  testlandRules,
  tradeValue,
} from "./index.js";
import type { Action, CardKind, GameState } from "./index.js";
import { makeState, withCards } from "./testkit.js";

const rng = createSeededRng(1);

// testland catalog: infantry eisenfurt, tannenfeld, kupferstadt; cavalry rabenhain, salzmoor,
// nebelkueste; artillery grauwacht, dornental; jokers card-joker-1/2.
const INF = ["card-eisenfurt", "card-tannenfeld", "card-kupferstadt"];
const CAV = ["card-rabenhain", "card-salzmoor", "card-nebelkueste"];
const ART = ["card-grauwacht", "card-dornental"];
const J1 = "card-joker-1";
const J2 = "card-joker-2";

/** a is in the reinforce phase with `hand`; a owns eisenfurt, rabenhain and tannenfeld, b the rest. */
function reinforce(hand: string[], overrides: Partial<GameState> = {}): GameState {
  return withCards(
    makeState({
      phase: "reinforce",
      territories: { eisenfurt: ["a", 2], rabenhain: ["a", 2], tannenfeld: ["a", 2] },
      overrides: { reinforcementsLeft: 3, ...overrides },
    }),
    { hand: { a: hand }, deck: [], discard: [] },
  );
}

const trade = (cardIds: string[], bonusTerritoryId?: string): Action =>
  bonusTerritoryId === undefined
    ? { type: "tradeCards", cardIds }
    : { type: "tradeCards", cardIds, bonusTerritoryId };
const run = (s: GameState, a: Action, p = s.activePlayerId) => applyAction(s, p, a, rng);
function ok(s: GameState, a: Action): GameState {
  const r = run(s, a);
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
const code = (s: GameState, a: Action, p = s.activePlayerId): string | undefined => {
  const r = run(s, a, p);
  return r.ok ? undefined : r.code;
};

describe("tradeValue", () => {
  const v = (...kinds: CardKind[]) => tradeValue(kinds, testlandRules);

  it("pins the four set values", () => {
    expect(v("infantry", "infantry", "infantry")).toBe(4);
    expect(v("cavalry", "cavalry", "cavalry")).toBe(6);
    expect(v("artillery", "artillery", "artillery")).toBe(8);
    expect(v("infantry", "cavalry", "artillery")).toBe(10);
  });

  it("reads jokers in the best way", () => {
    expect(v("artillery", "artillery", "joker")).toBe(8);
    expect(v("infantry", "cavalry", "joker")).toBe(10);
    expect(v("joker", "joker", "infantry")).toBe(10);
    expect(v("joker", "joker", "artillery")).toBe(10);
    expect(v("joker", "infantry", "infantry")).toBe(4);
  });

  it("reads three jokers as the best set (a configured catalog may hold more than two)", () => {
    expect(v("joker", "joker", "joker")).toBe(10);
  });

  it("rejects everything else", () => {
    expect(v("infantry", "infantry", "cavalry")).toBeNull();
    expect(v("artillery", "cavalry", "cavalry")).toBeNull();
  });

  it("uses the configured values", () => {
    const rules = {
      ...testlandRules,
      cards: {
        ...testlandRules.cards,
        tradeValues: { infantry: 1, cavalry: 2, artillery: 3, mixed: 4 },
      },
    };
    expect(tradeValue(["infantry", "infantry", "infantry"], rules)).toBe(1);
    expect(tradeValue(["artillery", "joker", "joker"], rules)).toBe(4);
  });
});

describe("tradeCards: values in the engine", () => {
  it.each([
    ["3 x infantry", INF, 4],
    ["3 x cavalry", CAV, 6],
    ["one of each kind", [INF[0]!, CAV[0]!, ART[0]!], 10],
    ["2 x artillery + joker", [...ART, J1], 8],
    ["infantry + cavalry + joker", [INF[0]!, CAV[0]!, J1], 10],
    ["joker + joker + symbol card", [J1, J2, ART[0]!], 10],
  ])("%s gives %i armies", (_name, ids, armies) => {
    const s = reinforce(ids);
    const next = ok(s, trade(ids));
    expect(next.reinforcementsLeft).toBe(3 + armies);
    expect(next.secret.hand["a"]).toEqual([]);
    expect(next.lastTrade).toMatchObject({ seq: 1, playerId: "a", armies });
  });

  it("puts the traded cards on the discard pile and emits the public event", () => {
    const s = reinforce([...ART, J1, "card-salzmoor"]);
    const r = run(s, trade([...ART, J1]));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.state.secret.discard).toEqual([...ART, J1]);
    expect(r.state.secret.hand["a"]).toEqual(["card-salzmoor"]);
    expect(r.events).toHaveLength(1);
    expect(r.events[0]).toMatchObject({ type: "cardsTraded", playerId: "a", armies: 8 });
  });

  it("adds the traded armies to the pool, placed like normal reinforcements", () => {
    const next = ok(reinforce(INF), trade(INF));
    const placed = ok(next, { type: "placeArmies", territoryId: "rabenhain", count: 7 });
    expect(placed.reinforcementsLeft).toBe(0);
    expect(placed.territories["rabenhain"]!.armies).toBe(2 + 7);
  });
});

describe("tradeCards: rejections", () => {
  it("rejects 2 x infantry + cavalry with INVALID_SET and leaves the state unchanged", () => {
    const ids = [INF[0]!, INF[1]!, CAV[0]!];
    const s = reinforce(ids);
    const before = structuredClone(s);
    expect(run(s, trade(ids))).toEqual({ ok: false, code: "INVALID_SET" });
    expect(s).toEqual(before);
  });

  it("rejects 2 or 4 cards and duplicate ids with INVALID_SET", () => {
    const s = reinforce([...INF, CAV[0]!]);
    expect(code(s, trade([INF[0]!, INF[1]!]))).toBe("INVALID_SET");
    expect(code(s, trade([...INF, CAV[0]!]))).toBe("INVALID_SET");
    expect(code(s, trade([INF[0]!, INF[0]!, INF[1]!]))).toBe("INVALID_SET");
    expect(code(s, trade([]))).toBe("INVALID_SET");
  });

  it("rejects cards that are not in the own hand with UNKNOWN_CARD", () => {
    const s = withCards(reinforce(INF), { hand: { b: [CAV[0]!] } });
    expect(code(s, trade([INF[0]!, INF[1]!, CAV[0]!]))).toBe("UNKNOWN_CARD"); // b's card
    expect(code(s, trade([INF[0]!, INF[1]!, "card-nowhere"]))).toBe("UNKNOWN_CARD");
    expect(code(s, trade([INF[0]!, INF[1]!, "constructor"]))).toBe("UNKNOWN_CARD");
  });

  it("only works in the own reinforce phase", () => {
    const s = reinforce(INF);
    expect(code({ ...s, phase: "attack" }, trade(INF))).toBe("WRONG_PHASE");
    expect(code({ ...s, phase: "fortify" }, trade(INF))).toBe("WRONG_PHASE");
    expect(code(s, trade(INF), "b")).toBe("NOT_YOUR_TURN");
    expect(code({ ...s, winnerId: "a" }, trade(INF))).toBe("GAME_OVER");
    expect(
      code({ ...s, pendingOccupation: { from: "eisenfurt", to: "grauwacht", min: 1 } }, trade(INF)),
    ).toBe("OCCUPY_PENDING");
  });

  it("follows the order of checks of rules.md 8", () => {
    const s = reinforce(INF);
    expect(code({ ...s, phase: "attack" }, trade(["x"]))).toBe("WRONG_PHASE");
    expect(code(s, trade(["x", "y"], "nope"))).toBe("INVALID_SET");
    expect(code(s, trade(["x", "y", "z"], "nope"))).toBe("UNKNOWN_CARD");
    const bad = reinforce([INF[0]!, INF[1]!, CAV[0]!]);
    expect(code(bad, trade([INF[0]!, INF[1]!, CAV[0]!], "nope"))).toBe("INVALID_SET");
    expect(code(s, trade(INF, "nope"))).toBe("INVALID_BONUS_TERRITORY");
  });
});

describe("tradeCards: territory bonus", () => {
  // INF shows eisenfurt and tannenfeld (a's) and kupferstadt (b's).
  it("gives +2 on exactly one territory even if two cards show own ones, not to the pool", () => {
    const next = ok(reinforce(INF), trade(INF));
    const gained = ["eisenfurt", "tannenfeld"].map((id) => next.territories[id]!.armies - 2);
    expect(gained.sort()).toEqual([0, 2]);
    expect(next.reinforcementsLeft).toBe(3 + 4);
    expect(next.lastTrade!.bonusTerritoryId).not.toBeNull();
  });

  it("takes the first matching card in the order of cardIds without a choice", () => {
    const a = ok(reinforce(INF), trade(["card-tannenfeld", "card-eisenfurt", "card-kupferstadt"]));
    expect(a.territories["tannenfeld"]!.armies).toBe(4);
    expect(a.territories["eisenfurt"]!.armies).toBe(2);
    expect(a.lastTrade!.bonusTerritoryId).toBe("tannenfeld");
    const b = ok(reinforce(INF), trade(INF));
    expect(b.territories["eisenfurt"]!.armies).toBe(4);
    expect(b.territories["tannenfeld"]!.armies).toBe(2);
  });

  it("takes the chosen territory", () => {
    const next = ok(reinforce(INF), trade(INF, "tannenfeld"));
    expect(next.territories["tannenfeld"]!.armies).toBe(4);
    expect(next.territories["eisenfurt"]!.armies).toBe(2);
    expect(next.lastTrade!.bonusTerritoryId).toBe("tannenfeld");
  });

  it("rejects a foreign, an unshown or an unknown territory with INVALID_BONUS_TERRITORY", () => {
    const s = reinforce(INF);
    expect(code(s, trade(INF, "kupferstadt"))).toBe("INVALID_BONUS_TERRITORY"); // shown, not own
    expect(code(s, trade(INF, "rabenhain"))).toBe("INVALID_BONUS_TERRITORY"); // own, not shown
    expect(code(s, trade(INF, "nope"))).toBe("INVALID_BONUS_TERRITORY");
  });

  it("gives no bonus when no card shows an own territory, and a named one is rejected", () => {
    const hand = ["card-kupferstadt", "card-dornental", "card-nebelkueste"]; // all b's
    const s = reinforce(hand);
    const next = ok(s, trade(hand));
    expect(next.lastTrade!.bonusTerritoryId).toBeNull();
    expect(next.territories).toEqual(s.territories);
    expect(code(s, trade(hand, "eisenfurt"))).toBe("INVALID_BONUS_TERRITORY");
  });

  it("lets jokers show no territory", () => {
    const hand = [J1, J2, "card-eisenfurt"];
    const next = ok(reinforce(hand), trade(hand));
    expect(next.lastTrade!.bonusTerritoryId).toBe("eisenfurt");
    const onlyJokers = [J1, J2, "card-kupferstadt"];
    const s = reinforce(onlyJokers);
    expect(ok(s, trade(onlyJokers)).lastTrade!.bonusTerritoryId).toBeNull();
    expect(code(s, trade(onlyJokers, "eisenfurt"))).toBe("INVALID_BONUS_TERRITORY");
  });

  it("grants the bonus once per set: two sets in one turn give +2 each", () => {
    const hand = [...INF, ...CAV];
    let s = reinforce(hand);
    s = ok(s, trade(INF, "eisenfurt"));
    s = ok(s, trade(CAV, "rabenhain"));
    expect(s.territories["eisenfurt"]!.armies).toBe(4);
    expect(s.territories["rabenhain"]!.armies).toBe(4);
    expect(s.reinforcementsLeft).toBe(3 + 4 + 6);
    expect(s.lastTrade!.seq).toBe(2);
    expect(s.tradeSeq).toBe(2);
  });
});

describe("mandatory trade", () => {
  const FIVE = [...INF, CAV[0]!, CAV[1]!]; // contains valid sets
  const place: Action = { type: "placeArmies", territoryId: "eisenfurt", count: 1 };

  it("blocks placeArmies and endPhase with 5 cards, trading stays allowed", () => {
    const s = reinforce(FIVE);
    expect(code(s, place)).toBe("MUST_TRADE");
    expect(code(s, { type: "endPhase" })).toBe("MUST_TRADE");
    expect(code({ ...s, reinforcementsLeft: 0 }, { type: "endPhase" })).toBe("MUST_TRADE");
    expect(code(s, trade(INF))).toBeUndefined();
  });

  it("lets the player carry on after trading (hand 2)", () => {
    const next = ok(reinforce(FIVE), trade(INF));
    expect(next.secret.hand["a"]).toHaveLength(2);
    expect(code(next, place)).toBeUndefined();
  });

  it("does not block with 4 cards", () => {
    const s = reinforce(FIVE.slice(0, 4));
    expect(code(s, place)).toBeUndefined();
  });

  it("checks the lock after the phase and before the other placeArmies checks", () => {
    const s = reinforce(FIVE);
    expect(code({ ...s, phase: "attack" }, place)).toBe("WRONG_PHASE");
    expect(code(s, { type: "placeArmies", territoryId: "nope", count: 99 })).toBe("MUST_TRADE");
  });

  it("does not affect other phases or other players", () => {
    const s = reinforce(FIVE);
    expect(code({ ...s, phase: "attack" }, { type: "endPhase" })).toBeUndefined();
    expect(code({ ...s, phase: "fortify" }, { type: "endPhase" })).toBeUndefined();
  });

  it("needs three sets for 11 cards (11 -> 8 -> 5 -> 2) and stays locked until below 5", () => {
    // Three jokers make a catalog of 11 cards, so one hand can hold all of them.
    const rules = { ...testlandRules, cards: { ...testlandRules.cards, jokers: 3 } };
    const all = cardCatalog(testland, rules).map((c) => c.id);
    expect(all).toHaveLength(11);
    let s = reinforce(all, { rules });
    expect(code(s, place)).toBe("MUST_TRADE");
    s = ok(s, trade(INF));
    expect(s.secret.hand["a"]).toHaveLength(8);
    expect(code(s, place)).toBe("MUST_TRADE");
    s = ok(s, trade(CAV));
    expect(s.secret.hand["a"]).toHaveLength(5);
    expect(code(s, place)).toBe("MUST_TRADE");
    s = ok(s, trade([...ART, J1]));
    expect(s.secret.hand["a"]).toEqual([J2, "card-joker-3"]);
    expect(code(s, place)).toBeUndefined();
  });
});

describe("a mandatory trade can always be met", () => {
  it("every mix of 5 to 12 cards (0-2 jokers) contains a valid set of kinds", () => {
    for (let i = 0; i <= 12; i++)
      for (let c = 0; c <= 12 - i; c++)
        for (let a = 0; a <= 12 - i - c; a++)
          for (let j = 0; j <= 2; j++) {
            const n = i + c + a + j;
            if (n < 5 || n > 12) continue;
            const kinds: CardKind[] = [
              ...Array<CardKind>(i).fill("infantry"),
              ...Array<CardKind>(c).fill("cavalry"),
              ...Array<CardKind>(a).fill("artillery"),
              ...Array<CardKind>(j).fill("joker"),
            ];
            let found = false;
            for (let x = 0; x < n && !found; x++)
              for (let y = x + 1; y < n && !found; y++)
                for (let z = y + 1; z < n && !found; z++)
                  found = tradeValue([kinds[x]!, kinds[y]!, kinds[z]!], testlandRules) !== null;
            expect(found, `${i}/${c}/${a}/${j}`).toBe(true);
          }
  });

  it("with 4 cards a set can be missing (2 x infantry + 2 x cavalry), which is why mustTradeAt >= 5", () => {
    const hand = [INF[0]!, INF[1]!, CAV[0]!, CAV[1]!];
    expect(findSuggestedSets(reinforce(hand), "a", catalog())).toEqual([]);
  });

  it("every subset of the testland catalog with 5 or more cards has a valid set (findSuggestedSets)", () => {
    const all = cardCatalog(testland, testlandRules).map((c) => c.id);
    for (let mask = 0; mask < 1 << all.length; mask++) {
      const hand = all.filter((_, i) => mask & (1 << i));
      if (hand.length < 5) continue;
      expect(
        findSuggestedSets(reinforce(hand), "a", catalog()).length,
        hand.join(),
      ).toBeGreaterThan(0);
    }
  });
});

function catalog() {
  return new Map(cardCatalog(testland, testlandRules).map((c) => [c.id, c]));
}

describe("findSuggestedSets", () => {
  const suggest = (hand: string[]) => findSuggestedSets(reinforce(hand), "a", catalog());

  it("gives at most one set per trade value, best value first", () => {
    expect(suggest([...INF, CAV[0]!, ART[0]!])).toEqual([
      {
        cardIds: ["card-eisenfurt", "card-rabenhain", "card-grauwacht"],
        value: 10,
        bonusTerritoryId: "eisenfurt",
      },
      { cardIds: INF, value: 4, bonusTerritoryId: "eisenfurt" },
    ]);
  });

  it("is empty without a hand or without a set", () => {
    expect(suggest([])).toEqual([]);
    expect(suggest([INF[0]!, INF[1]!, CAV[0]!])).toEqual([]);
  });

  it("prefers a set with a territory bonus over one without, even later in the hand", () => {
    // kupferstadt, salzmoor, grauwacht belong to b (no bonus); eisenfurt is a's.
    const hand = ["card-kupferstadt", "card-salzmoor", "card-grauwacht", "card-eisenfurt"];
    expect(suggest(hand)).toEqual([
      {
        cardIds: ["card-salzmoor", "card-grauwacht", "card-eisenfurt"],
        value: 10,
        bonusTerritoryId: "eisenfurt",
      },
    ]);
  });

  it("with the same bonus prefers fewer jokers, even later in the hand", () => {
    const hand = [J1, "card-eisenfurt", "card-rabenhain", "card-grauwacht"];
    expect(suggest(hand)).toEqual([
      {
        cardIds: ["card-eisenfurt", "card-rabenhain", "card-grauwacht"],
        value: 10,
        bonusTerritoryId: "eisenfurt",
      },
    ]);
  });

  it("otherwise follows the order of the cards in the hand", () => {
    const hand = ["card-rabenhain", "card-eisenfurt", "card-grauwacht", "card-tannenfeld"];
    expect(suggest(hand)).toEqual([
      {
        cardIds: ["card-rabenhain", "card-eisenfurt", "card-grauwacht"],
        value: 10,
        bonusTerritoryId: "rabenhain",
      },
    ]);
  });

  it("never gives more than 4 sets, whatever the hand size", () => {
    const rules = { ...testlandRules, cards: { ...testlandRules.cards, jokers: 36 } };
    const all = cardCatalog(testland, rules).map((c) => c.id);
    const s = reinforce(all, { rules });
    const sets = findSuggestedSets(
      s,
      "a",
      new Map(cardCatalog(testland, rules).map((c) => [c.id, c])),
    );
    expect(sets.length).toBeLessThanOrEqual(4);
    expect(new Set(sets.map((x) => x.value)).size).toBe(sets.length);
  });
});

describe("free choice of cards", () => {
  // Suggested for this hand: salzmoor + grauwacht + eisenfurt (10, with bonus).
  const hand = ["card-kupferstadt", "card-salzmoor", "card-grauwacht", "card-eisenfurt"];

  it("accepts a valid set that is not among the suggestions", () => {
    const s = reinforce(hand);
    const notSuggested = ["card-kupferstadt", "card-salzmoor", "card-grauwacht"];
    const next = ok(s, trade(notSuggested));
    expect(next.reinforcementsLeft).toBe(3 + 10);
    expect(next.lastTrade!.bonusTerritoryId).toBeNull();
    expect(next.secret.hand["a"]).toEqual(["card-eisenfurt"]);
  });

  it("rejects an invalid free choice with INVALID_SET", () => {
    const s = reinforce(hand);
    expect(code(s, trade(["card-kupferstadt", "card-eisenfurt", "card-salzmoor"]))).toBe(
      "INVALID_SET",
    );
  });
});

describe("unknown map", () => {
  it("fortify and tradeCards answer UNKNOWN_MAP at their documented position", () => {
    const f = { ...reinforce(INF), mapId: "nowhere" };
    // tradeCards: right after the phase check, before the card checks.
    expect(code(f, trade(["x"]))).toBe("UNKNOWN_MAP");
    expect(code({ ...f, phase: "attack" }, trade(["x"]))).toBe("WRONG_PHASE");
    // fortify: after SAME_TERRITORY, where the map is first needed.
    const g = makeState({
      phase: "fortify",
      territories: { eisenfurt: ["a", 3], rabenhain: ["a", 1] },
      overrides: { mapId: "nowhere" },
    });
    expect(code(g, { type: "fortify", from: "eisenfurt", to: "eisenfurt", count: 1 })).toBe(
      "SAME_TERRITORY",
    );
    expect(code(g, { type: "fortify", from: "eisenfurt", to: "rabenhain", count: 1 })).toBe(
      "UNKNOWN_MAP",
    );
  });
});
