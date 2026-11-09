import { describe, expect, it } from "vitest";
import {
  applyAction,
  calculateReinforcements,
  createDiceRng,
  isEliminated,
  missionSatisfied,
  testland,
  testlandRules,
  viewFor,
} from "./index.js";
import type { Action, GameState, Rng } from "./index.js";
import { makeState, withCards, withMissions } from "./testkit.js";

// Plan 007, step 2: neutral territories with 3 to 6 players (rules.md 1.3, "Neutral bei 3 bis 6 Spielern"). They
// arise through the host removing a player; here the boards are built by hand. Written before any change to
// the engine: a failure here would be a finding (a place that assumes neutral only with 2 players).
//
// testland: eisenfurt-rabenhain, eisenfurt-grauwacht, rabenhain-tannenfeld, grauwacht-tannenfeld,
// grauwacht-salzmoor, salzmoor-dornental, salzmoor-kupferstadt, dornental-nebelkueste, kupferstadt-nebelkueste.

const noRng: Rng = {
  int: () => {
    throw new Error("rng used");
  },
};
const ids = (n: number): string[] => Array.from({ length: n }, (_, i) => `p${i + 1}`);

/**
 * p1 holds grauwacht (6 armies). Neutral: tannenfeld (2 armies) and salzmoor (1 army). The other five territories
 * belong to p2..pn round-robin, so every player has at least one territory (n <= 6).
 */
function board(n: number, overrides: Partial<GameState> = {}): GameState {
  const players = ids(n);
  const others = players.slice(1);
  const rest = ["eisenfurt", "rabenhain", "dornental", "kupferstadt", "nebelkueste"];
  const territories: Record<string, [string | null, number]> = {
    grauwacht: ["p1", 6],
    tannenfeld: [null, 2],
    salzmoor: [null, 1],
  };
  rest.forEach((id, i) => (territories[id] = [others[i % others.length]!, 2]));
  return makeState({ territories, players, overrides });
}

const ok = (s: GameState, action: Action, faces: number[] = [], player = s.activePlayerId) => {
  const rng = faces.length ? createDiceRng(faces) : noRng;
  const r = applyAction(s, player, action, rng);
  if (!r.ok) throw new Error(`unexpected ${r.code}`);
  return r;
};
const codeOf = (s: GameState, action: Action) => {
  const r = applyAction(s, s.activePlayerId, action, noRng);
  return r.ok ? "OK" : r.code;
};

describe.each([3, 4, 5, 6])("%i players with neutral territories", (n) => {
  it("the board has a neutral owner that is no seat, no hand, no mission", () => {
    const s = board(n);
    expect(s.playerOrder).toHaveLength(n);
    expect(Object.keys(s.secret.hand)).toEqual(ids(n));
    expect(Object.keys(s.secret.mission)).toEqual(ids(n));
    const v = viewFor(s, "p1");
    expect(v.territories["tannenfeld"]!.ownerId).toBeNull();
    expect(Object.keys(v.handCounts)).toEqual(ids(n));
  });

  it("attack on neutral: the defender rolls 2 dice with 2 armies and loses both; defenderId is null, nobody is eliminated", () => {
    const s = board(n);
    // attacker 6-5-4, neutral 3-2: both neutral armies fall (neutral 2 dice = 5 faces in total)
    const dice = createDiceRng([6, 5, 4, 3, 2]);
    const r = applyAction(
      s,
      "p1",
      { type: "attack", from: "grauwacht", to: "tannenfeld", dice: 3 },
      dice,
    );
    if (!r.ok) throw new Error(r.code);
    expect(dice.remaining()).toBe(0);
    const roll = r.events.find((e) => e.type === "attackRolled")!;
    expect(roll).toMatchObject({
      defenderId: null,
      attackerDice: [6, 5, 4],
      defenderDice: [3, 2],
      attackerLosses: 0,
      defenderLosses: 2,
    });
    expect(r.state.territories["tannenfeld"]).toEqual({ ownerId: "p1", armies: 3 });
    expect(r.state.territories["grauwacht"]).toEqual({ ownerId: "p1", armies: 3 });
    expect(r.state.lastCombat).toMatchObject({ defenderId: null, attackerId: "p1" });
    expect(r.state.lastCombat!.summary.conquered).toBe(true);
    expect(r.state.conqueredThisTurn).toBe(true);
    expect(r.state.pendingOccupation).toEqual({ from: "grauwacht", to: "tannenfeld", min: 3 });
    expect(r.events.map((e) => e.type)).not.toContain("playerEliminated");
    expect(r.events.map((e) => e.type)).not.toContain("cardsTaken");
    expect(r.state.winnerId).toBeNull();
  });

  it("attack on a neutral territory with 1 army: the defender rolls exactly 1 die", () => {
    const s = board(n);
    const dice = createDiceRng([6, 5, 4, 3]);
    const r = applyAction(
      s,
      "p1",
      { type: "attack", from: "grauwacht", to: "salzmoor", dice: 3 },
      dice,
    );
    if (!r.ok) throw new Error(r.code);
    expect(dice.remaining()).toBe(0);
    const roll = r.events.find((e) => e.type === "attackRolled")!;
    expect(roll).toMatchObject({ defenderId: null, defenderDice: [3], defenderLosses: 1 });
    expect(r.state.territories["salzmoor"]!.ownerId).toBe("p1");
  });

  it("a neutral territory is a normal target, not an own one; it cannot be attacked from its own side", () => {
    const s = board(n);
    expect(
      ok(s, { type: "attack", from: "grauwacht", to: "tannenfeld", dice: 1 }, [6, 5, 4]).ok,
    ).toBe(true);
    expect(codeOf(s, { type: "attack", from: "tannenfeld", to: "grauwacht", dice: 1 })).toBe(
      "NOT_OWNER",
    );
  });

  it("the conquest of neutral counts for the card at the end of the turn", () => {
    const s = board(n);
    const attacked = ok(s, { type: "blitz", from: "grauwacht", to: "salzmoor" }, [6, 5, 4, 1]);
    const occupied = ok(attacked.state, { type: "occupy", count: 3 });
    const fortify = ok(occupied.state, { type: "endPhase" });
    const next = ok(fortify.state, { type: "endPhase" });
    expect(next.state.secret.hand["p1"]).toHaveLength(1);
    expect(next.events.map((e) => e.type)).toContain("cardDrawn");
    expect(next.state.activePlayerId).toBe("p2");
    expect(viewFor(next.state, "p2").handCounts["p1"]).toBe(1);
  });

  it("a card showing a neutral territory is never bonus-eligible", () => {
    const s = withCards(board(n), { hand: { p1: ["card-tannenfeld", "card-grauwacht"] } });
    const hand = viewFor(s, "p1").secret.hand;
    expect(hand.find((c) => c.id === "card-tannenfeld")!.bonusEligible).toBe(false);
    expect(hand.find((c) => c.id === "card-grauwacht")!.bonusEligible).toBe(true);
  });

  it("neutral territories complete no continent and do not count for floor(territories / divisor)", () => {
    const players = ids(n);
    // nordreich: p1 holds three of four, the fourth is neutral; suedmark is p1's completely
    const own = {
      eisenfurt: { ownerId: "p1", armies: 1 },
      rabenhain: { ownerId: "p1", armies: 1 },
      grauwacht: { ownerId: "p1", armies: 1 },
      tannenfeld: { ownerId: null, armies: 1 },
      salzmoor: { ownerId: "p1", armies: 1 },
      dornental: { ownerId: "p1", armies: 1 },
      kupferstadt: { ownerId: "p1", armies: 1 },
      nebelkueste: { ownerId: "p1", armies: 1 },
    };
    const rules = { ...testlandRules, minReinforcement: 1, territoryDivisor: 2 };
    // 7 own territories: floor(7 / 2) = 3, suedmark +3, nordreich spoiled by the neutral territory (no +2)
    expect(calculateReinforcements(testland, rules, own, "p1")).toBe(6);
    const full = { ...own, tannenfeld: { ownerId: "p1", armies: 1 } };
    expect(calculateReinforcements(testland, rules, full, "p1")).toBe(4 + 3 + 2);
    // nobody else gets anything for the neutral territory
    for (const q of players.slice(1))
      expect(calculateReinforcements(testland, rules, own, q)).toBe(1);
  });

  it("neutral breaks a fortify chain like a foreign owner", () => {
    const s = makeState({
      territories: {
        eisenfurt: ["p1", 4],
        grauwacht: [null, 2],
        salzmoor: ["p1", 3],
        rabenhain: ["p2", 1],
        tannenfeld: ["p2", 1],
      },
      fill: "p2",
      players: ids(n),
      phase: "fortify",
    });
    expect(codeOf(s, { type: "fortify", from: "eisenfurt", to: "salzmoor", count: 1 })).toBe(
      "NOT_CONNECTED",
    );
  });

  it("conquerContinents counts only own territories: a neutral one spoils the continent", () => {
    const s = withMissions(board(n), {
      p1: { type: "conquerContinents", continentIds: ["nordreich"], extraContinents: 0 },
    });
    expect(missionSatisfied(s, testland, "p1")).toBe(false);
  });

  it("neutral never counts for 'only one player left': a lone player wins with neutral territories on the map", () => {
    for (const mode of ["missions", "domination"] as const) {
      const s = makeState({
        territories: { grauwacht: ["p1", 6], tannenfeld: [null, 2], salzmoor: [null, 1] },
        fill: null,
        players: ids(n),
        phase: "reinforce",
        overrides: {
          reinforcementsLeft: 3,
          rules: { ...testlandRules, victoryMode: mode },
        },
      });
      for (const q of ids(n).slice(1)) expect(isEliminated(s, q)).toBe(true);
      const r = ok(s, { type: "placeArmies", territoryId: "grauwacht", count: 1 });
      expect(r.state.winnerId).toBe("p1");
      expect(r.state.winReason).toBe("lastPlayer");
      expect(Object.values(r.state.territories).some((t) => t.ownerId === null)).toBe(true);
    }
  });

  it("with another player left there is no win, however many neutral territories exist", () => {
    const s = board(n, { phase: "reinforce", reinforcementsLeft: 3 });
    const r = ok(s, { type: "placeArmies", territoryId: "grauwacht", count: 1 });
    expect(r.state.winnerId).toBeNull();
  });

  it("the turn passes between players only; neutral is never active", () => {
    let s = board(n, { phase: "fortify" });
    const seen: string[] = [];
    for (let i = 0; i < n; i++) {
      s = ok(s, { type: "endPhase" }).state; // fortify -> next player's reinforce
      seen.push(s.activePlayerId);
      s = { ...s, phase: "fortify" };
    }
    expect(seen).toEqual([...ids(n).slice(1), "p1"]);
  });

  it("every view carries ownerId null for neutral territories and lastCombat.defenderId null", () => {
    const s = board(n);
    const r = ok(s, { type: "attack", from: "grauwacht", to: "tannenfeld", dice: 1 }, [6, 5, 4]);
    for (const p of ids(n)) {
      const v = viewFor(r.state, p);
      expect(v.territories["tannenfeld"]!.ownerId).not.toBe("");
      expect(v.lastCombat!.defenderId).toBeNull();
    }
  });
});
