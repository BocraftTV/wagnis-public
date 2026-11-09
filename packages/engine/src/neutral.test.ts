import { describe, expect, it } from "vitest";
import {
  applyAction,
  calculateReinforcements,
  createDiceRng,
  createGame,
  createSeededRng,
  testland,
  testlandRules,
  viewFor,
} from "./index.js";
import type { Action, GameEvent, GameState, Rng } from "./index.js";
import { makeState, withCards } from "./testkit.js";

// testland: eisenfurt-rabenhain, eisenfurt-grauwacht, rabenhain-tannenfeld, grauwacht-tannenfeld,
// grauwacht-salzmoor, salzmoor-dornental, salzmoor-kupferstadt, dornental-nebelkueste, kupferstadt-nebelkueste.

const start = (players: string[], seed: number): GameState => {
  const r = createGame({
    map: testland,
    rules: testlandRules,
    playerIds: players,
    rng: createSeededRng(seed),
  });
  if (!r.ok) throw new Error(r.code);
  return r.state;
};

const noRng: Rng = {
  int: () => {
    throw new Error("rng used");
  },
};

function ok(s: GameState, action: Action, faces: number[] = [], player = s.activePlayerId) {
  const r = applyAction(s, player, action, faces.length ? createDiceRng(faces) : noRng);
  if (!r.ok) throw new Error(`unexpected ${r.code}`);
  return r;
}
const codeOf = (s: GameState, action: Action, player = s.activePlayerId) => {
  const r = applyAction(s, player, action, noRng);
  return r.ok ? "OK" : r.code;
};
const types = (events: GameEvent[]) => events.map((e) => e.type);

describe("2 players: the start with a neutral owner", () => {
  it("deals three owners; counts differ by at most 1 and every owner has the start armies (seeds 1-200)", () => {
    for (let seed = 1; seed <= 200; seed++) {
      const s = start(["p1", "p2"], seed);
      const counts = new Map<string | null, number>();
      const armies = new Map<string | null, number>();
      for (const t of Object.values(s.territories)) {
        counts.set(t.ownerId, (counts.get(t.ownerId) ?? 0) + 1);
        armies.set(t.ownerId, (armies.get(t.ownerId) ?? 0) + t.armies);
        expect(t.armies).toBeGreaterThanOrEqual(1);
      }
      const owners: (string | null)[] = ["p1", "p2", null];
      const values = owners.map((o) => counts.get(o) ?? 0);
      expect(Math.max(...values) - Math.min(...values), `seed ${seed}`).toBeLessThanOrEqual(1);
      expect(values.reduce((a, b) => a + b, 0)).toBe(8);
      expect([...counts.keys()].sort()).toEqual([null, "p1", "p2"]);
      for (const o of owners)
        expect(armies.get(o), `seed ${seed} ${o}`).toBe(testlandRules.startArmies[2]);
      // 8 territories over 3 owners: 3, 3, 2 in dealing order (p1, p2, neutral)
      expect(values).toEqual([3, 3, 2]);
    }
  });

  it("is deterministic for the same seed and differs for another", () => {
    expect(start(["p1", "p2"], 42)).toEqual(start(["p1", "p2"], 42));
    expect(start(["p1", "p2"], 42).territories).not.toEqual(start(["p1", "p2"], 43).territories);
  });

  it("neutral is no seat: not in the order, not active, no hand, no mission, not in handCounts", () => {
    for (let seed = 1; seed <= 30; seed++) {
      const s = start(["p1", "p2"], seed);
      expect([...s.playerOrder].sort()).toEqual(["p1", "p2"]);
      expect(s.playerOrder).not.toContain(null);
      expect(s.activePlayerId === "p1" || s.activePlayerId === "p2").toBe(true);
      expect(Object.keys(s.secret.hand).sort()).toEqual(["p1", "p2"]);
      expect(Object.keys(s.secret.mission).sort()).toEqual(["p1", "p2"]);
      const view = viewFor(s, "p1");
      expect(Object.keys(view.handCounts).sort()).toEqual(["p1", "p2"]);
      expect(view.playerOrder).toEqual(s.playerOrder);
      const neutral = Object.values(view.territories).filter((t) => t.ownerId === null);
      expect(neutral).toHaveLength(2);
    }
  });

  it("3 to 6 players get no neutral owner", () => {
    for (const n of [3, 4, 5, 6]) {
      for (let seed = 1; seed <= 20; seed++) {
        const ids = ["p1", "p2", "p3", "p4", "p5", "p6"].slice(0, n);
        const s = start(ids, seed);
        expect(Object.values(s.territories).every((t) => t.ownerId !== null)).toBe(true);
      }
    }
  });

  it("rejects start armies below ceil(territories / 3) for 2 players", () => {
    const rules = { ...testlandRules, startArmies: { ...testlandRules.startArmies, 2: 2 } };
    expect(
      createGame({ map: testland, rules, playerIds: ["a", "b"], rng: createSeededRng(1) }),
    ).toEqual({
      ok: false,
      code: "INVALID_RULES",
    });
  });
});

describe("attacking a neutral territory", () => {
  /** a attacks the neutral rabenhain from eisenfurt. */
  const duel = (defenderArmies: number, overrides: Partial<GameState> = {}) =>
    makeState({
      territories: { eisenfurt: ["a", 5], rabenhain: [null, defenderArmies] },
      fill: "b",
      overrides,
    });
  const attack = (dice: number): Action => ({
    type: "attack",
    from: "eisenfurt",
    to: "rabenhain",
    dice,
  });

  it("is a normal attack: the neutral defender rolls the maximum (1 die with 1 army, 2 with 2 or more)", () => {
    // Attacker 6-5-4; the neutral die comes next in the fixed sequence
    const one = ok(duel(1), attack(3), [6, 5, 4, 3]);
    const ev1 = one.events.find((e) => e.type === "attackRolled")!;
    expect(ev1).toMatchObject({ defenderId: null, defenderDice: [3], defenderLosses: 1 });
    for (const armies of [2, 3, 7]) {
      const r = ok(duel(armies), attack(3), [6, 5, 4, 2, 1]);
      const ev = r.events.find((e) => e.type === "attackRolled")!;
      expect(ev).toMatchObject({ defenderId: null, defenderDice: [2, 1] });
    }
  });

  it("uses the dice sequence exactly: 3 + 1 faces for 1 army, 3 + 2 for 2 armies", () => {
    expect(() => ok(duel(1), attack(3), [6, 5, 4])).toThrow(/exhausted/);
    expect(() => ok(duel(2), attack(3), [6, 5, 4, 1])).toThrow(/exhausted/);
    const r1 = applyAction(duel(1), "a", attack(3), createDiceRng([6, 5, 4, 1]));
    const r2 = applyAction(duel(2), "a", attack(3), createDiceRng([6, 5, 4, 1, 1]));
    expect(r1.ok && r2.ok).toBe(true);
  });

  it("puts null as defender into the combat record and the view", () => {
    const r = ok(duel(3), attack(3), [6, 5, 4, 3, 2]);
    expect(r.state.lastCombat!.defenderId).toBeNull();
    expect(viewFor(r.state, "b").lastCombat!.defenderId).toBeNull();
    expect(viewFor(r.state, "a").territories["rabenhain"]!.ownerId).toBeNull();
  });

  it("a conquest hands the territory to the attacker, sets conqueredThisTurn and needs no elimination", () => {
    const r = ok(duel(1), attack(3), [6, 5, 4, 1]);
    expect(r.state.territories["rabenhain"]!.ownerId).toBe("a");
    expect(r.state.conqueredThisTurn).toBe(true);
    expect(r.events).toContainEqual(
      expect.objectContaining({ type: "territoryConquered", previousOwnerId: null }),
    );
    expect(types(r.events)).not.toContain("playerEliminated");
    expect(r.state.pendingOccupation).toMatchObject({ from: "eisenfurt", to: "rabenhain" });
  });

  it("wiping out the last neutral territory: no card, no event, no mission change, the game goes on", () => {
    const s = withCards(duel(1, { secret: { ...duel(1).secret, mission: { a: null, b: null } } }), {
      hand: { a: ["card-joker-1"], b: ["card-joker-2"] },
    });
    const before = structuredClone(s);
    // every other territory belongs to b, so b is not eliminated either
    const r = ok(s, attack(3), [6, 5, 4, 1]);
    expect(Object.values(r.state.territories).some((t) => t.ownerId === null)).toBe(false);
    expect(types(r.events)).not.toContain("playerEliminated");
    expect(types(r.events)).not.toContain("cardsTaken");
    expect(r.state.secret.hand).toEqual(before.secret.hand);
    expect(r.state.secret.mission).toEqual(before.secret.mission);
    expect(r.state.secret.missionReplaced).toEqual(before.secret.missionReplaced);
    expect(r.state.winnerId).toBeNull();
  });

  it("the conquest of neutral counts for the card draw at the end of the turn", () => {
    const attacked = ok(duel(1), attack(3), [6, 5, 4, 1]).state;
    const done = ok(attacked, { type: "occupy", count: 4 }).state;
    const withDeck = withCards(done, { deck: ["card-salzmoor", "card-dornental"], discard: [] });
    const toFortify = ok(withDeck, { type: "endPhase" }).state;
    const ended = ok(toFortify, { type: "endPhase" });
    expect(ended.state.secret.hand["a"]).toEqual(["card-salzmoor"]);
    expect(types(ended.events)).toContain("cardDrawn");
    expect(ended.state.activePlayerId).toBe("b");
  });
});

describe("neutral owner in the other actions", () => {
  const s = makeState({
    territories: {
      eisenfurt: ["a", 5],
      rabenhain: [null, 3],
      tannenfeld: ["a", 2],
      grauwacht: ["a", 2],
    },
    fill: "b",
  });

  it("cannot attack, receive armies or be fortified", () => {
    expect(codeOf(s, { type: "attack", from: "rabenhain", to: "eisenfurt", dice: 1 })).toBe(
      "NOT_OWNER",
    );
    expect(codeOf(s, { type: "blitz", from: "rabenhain", to: "eisenfurt" })).toBe("NOT_OWNER");
    const reinforce = { ...s, phase: "reinforce" as const, reinforcementsLeft: 3 };
    expect(codeOf(reinforce, { type: "placeArmies", territoryId: "rabenhain", count: 1 })).toBe(
      "NOT_OWNER",
    );
    const fortify = { ...s, phase: "fortify" as const };
    expect(codeOf(fortify, { type: "fortify", from: "eisenfurt", to: "rabenhain", count: 1 })).toBe(
      "NOT_OWNER",
    );
    expect(codeOf(fortify, { type: "fortify", from: "rabenhain", to: "eisenfurt", count: 1 })).toBe(
      "NOT_OWNER",
    );
  });

  it("interrupts a fortify chain: neutral territories are not own", () => {
    // eisenfurt - rabenhain(neutral) - tannenfeld; eisenfurt - grauwacht - tannenfeld is a second way
    const cut = makeState({
      phase: "fortify",
      territories: { eisenfurt: ["a", 4], rabenhain: [null, 1], tannenfeld: ["a", 2] },
      fill: "b",
    });
    expect(codeOf(cut, { type: "fortify", from: "eisenfurt", to: "tannenfeld", count: 1 })).toBe(
      "NOT_CONNECTED",
    );
    const view = viewFor(cut, "a");
    expect(view.fortify).toEqual({ reach: "connected", groups: [] });
  });

  it("neutral territories get no reinforcements and complete no continent", () => {
    // a owns all of nordreich except tannenfeld, which is neutral: no continent bonus, 3 own territories
    const t = makeState({
      territories: {
        eisenfurt: ["a", 1],
        rabenhain: ["a", 1],
        grauwacht: ["a", 1],
        tannenfeld: [null, 1],
      },
      fill: "b",
    });
    expect(calculateReinforcements(testland, testlandRules, t.territories, "a")).toBe(3);
    const full = makeState({
      territories: {
        eisenfurt: ["a", 1],
        rabenhain: ["a", 1],
        grauwacht: ["a", 1],
        tannenfeld: ["a", 1],
      },
      fill: null,
    });
    expect(calculateReinforcements(testland, testlandRules, full.territories, "a")).toBe(3 + 2);
  });

  it("the turn passes between the two players only", () => {
    const g = start(["p1", "p2"], 3);
    let state = g;
    const seen = new Set<string>();
    for (let i = 0; i < 6; i++) {
      seen.add(state.activePlayerId);
      let r = state;
      // reinforce everything on the first own territory, then skip through the phases
      const own = Object.entries(r.territories).find(([, t]) => t.ownerId === r.activePlayerId)![0];
      r = ok(r, { type: "placeArmies", territoryId: own, count: r.reinforcementsLeft }).state;
      r = ok(r, { type: "endPhase" }).state;
      r = ok(r, { type: "endPhase" }).state;
      state = ok(r, { type: "endPhase" }).state;
      expect(state.playerOrder).toContain(state.activePlayerId);
    }
    expect([...seen].sort()).toEqual(["p1", "p2"]);
  });
});
