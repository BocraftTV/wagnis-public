import { describe, expect, it } from "vitest";
import {
  cardCatalog,
  createGame,
  createSeededRng,
  normalizeState,
  testland,
  testlandRules,
} from "./index.js";
import type { GameState, Rng } from "./index.js";

function fresh(): GameState {
  const r = createGame({
    map: testland,
    rules: testlandRules,
    playerIds: ["a", "b"],
    rng: createSeededRng(1),
  });
  if (!r.ok) throw new Error(r.code);
  return r.state;
}

/** Rng that must not be used. */
const noRng: Rng = {
  int: () => {
    throw new Error("rng used");
  },
};

/** A state as phase 2 saved it: no card fields, no `fortifyReach`/`cards` rules. */
function phase2(s: GameState): Record<string, unknown> {
  const legacy: Record<string, unknown> = JSON.parse(JSON.stringify(s));
  delete legacy["lastTrade"];
  delete legacy["tradeSeq"];
  const rules = legacy["rules"] as Record<string, unknown>;
  delete rules["fortifyReach"];
  delete rules["cards"];
  const secret = legacy["secret"] as Record<string, unknown>;
  delete secret["deck"];
  delete secret["discard"];
  return legacy;
}

describe("createGame start values", () => {
  it("starts without attack and card state", () => {
    const s = fresh();
    expect(s.pendingOccupation).toBeNull();
    expect(s.conqueredThisTurn).toBe(false);
    expect(s.winnerId).toBeNull();
    expect(s.lastCombat).toBeNull();
    expect(s.combatSeq).toBe(0);
    expect(s.lastTrade).toBeNull();
    expect(s.tradeSeq).toBe(0);
    expect(s.secret.discard).toEqual([]);
    expect(s.secret.hand).toEqual({ a: [], b: [] });
  });

  it("puts every catalog card in the shuffled deck exactly once", () => {
    const ids = cardCatalog(testland, testlandRules).map((c) => c.id);
    const deck = fresh().secret.deck;
    expect(deck).toHaveLength(10);
    expect([...deck].sort()).toEqual([...ids].sort());
    expect(deck).not.toEqual(ids);
  });
});

describe("normalizeState", () => {
  it("adds defaults to a phase 1 state", () => {
    const s = fresh();
    const legacy = phase2(s);
    for (const key of [
      "pendingOccupation",
      "conqueredThisTurn",
      "winnerId",
      "lastCombat",
      "combatSeq",
    ]) {
      delete legacy[key];
    }
    const n = normalizeState(legacy as unknown as GameState, createSeededRng(2));
    expect({ ...n, secret: { ...n.secret, deck: [] } }).toEqual({
      ...s,
      secret: { ...s.secret, deck: [] },
    });
    expect([...n.secret.deck].sort()).toEqual([...s.secret.deck].sort());
  });

  it("gives a phase 2 state defaults, empty hands and a deck shuffled over the injected rng", () => {
    const s = fresh();
    const a = normalizeState(phase2(s) as unknown as GameState, createSeededRng(11));
    const b = normalizeState(phase2(s) as unknown as GameState, createSeededRng(11));
    expect(a.rules.fortifyReach).toBe("connected");
    expect(a.rules.cards).toEqual(testlandRules.cards);
    expect(a.secret.hand).toEqual({ a: [], b: [] });
    expect(a.secret.discard).toEqual([]);
    expect(a.lastTrade).toBeNull();
    expect(a.tradeSeq).toBe(0);
    expect(a.secret.deck).toHaveLength(10);
    expect(a.secret.deck).toEqual(b.secret.deck);
    const c = normalizeState(phase2(s) as unknown as GameState, createSeededRng(12));
    expect(c.secret.deck).not.toEqual(a.secret.deck);
  });

  it("keeps the mid-turn flags of a phase 2 state", () => {
    const legacy = { ...phase2(fresh()), conqueredThisTurn: true, phase: "fortify" };
    const n = normalizeState(legacy as unknown as GameState, createSeededRng(3));
    expect(n.conqueredThisTurn).toBe(true);
    expect(n.phase).toBe("fortify");
  });

  it("leaves a complete state unchanged and uses no rng", () => {
    const s: GameState = {
      ...fresh(),
      pendingOccupation: { from: "eisenfurt", to: "rabenhain", min: 2 },
      conqueredThisTurn: true,
      winnerId: "a",
      combatSeq: 4,
      lastCombat: {
        seq: 4,
        attackerId: "a",
        defenderId: "b",
        from: "eisenfurt",
        to: "rabenhain",
        rolls: [{ attackerDice: [6, 1], defenderDice: [3], attackerLosses: 0, defenderLosses: 1 }],
        summary: { rollCount: 1, attackerLosses: 0, defenderLosses: 1, conquered: true },
      },
      tradeSeq: 2,
    };
    expect(normalizeState(structuredClone(s), noRng)).toEqual(s);
  });
});
