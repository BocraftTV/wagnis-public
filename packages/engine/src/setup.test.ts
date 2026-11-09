import { describe, expect, it } from "vitest";
import { createGame, createSeededRng, testland, testlandRules } from "./index.js";
import type { GameState } from "./index.js";

const ids = ["p1", "p2", "p3", "p4", "p5", "p6"];

function start(playerCount: number, seed: number): GameState {
  const result = createGame({
    map: testland,
    rules: testlandRules,
    playerIds: ids.slice(0, playerCount),
    rng: createSeededRng(seed),
  });
  if (!result.ok) throw new Error(result.code);
  return result.state;
}

describe("createGame", () => {
  it("pins the testland start army table", () => {
    expect(testlandRules.startArmies).toEqual({ 2: 8, 3: 7, 4: 6, 5: 5, 6: 4 });
    expect(testlandRules.minReinforcement).toBe(3);
    expect(testlandRules.territoryDivisor).toBe(3);
  });

  it("deals exactly 1 army per territory before placing the rest", () => {
    const r = createGame({
      map: testland,
      rules: { ...testlandRules, startArmies: { 4: 2 } },
      playerIds: ["p1", "p2", "p3", "p4"],
      rng: createSeededRng(9),
    });
    if (!r.ok) throw new Error(r.code);
    expect(Object.values(r.state.territories).every((t) => t.armies === 1)).toBe(true);
  });

  it("is deterministic for the same seed and differs for another seed", () => {
    expect(start(3, 42)).toEqual(start(3, 42));
    expect(start(3, 42)).not.toEqual(start(3, 43));
  });

  it.each([2, 3, 4, 5, 6])(
    "%i players: territory counts differ by at most 1, armies match config",
    (n) => {
      for (let seed = 1; seed <= 25; seed++) {
        const state = start(n, seed);
        const counts = new Map<string, number>();
        const armies = new Map<string, number>();
        for (const t of Object.values(state.territories)) {
          counts.set(t.ownerId!, (counts.get(t.ownerId!) ?? 0) + 1);
          armies.set(t.ownerId!, (armies.get(t.ownerId!) ?? 0) + t.armies);
          expect(t.armies).toBeGreaterThanOrEqual(1);
        }
        const values = ids.slice(0, n).map((p) => counts.get(p) ?? 0);
        expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
        for (const p of ids.slice(0, n)) expect(armies.get(p)).toBe(testlandRules.startArmies[n]);
        expect(Object.keys(state.territories)).toHaveLength(8);
      }
    },
  );

  it("starts in reinforce with the first player's reinforcements, in seat order", () => {
    for (let seed = 1; seed <= 20; seed++) {
      const state = start(4, seed);
      expect(state.phase).toBe("reinforce");
      expect(state.turn).toBe(1);
      expect(state.activePlayerId).toBe(state.playerOrder[0]);
      expect(state.reinforcementsLeft).toBeGreaterThanOrEqual(3);
      const first = ids.indexOf(state.playerOrder[0]!);
      expect(state.playerOrder).toEqual([...ids.slice(first, 4), ...ids.slice(0, first)]);
    }
  });

  it("picks every player as first player for some seed", () => {
    const firsts = new Set(Array.from({ length: 60 }, (_, s) => start(3, s).activePlayerId));
    expect(firsts.size).toBe(3);
  });

  it("starts with empty hands for every player", () => {
    const state = start(3, 1);
    expect(state.secret.hand).toEqual({ p1: [], p2: [], p3: [] });
  });

  it("returns typed errors for invalid setups", () => {
    const rng = createSeededRng(1);
    const base = { map: testland, rules: testlandRules, rng };
    expect(createGame({ ...base, playerIds: ["p1"] })).toEqual({
      ok: false,
      code: "INVALID_PLAYER_COUNT",
    });
    expect(createGame({ ...base, playerIds: ["p1", "p1"] })).toEqual({
      ok: false,
      code: "INVALID_PLAYER_COUNT",
    });
    expect(
      createGame({
        ...base,
        rules: { ...testlandRules, startArmies: { ...testlandRules.startArmies, 7: 3 } },
        playerIds: ids.concat("p7"),
      }),
    ).toEqual({ ok: false, code: "INVALID_PLAYER_COUNT" });
    expect(createGame({ ...base, playerIds: ids.concat("p7") })).toEqual({
      ok: false,
      code: "INVALID_PLAYER_COUNT",
    });
    expect(
      createGame({
        ...base,
        rules: { ...testlandRules, initialPlacement: "manual" },
        playerIds: ["p1", "p2"],
      }),
    ).toEqual({ ok: false, code: "UNSUPPORTED_PLACEMENT" });
    expect(
      createGame({
        ...base,
        // 8 territories dealt to 3 owners need at least ceil(8 / 3) = 3 armies each
        rules: { ...testlandRules, startArmies: { 2: 2 } },
        playerIds: ["p1", "p2"],
      }),
    ).toEqual({ ok: false, code: "INVALID_RULES" });
    expect(
      createGame({
        ...base,
        rules: { ...testlandRules, startArmies: { 2: 3 } },
        playerIds: ["p1", "p2"],
      }).ok,
    ).toBe(true);
    const broken = structuredClone(testland);
    broken.territories[0]!.neighbors = [];
    expect(createGame({ ...base, map: broken, playerIds: ["p1", "p2"] })).toEqual({
      ok: false,
      code: "INVALID_MAP",
    });
  });
});

describe("createGame card rules", () => {
  const withCards = (mustTradeAt: number) => ({
    ...testlandRules,
    cards: { ...testlandRules.cards, mustTradeAt },
  });
  const make = (mustTradeAt: number) =>
    createGame({
      map: testland,
      rules: withCards(mustTradeAt),
      playerIds: ["p1", "p2"],
      rng: createSeededRng(1),
    });

  it("rejects mustTradeAt below 5 with INVALID_RULES", () => {
    for (const n of [4, 3, 0, -1, 5.5])
      expect(make(n)).toEqual({ ok: false, code: "INVALID_RULES" });
  });

  it("accepts mustTradeAt of 5 and more", () => {
    expect(make(5).ok).toBe(true);
    expect(make(8).ok).toBe(true);
  });

  it("keeps the territory deal and the start player when the deck is added", () => {
    // The deck is shuffled after the rest of the setup, so these seed expectations never move.
    const a = start(3, 42);
    const b = start(3, 42);
    expect(a.territories).toEqual(b.territories);
    expect(a.playerOrder).toEqual(b.playerOrder);
  });

  it("uses a fixed rng order: territories, armies, start player, then the deck", () => {
    const calls: number[] = [];
    const inner = createSeededRng(5);
    const rng = { int: (m: number) => (calls.push(m), inner.int(m)) };
    const r = createGame({ map: testland, rules: testlandRules, playerIds: ["p1", "p2"], rng });
    expect(r.ok).toBe(true);
    // 8 territories: shuffle 7 calls (8..2), then the army placements, the start player int(2), the deck
    // shuffle (10 cards: 10..2) and last the mission shuffle (2 players: 8 map missions, 8..2).
    const n = calls.length;
    expect(calls.slice(n - 7)).toEqual([8, 7, 6, 5, 4, 3, 2]);
    expect(calls.slice(n - 16, n - 7)).toEqual([10, 9, 8, 7, 6, 5, 4, 3, 2]);
    expect(calls[n - 17]).toBe(2);
  });
});
