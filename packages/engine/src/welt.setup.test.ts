import { describe, expect, it } from "vitest";
import { createGame, createSeededRng, getRules, welt, weltRules } from "./index.js";
import type { GameState, RuleConfig } from "./index.js";

const ids = ["p1", "p2", "p3", "p4", "p5", "p6"];
const SEEDS = Array.from({ length: 200 }, (_, i) => i + 1);

/** Territories per owner (the dealing is round-robin over the owners; 2 players have neutral as third owner). */
const EXPECTED_COUNTS: Record<number, number[]> = {
  2: [14, 14, 14],
  3: [14, 14, 14],
  4: [11, 11, 10, 10],
  5: [9, 9, 8, 8, 8],
  6: [7, 7, 7, 7, 7, 7],
};

// Owners of the first six territories for seed 3, taken once from the generated state (the dealing uses only the Rng).
const EXPECTED_OWNERS_SEED_3 = ["p1", "p2", "p3", "p1", "p2", "p2"];

const domination: RuleConfig = { ...weltRules, victoryMode: "domination" };

function start(n: number, seed: number, rules: RuleConfig = domination): GameState {
  const r = createGame({
    map: welt,
    rules,
    playerIds: ids.slice(0, n),
    rng: createSeededRng(seed),
  });
  if (!r.ok) throw new Error(r.code);
  return r.state;
}

describe("weltRules", () => {
  it("pins the start army table and the shared values", () => {
    expect(weltRules.startArmies).toEqual({ 2: 40, 3: 35, 4: 30, 5: 25, 6: 20 });
    expect(weltRules.minReinforcement).toBe(3);
    expect(weltRules.territoryDivisor).toBe(3);
    expect(weltRules.initialPlacement).toBe("auto");
    expect(weltRules.fortifyReach).toBe("connected");
    expect(weltRules.victoryMode).toBe("missions");
    expect(weltRules.cards.jokers).toBe(2);
    expect(weltRules.cards.mustTradeAt).toBe(5);
    expect(getRules("welt")).toBe(weltRules);
    expect(getRules("nirgendwo")).toBeUndefined();
  });

  it.each([2, 3, 4, 5, 6])("%i players: startArmies covers one army per territory", (n) => {
    const owners = n === 2 ? 3 : n;
    expect(weltRules.startArmies[n]!).toBeGreaterThanOrEqual(Math.ceil(42 / owners));
  });
});

describe("createGame on welt", () => {
  it.each([2, 3, 4, 5, 6])(
    "%i players: territory counts per owner, start armies, at least 1 army everywhere",
    (n) => {
      for (const seed of SEEDS) {
        const state = start(n, seed);
        expect(Object.keys(state.territories)).toHaveLength(42);
        const counts = new Map<string | null, number>();
        const armies = new Map<string | null, number>();
        for (const t of Object.values(state.territories)) {
          counts.set(t.ownerId, (counts.get(t.ownerId) ?? 0) + 1);
          armies.set(t.ownerId, (armies.get(t.ownerId) ?? 0) + t.armies);
          expect(t.armies).toBeGreaterThanOrEqual(1);
        }
        const owners = n === 2 ? [...ids.slice(0, 2), null] : ids.slice(0, n);
        const values = owners.map((o) => counts.get(o) ?? 0);
        expect(Math.max(...values) - Math.min(...values)).toBeLessThanOrEqual(1);
        expect([...values].sort((a, b) => b - a)).toEqual(EXPECTED_COUNTS[n]);
        for (const o of owners)
          expect(armies.get(o), `seed ${seed}`).toBe(weltRules.startArmies[n]);
        // neutral exists only with 2 players
        expect(counts.has(null)).toBe(n === 2);
      }
    },
  );

  it("is deterministic for the same seed", () => {
    expect(start(3, 7)).toEqual(start(3, 7));
    expect(start(3, 7)).not.toEqual(start(3, 8));
  });

  it("deals 44 shuffled cards", () => {
    const state = start(4, 5);
    expect(state.secret.deck).toHaveLength(44);
    expect(new Set(state.secret.deck).size).toBe(44);
  });

  it("starts the first player with the territory share of reinforcements (3 players)", () => {
    // 14 territories / 3 = 4 (+ continent bonuses held at the start, if any)
    const state = start(3, 11);
    expect(state.reinforcementsLeft).toBeGreaterThanOrEqual(4);
    expect(state.phase).toBe("reinforce");
  });

  it("rejects start armies below one per territory with INVALID_RULES", () => {
    const low = (n: number, value: number): RuleConfig => ({
      ...domination,
      startArmies: { ...weltRules.startArmies, [n]: value },
    });
    const run = (n: number, rules: RuleConfig) =>
      createGame({ map: welt, rules, playerIds: ids.slice(0, n), rng: createSeededRng(1) });
    expect(run(2, low(2, 13))).toEqual({ ok: false, code: "INVALID_RULES" });
    expect(run(2, low(2, 14)).ok).toBe(true);
    expect(run(4, low(4, 10))).toEqual({ ok: false, code: "INVALID_RULES" });
    expect(run(4, low(4, 11)).ok).toBe(true);
    expect(run(3, low(3, 13))).toEqual({ ok: false, code: "INVALID_RULES" });
    expect(run(3, low(3, 14)).ok).toBe(true);
    expect(run(5, low(5, 8))).toEqual({ ok: false, code: "INVALID_RULES" });
    expect(run(5, low(5, 9)).ok).toBe(true);
    expect(run(6, low(6, 6))).toEqual({ ok: false, code: "INVALID_RULES" });
    expect(run(6, low(6, 7)).ok).toBe(true);
  });

  it("pins the owners of the first six territories for seed 3 with 3 players", () => {
    const state = start(3, 3);
    expect(welt.territories.slice(0, 6).map((t) => state.territories[t.id]!.ownerId)).toEqual(
      EXPECTED_OWNERS_SEED_3,
    );
  });
});
