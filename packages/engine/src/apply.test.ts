import { describe, expect, it } from "vitest";
import { applyAction, createGame, createSeededRng, testland, testlandRules } from "./index.js";
import type { Action, GameState } from "./index.js";

const rng = createSeededRng(7);

function game(): GameState {
  const r = createGame({
    map: testland,
    rules: testlandRules,
    playerIds: ["a", "b"],
    rng: createSeededRng(3),
  });
  if (!r.ok) throw new Error(r.code);
  return r.state;
}
const ownTerritory = (s: GameState, p: string) =>
  Object.keys(s.territories).find((id) => s.territories[id]!.ownerId === p)!;
const other = (s: GameState) => s.playerOrder.find((p) => p !== s.activePlayerId)!;

function ok(state: GameState, player: string, action: Action): GameState {
  const r = applyAction(state, player, action, rng);
  if (!r.ok) throw new Error(`unexpected ${r.code}`);
  return r.state;
}

describe("applyAction", () => {
  it("placeArmies adds armies, reduces the pool and emits an event", () => {
    const s = game();
    const t = ownTerritory(s, s.activePlayerId);
    const r = applyAction(
      s,
      s.activePlayerId,
      { type: "placeArmies", territoryId: t, count: 2 },
      rng,
    );
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.state.territories[t]!.armies).toBe(s.territories[t]!.armies + 2);
      expect(r.state.reinforcementsLeft).toBe(s.reinforcementsLeft - 2);
      expect(r.events).toEqual([
        { type: "armiesPlaced", playerId: s.activePlayerId, territoryId: t, count: 2 },
      ]);
    }
  });

  it("does not mutate the input state", () => {
    const s = game();
    const copy = structuredClone(s);
    ok(s, s.activePlayerId, {
      type: "placeArmies",
      territoryId: ownTerritory(s, s.activePlayerId),
      count: 1,
    });
    expect(s).toEqual(copy);
  });

  const codeOf = (s: GameState, p: string, a: Action) => {
    const r = applyAction(s, p, a, rng);
    return r.ok ? "OK" : r.code;
  };

  it("returns typed errors instead of throwing", () => {
    const s = game();
    const me = s.activePlayerId;
    const mine = ownTerritory(s, me);
    const theirs = ownTerritory(s, other(s));
    expect(codeOf(s, other(s), { type: "endPhase" })).toBe("NOT_YOUR_TURN");
    expect(codeOf(s, other(s), { type: "placeArmies", territoryId: theirs, count: 1 })).toBe(
      "NOT_YOUR_TURN",
    );
    expect(codeOf(s, me, { type: "placeArmies", territoryId: "atlantis", count: 1 })).toBe(
      "UNKNOWN_TERRITORY",
    );
    expect(codeOf(s, me, { type: "placeArmies", territoryId: theirs, count: 1 })).toBe("NOT_OWNER");
    expect(codeOf(s, me, { type: "placeArmies", territoryId: mine, count: 0 })).toBe(
      "INVALID_COUNT",
    );
    expect(codeOf(s, me, { type: "placeArmies", territoryId: mine, count: -1 })).toBe(
      "INVALID_COUNT",
    );
    expect(codeOf(s, me, { type: "placeArmies", territoryId: mine, count: 1.5 })).toBe(
      "INVALID_COUNT",
    );
    expect(
      codeOf(s, me, { type: "placeArmies", territoryId: mine, count: s.reinforcementsLeft + 1 }),
    ).toBe("NOT_ENOUGH_REINFORCEMENTS");
    expect(codeOf(s, me, { type: "endPhase" })).toBe("REINFORCEMENTS_REMAINING");
    expect(codeOf(s, me, { type: "nonsense" } as unknown as Action)).toBe("UNKNOWN_ACTION");
  });

  it("walks reinforce -> attack -> fortify -> next player's reinforce", () => {
    let s = game();
    const first = s.activePlayerId;
    const mine = ownTerritory(s, first);
    s = ok(s, first, { type: "placeArmies", territoryId: mine, count: s.reinforcementsLeft });
    expect(s.reinforcementsLeft).toBe(0);
    s = ok(s, first, { type: "endPhase" });
    expect(s.phase).toBe("attack");
    expect(codeOf(s, first, { type: "placeArmies", territoryId: mine, count: 1 })).toBe(
      "WRONG_PHASE",
    );
    s = ok(s, first, { type: "endPhase" });
    expect(s.phase).toBe("fortify");
    expect(codeOf(s, first, { type: "placeArmies", territoryId: mine, count: 1 })).toBe(
      "WRONG_PHASE",
    );
    s = ok(s, first, { type: "endPhase" });
    expect(s.phase).toBe("reinforce");
    expect(s.activePlayerId).toBe(s.playerOrder.find((p) => p !== first));
    expect(s.turn).toBe(2);
    expect(s.reinforcementsLeft).toBeGreaterThanOrEqual(3);
  });

  it("gives the next player their own continent bonus", () => {
    const s = game();
    const first = s.activePlayerId;
    const second = other(s);
    // second player owns all of Südmark (4 territories): 3 base + 3 bonus
    const territories = Object.fromEntries(
      testland.territories.map((t) => [
        t.id,
        { ownerId: t.continentId === "suedmark" ? second : first, armies: 1 },
      ]),
    );
    let next: GameState = { ...s, territories, phase: "fortify", reinforcementsLeft: 0 };
    next = ok(next, first, { type: "endPhase" });
    expect(next.reinforcementsLeft).toBe(3 + 3);
  });

  it("returns UNKNOWN_MAP when the state references a map that does not exist", () => {
    const s: GameState = { ...game(), mapId: "nowhere", phase: "fortify", reinforcementsLeft: 0 };
    expect(applyAction(s, s.activePlayerId, { type: "endPhase" }, rng)).toEqual({
      ok: false,
      code: "UNKNOWN_MAP",
    });
  });

  it("skips players without territories", () => {
    const s: GameState = {
      ...game(),
      playerOrder: ["a", "b", "c"],
      activePlayerId: "a",
      phase: "fortify",
      reinforcementsLeft: 0,
      territories: Object.fromEntries(
        testland.territories.map((t, i) => [t.id, { ownerId: i % 2 === 0 ? "a" : "c", armies: 1 }]),
      ),
    };
    expect(ok(s, "a", { type: "endPhase" }).activePlayerId).toBe("c");
  });
});
