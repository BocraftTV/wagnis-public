import { describe, expect, it } from "vitest";
import {
  createGame,
  createSeededRng,
  getMap,
  getMissionSet,
  getRules,
  isMissionMet,
  mapIds,
  validateMissions,
  welt,
  weltRules,
  worldMissions,
} from "./index.js";
import type { GameState, Mission } from "./index.js";

const ids = ["p1", "p2", "p3", "p4", "p5", "p6"];
const SEEDS = Array.from({ length: 300 }, (_, i) => i + 1);
const key = (m: Mission) => JSON.stringify(m);

function start(n: number, seed: number): GameState {
  const r = createGame({
    map: welt,
    rules: weltRules,
    playerIds: ids.slice(0, n),
    rng: createSeededRng(seed),
  });
  if (!r.ok) throw new Error(r.code);
  return r.state;
}

const sizes = new Map(
  welt.continents.map((c) => [c.id, welt.territories.filter((t) => t.continentId === c.id).length]),
);

/** Fewest territories the mission can take: the named continents plus the smallest free ones. */
function minTerritories(m: Mission): number {
  if (m.type === "holdTerritories") return m.count;
  if (m.type !== "conquerContinents") return m.type === "connectedRealm" ? m.count : 0;
  const named = m.continentIds.reduce((sum, id) => sum + sizes.get(id)!, 0);
  const free = [...sizes.entries()]
    .filter(([id]) => !m.continentIds.includes(id))
    .map(([, n]) => n)
    .sort((a, b) => a - b)
    .slice(0, m.extraContinents)
    .reduce((sum, n) => sum + n, 0);
  return named + free;
}

/** Most territories the mission can take (largest free continents). */
function maxTerritories(m: Mission): number {
  if (m.type === "holdTerritories") return m.count;
  if (m.type !== "conquerContinents") return m.type === "connectedRealm" ? m.count : 0;
  const named = m.continentIds.reduce((sum, id) => sum + sizes.get(id)!, 0);
  const free = [...sizes.entries()]
    .filter(([id]) => !m.continentIds.includes(id))
    .map(([, n]) => n)
    .sort((a, b) => b - a)
    .slice(0, m.extraContinents)
    .reduce((sum, n) => sum + n, 0);
  return named + free;
}

describe("world mission list", () => {
  const all: Mission[] = [...worldMissions.missions, worldMissions.fallback];

  it("is valid and registered with its map and rules", () => {
    expect(validateMissions(welt, worldMissions)).toEqual({ ok: true });
    expect(getMissionSet("welt")).toBe(worldMissions);
    expect(getMissionSet("constructor")).toBeUndefined();
  });

  it("has 17 distinct missions, the specified fallback and no elimination mission", () => {
    expect(worldMissions.missions).toHaveLength(17);
    expect(new Set(worldMissions.missions.map(key)).size).toBe(17);
    expect(worldMissions.missions.slice(15)).toEqual([
      { type: "connectedRealm", count: 15 },
      { type: "blitzkrieg", count: 6 },
    ]);
    expect(worldMissions.fallback).toEqual({ type: "holdTerritories", count: 16, minArmies: 2 });
    expect(all.some((m) => m.type === "eliminatePlayer")).toBe(false);
    expect(worldMissions.missions.filter((m) => m.type === "conquerContinents")).toHaveLength(12);
    expect(worldMissions.missions.filter((m) => m.type === "holdTerritories")).toEqual([
      { type: "holdTerritories", count: 18, minArmies: 1 },
      { type: "holdTerritories", count: 15, minArmies: 2 },
      { type: "holdTerritories", count: 12, minArmies: 4 },
    ]);
  });

  it("names every continent in at least 3 missions", () => {
    for (const c of welt.continents) {
      const n = worldMissions.missions.filter(
        (m) => m.type === "conquerContinents" && m.continentIds.includes(c.id),
      ).length;
      expect(n, c.id).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("world mission balance", () => {
  const all: Mission[] = [...worldMissions.missions, worldMissions.fallback];

  it("needs the specified minimum of territories per mission", () => {
    expect(worldMissions.missions.map(minTerritories)).toEqual([
      15, 15, 16, 16, 15, 16, 15, 17, 17, 17, 15, 15, 18, 15, 12, 15, 0,
    ]);
    expect(minTerritories(worldMissions.fallback)).toBe(16);
  });

  it("static proof: no mission can be met with 14 territories or 40 armies", () => {
    // the start holds at most 14 territories and at most 40 armies per owner (setup tests)
    const maxStartTerritories = Math.ceil(42 / 3);
    const maxStartArmies = Math.max(...Object.values(weltRules.startArmies));
    expect(maxStartTerritories).toBe(14);
    expect(maxStartArmies).toBe(40);
    for (const m of all) {
      if (m.type === "holdTerritories") {
        expect(
          m.count > maxStartTerritories || m.count * m.minArmies > maxStartArmies,
          key(m),
        ).toBe(true);
      } else if (m.type === "blitzkrieg") {
        expect(m.count, key(m)).toBeGreaterThan(0); // the counter starts at 0
      } else {
        expect(minTerritories(m), key(m)).toBeGreaterThanOrEqual(15);
      }
    }
  });

  it("every mission is reachable: at most 42 territories, valid counts", () => {
    for (const m of all) {
      expect(minTerritories(m), key(m)).toBeLessThanOrEqual(42);
      expect(maxTerritories(m), key(m)).toBeLessThanOrEqual(42);
    }
    expect(Math.max(...all.map(maxTerritories))).toBe(27);
    for (const m of all) {
      if (m.type === "conquerContinents") {
        expect(m.continentIds.length + m.extraContinents).toBeLessThanOrEqual(
          welt.continents.length,
        );
      }
    }
  });

  it.each([2, 3, 4, 5, 6])(
    "%i players: no winner and no mission of the list met at the start (seeds 1-300)",
    (n) => {
      for (const seed of SEEDS) {
        const s = start(n, seed);
        expect(s.winnerId, `seed ${seed}`).toBeNull();
        for (const p of ids.slice(0, n)) {
          for (const m of all) {
            expect(isMissionMet(s, welt, p, m), `seed ${seed} ${p} ${key(m)}`).toBe(false);
          }
        }
      }
    },
  );
});

describe("world mission deal", () => {
  it.each([2, 3, 4, 5, 6])("%i players: one mission each, none dealt twice (seeds 1-100)", (n) => {
    const players = ids.slice(0, n);
    for (let seed = 1; seed <= 100; seed++) {
      const s = start(n, seed);
      expect(Object.keys(s.secret.mission).sort()).toEqual(players);
      const dealt = players.map((p) => s.secret.originalMission[p]!);
      expect(new Set(dealt.map(key)).size, `seed ${seed}`).toBe(n);
      for (const p of players) {
        const replaced = s.secret.missionReplaced[p]!;
        const o = s.secret.originalMission[p]!;
        expect(replaced).toBe(o.type === "eliminatePlayer" && o.targetPlayerId === p);
        expect(key(s.secret.mission[p]!)).toBe(key(replaced ? worldMissions.fallback : o));
        if (n === 2) {
          expect(o.type).not.toBe("eliminatePlayer");
          expect(replaced).toBe(false);
        }
      }
    }
  });

  it("is the same for the same seed", () => {
    expect(start(4, 9).secret).toEqual(start(4, 9).secret);
  });

  it("gives the fallback to a player who draws the mission against themselves (3 players)", () => {
    let found = 0;
    for (const seed of SEEDS) {
      const s = start(3, seed);
      for (const p of ids.slice(0, 3)) {
        if (!s.secret.missionReplaced[p]) continue;
        found++;
        expect(s.secret.mission[p]).toEqual(worldMissions.fallback);
        expect(s.secret.originalMission[p]).toEqual({ type: "eliminatePlayer", targetPlayerId: p });
      }
    }
    expect(found).toBeGreaterThan(0);
  });
});

describe("registry", () => {
  it("has missions, rules and a map for every registered id, and games start for 2 to 6 players", () => {
    expect([...mapIds].sort()).toEqual(["testland", "welt"]);
    for (const id of mapIds) {
      const map = getMap(id)!;
      const rules = getRules(id)!;
      const missions = getMissionSet(id)!;
      expect(map.id).toBe(id);
      expect(rules, id).toBeDefined();
      expect(validateMissions(map, missions)).toEqual({ ok: true });
      for (let n = 2; n <= 6; n++) {
        const r = createGame({
          map,
          rules,
          playerIds: ids.slice(0, n),
          rng: createSeededRng(n),
          missions,
        });
        expect(r.ok, `${id} ${n}`).toBe(true);
      }
    }
  });
});
