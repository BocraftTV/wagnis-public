import { describe, expect, it } from "vitest";
import {
  applyAction,
  createDiceRng,
  createGame,
  createSeededRng,
  isMissionMet,
  mapIds,
  testland,
  testlandMissions,
  testlandRules,
  welt,
  worldMissions,
  getMap,
  getMissionSet,
  getRules,
} from "./index.js";
import type { Action, GameState, Mission, Rng } from "./index.js";
import { playRandomGame } from "./playbot.js";
import { makeState, withMissions } from "./testkit.js";

// testland: eisenfurt-rabenhain, eisenfurt-grauwacht, rabenhain-tannenfeld, grauwacht-tannenfeld,
// grauwacht-salzmoor, salzmoor-dornental, salzmoor-kupferstadt, dornental-nebelkueste, kupferstadt-nebelkueste.

const noRng: Rng = {
  int: () => {
    throw new Error("rng used");
  },
};
const realm = (count: number): Mission => ({ type: "connectedRealm", count });
const blitz = (count: number): Mission => ({ type: "blitzkrieg", count });
const attack = (from: string, to: string, dice: number): Action => ({
  type: "attack",
  from,
  to,
  dice,
});

function ok(s: GameState, action: Action, faces: number[] = []) {
  const r = applyAction(s, s.activePlayerId, action, faces.length ? createDiceRng(faces) : noRng);
  if (!r.ok) throw new Error(`unexpected ${r.code}`);
  return r.state;
}

describe("connectedRealm", () => {
  /** a owns exactly the given territories, b the rest. */
  const owning = (ids: string[]) =>
    makeState({ territories: Object.fromEntries(ids.map((id) => [id, ["a", 1]])) });
  const met = (s: GameState, count: number) => isMissionMet(s, testland, "a", realm(count));

  it("5 linked own territories meet count 5", () => {
    const s = owning(["eisenfurt", "rabenhain", "tannenfeld", "grauwacht", "salzmoor"]);
    expect(met(s, 5)).toBe(true);
    expect(met(s, 6)).toBe(false);
  });

  it("a foreign territory in between splits the group (3 + 2): not met", () => {
    // grauwacht belongs to b: eisenfurt-rabenhain-tannenfeld (3) and salzmoor-dornental (2)
    const s = owning(["eisenfurt", "rabenhain", "tannenfeld", "salzmoor", "dornental"]);
    expect(met(s, 5)).toBe(false);
    expect(met(s, 3)).toBe(true);
  });

  it("a neutral territory in between splits the group as well", () => {
    const s = makeState({
      territories: {
        eisenfurt: ["a", 1],
        rabenhain: ["a", 1],
        tannenfeld: ["a", 1],
        grauwacht: [null, 1],
        salzmoor: ["a", 1],
        dornental: ["a", 1],
      },
    });
    expect(met(s, 4)).toBe(false);
    expect(met(s, 3)).toBe(true);
  });

  it("further, separate own territories do no harm and do not count", () => {
    const s = owning(["eisenfurt", "rabenhain", "tannenfeld", "dornental", "nebelkueste"]);
    expect(met(s, 3)).toBe(true);
    expect(met(s, 4)).toBe(false);
  });

  it("links across a sea route count: on the world map, neighbours of different continents form one group", () => {
    const sea = welt.territories.flatMap((t) =>
      t.neighbors
        .filter((n) => welt.territories.find((x) => x.id === n)!.continentId !== t.continentId)
        .map((n) => [t.id, n] as const),
    );
    expect(sea.length).toBeGreaterThan(0);
    const [a, b] = sea[0]!;
    const created = createGame({
      map: welt,
      rules: { ...getRules("welt")! },
      playerIds: ["a", "b", "c"],
      rng: createSeededRng(3),
    });
    if (!created.ok) throw new Error(created.code);
    const territories = Object.fromEntries(
      Object.entries(created.state.territories).map(([id, t]) => [
        id,
        { ...t, ownerId: id === a || id === b ? "a" : "b" },
      ]),
    );
    const state = { ...created.state, territories };
    expect(isMissionMet(state, welt, "a", realm(2))).toBe(true);
    expect(isMissionMet(state, welt, "a", realm(3))).toBe(false);
  });
});

describe("blitzkrieg", () => {
  /** a owns eisenfurt with 30 armies; b owns the rest with 1 army each. Mission: 3 conquests in one turn. */
  const start = (fill: string | null = "b") =>
    withMissions(
      makeState({ territories: { eisenfurt: ["a", 30], nebelkueste: ["b", 1] }, fill }),
      { a: blitz(3), b: null },
    );
  const occupy = (s: GameState): GameState => ok(s, { type: "occupy", count: 3 });
  const twoConquests = (s: GameState): GameState => {
    const first = occupy(ok(s, attack("eisenfurt", "rabenhain", 3), [6, 5, 4, 1]));
    return occupy(ok(first, attack("eisenfurt", "grauwacht", 3), [6, 5, 4, 1]));
  };

  it("the third conquest in one turn wins at once, with no move-in open", () => {
    const two = twoConquests(start());
    expect(two.conquestsThisTurn).toBe(2);
    expect(two.winnerId).toBeNull();
    const won = ok(two, attack("grauwacht", "tannenfeld", 2), [6, 5, 1]);
    expect(won.conquestsThisTurn).toBe(3);
    expect(won.winnerId).toBe("a");
    expect(won.winReason).toBe("mission");
    expect(won.pendingOccupation).toBeNull();
  });

  it("two conquests, a turn change and one more is no win; the counter restarts at 0", () => {
    let s = twoConquests(start());
    s = ok(ok(s, { type: "endPhase" }), { type: "endPhase" }); // attack -> fortify -> turn ends
    expect(s.activePlayerId).toBe("b");
    expect(s.conquestsThisTurn).toBe(0);
    expect(s.conqueredThisTurn).toBe(false);
    expect(isMissionMet(s, testland, "a", blitz(1))).toBe(false); // not a's turn
  });

  it("the conquest of a neutral territory counts", () => {
    const two = twoConquests(start(null));
    const won = ok(two, attack("grauwacht", "tannenfeld", 2), [6, 5, 1]);
    expect(won.territories["tannenfeld"]!.ownerId).toBe("a");
    expect(won.winnerId).toBe("a");
  });

  it("is never met by someone who is not the active player", () => {
    const s = { ...start(), conquestsThisTurn: 5 };
    expect(isMissionMet(s, testland, "a", blitz(3))).toBe(true);
    expect(isMissionMet(s, testland, "b", blitz(3))).toBe(false);
  });
});

describe("conquestsThisTurn", () => {
  it("equals the conquered flag (conqueredThisTurn === conquestsThisTurn > 0), is never negative and is 0 at every turn start", () => {
    for (let seed = 1; seed <= 40; seed++) {
      const { start, steps } = playRandomGame({ seed, players: 2 + (seed % 4), hostRate: 0.02 });
      expect(start.conquestsThisTurn).toBe(0);
      for (const { before, after, events, host } of steps) {
        expect(after.conqueredThisTurn, `seed ${seed}`).toBe(after.conquestsThisTurn > 0);
        expect(after.conquestsThisTurn).toBeGreaterThanOrEqual(0);
        const conquests = events.filter((e) => e.type === "territoryConquered").length;
        if (host) continue; // a host action may reset the counter without a turn change
        if (after.turn === before.turn) {
          expect(
            after.conquestsThisTurn,
            `seed ${seed} ${JSON.stringify(events.map((e) => e.type))}`,
          ).toBe(before.conquestsThisTurn + conquests);
        } else {
          expect(after.conquestsThisTurn).toBe(0);
        }
      }
    }
  });
});

describe("start guarantee for the realm missions", () => {
  it.each(mapIds)("%s: every realm count is larger than any owner's start holding", (id) => {
    const map = getMap(id)!;
    const set = getMissionSet(id)!;
    // 2 players are dealt three owners (both players and the neutral one), otherwise one owner per player
    const largestStart = Math.ceil(map.territories.length / 3);
    for (const m of set.missions) {
      if (m.type === "connectedRealm") expect(m.count).toBeGreaterThan(largestStart);
      if (m.type === "blitzkrieg") expect(m.count).toBeGreaterThanOrEqual(1);
    }
    expect(set.missions.some((m) => m.type === "connectedRealm")).toBe(true);
    expect(set.missions.some((m) => m.type === "blitzkrieg")).toBe(true);
  });

  it.each([
    ["testland", testland, testlandRules, testlandMissions],
    ["welt", welt, getRules("welt")!, worldMissions],
  ] as const)(
    "%s: no mission is met after createGame (seeds 1-150, 2 to 6 players)",
    (_n, map, rules, set) => {
      for (const n of [2, 3, 4, 5, 6]) {
        if (rules.startArmies[n] === undefined) continue;
        for (let seed = 1; seed <= 150; seed++) {
          const r = createGame({
            map,
            rules,
            playerIds: ["p1", "p2", "p3", "p4", "p5", "p6"].slice(0, n),
            rng: createSeededRng(seed),
            missions: set,
          });
          if (!r.ok) throw new Error(r.code);
          expect(r.state.winnerId, `${n} players, seed ${seed}`).toBeNull();
        }
      }
    },
  );
});
