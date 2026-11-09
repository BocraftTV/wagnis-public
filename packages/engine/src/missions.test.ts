import { describe, expect, it } from "vitest";
import {
  getMissionSet,
  isMissionMet,
  missionSatisfied,
  testland,
  testlandMissions,
  validateMissions,
} from "./index.js";
import type { GameState, Mission, MissionSet } from "./index.js";
import { cloneMission } from "./missions.js";
import { makeState } from "./testkit.js";

const withMission = (s: GameState, mission: Mission, who = "a"): GameState => ({
  ...s,
  secret: { ...s.secret, mission: { ...s.secret.mission, [who]: mission } },
});

const hold = (count: number, minArmies: number): Mission => ({
  type: "holdTerritories",
  count,
  minArmies,
});

describe("missionSatisfied: holdTerritories", () => {
  const five: Record<string, [string, number]> = {
    eisenfurt: ["a", 2],
    rabenhain: ["a", 2],
    tannenfeld: ["a", 2],
    grauwacht: ["a", 2],
    salzmoor: ["a", 2],
  };

  it("{ 5, 2 }: five territories with 2 armies each are enough", () => {
    const s = withMission(makeState({ territories: { ...five } }), hold(5, 2));
    expect(missionSatisfied(s, testland, "a")).toBe(true);
  });

  it("{ 5, 2 }: one of them with 1 army is not", () => {
    const s = withMission(makeState({ territories: { ...five, salzmoor: ["a", 1] } }), hold(5, 2));
    expect(missionSatisfied(s, testland, "a")).toBe(false);
  });

  it("extra territories without the army limit do not count, extra strong ones do", () => {
    const s = withMission(
      makeState({ territories: { ...five, salzmoor: ["a", 1], dornental: ["a", 1] } }),
      hold(5, 2),
    );
    expect(missionSatisfied(s, testland, "a")).toBe(false);
    const t = withMission(makeState({ territories: { ...five, dornental: ["a", 9] } }), hold(5, 2));
    expect(missionSatisfied(t, testland, "a")).toBe(true);
  });

  it("neutral and foreign territories do not count", () => {
    const s = withMission(
      makeState({
        territories: {
          eisenfurt: ["a", 5],
          rabenhain: ["a", 5],
          tannenfeld: [null, 9],
          grauwacht: ["b", 9],
        },
        fill: null,
      }),
      hold(3, 2),
    );
    expect(missionSatisfied(s, testland, "a")).toBe(false);
  });
});

describe("missionSatisfied: conquerContinents", () => {
  const nordreich: Record<string, [string, number]> = {
    eisenfurt: ["a", 1],
    rabenhain: ["a", 1],
    tannenfeld: ["a", 1],
    grauwacht: ["a", 1],
  };
  const suedmark: Record<string, [string, number]> = {
    salzmoor: ["a", 1],
    dornental: ["a", 1],
    kupferstadt: ["a", 1],
    nebelkueste: ["a", 1],
  };
  const extra1: Mission = {
    type: "conquerContinents",
    continentIds: ["nordreich"],
    extraContinents: 1,
  };

  it("named continent alone", () => {
    const m: Mission = {
      type: "conquerContinents",
      continentIds: ["nordreich"],
      extraContinents: 0,
    };
    expect(isMissionMet(makeState({ territories: { ...nordreich } }), testland, "a", m)).toBe(true);
    expect(
      isMissionMet(
        makeState({ territories: { ...nordreich, tannenfeld: ["b", 1] } }),
        testland,
        "a",
        m,
      ),
    ).toBe(false);
  });

  it("extraContinents 1 needs a further complete continent besides the named one", () => {
    expect(isMissionMet(makeState({ territories: { ...nordreich } }), testland, "a", extra1)).toBe(
      false,
    );
    expect(
      isMissionMet(
        makeState({ territories: { ...nordreich, ...suedmark } }),
        testland,
        "a",
        extra1,
      ),
    ).toBe(true);
    // the extra continent must not be the named one: only suedmark does not satisfy "nordreich + 1"
    expect(
      isMissionMet(makeState({ territories: { ...suedmark }, fill: "b" }), testland, "a", extra1),
    ).toBe(false);
  });

  it("with no named continent any continent counts", () => {
    const m: Mission = { type: "conquerContinents", continentIds: [], extraContinents: 1 };
    expect(
      isMissionMet(makeState({ territories: { ...suedmark }, fill: "b" }), testland, "a", m),
    ).toBe(true);
    expect(
      isMissionMet(makeState({ territories: { eisenfurt: ["a", 1] } }), testland, "a", m),
    ).toBe(false);
  });

  it("a neutral territory inside the continent prevents 'complete'", () => {
    const m: Mission = {
      type: "conquerContinents",
      continentIds: ["suedmark"],
      extraContinents: 0,
    };
    const s = makeState({ territories: { ...suedmark, nebelkueste: [null, 3] }, fill: "b" });
    expect(isMissionMet(s, testland, "a", m)).toBe(false);
  });
});

describe("missionSatisfied: eliminatePlayer and no mission", () => {
  const kill: Mission = { type: "eliminatePlayer", targetPlayerId: "b" };
  it("is met exactly when the target holds no territory", () => {
    expect(isMissionMet(makeState({ territories: {} }), testland, "a", kill)).toBe(false);
    expect(isMissionMet(makeState({ territories: {}, fill: "a" }), testland, "a", kill)).toBe(true);
  });
  it("without a mission nothing is satisfied", () => {
    expect(missionSatisfied(makeState({ territories: {}, fill: "a" }), testland, "a")).toBe(false);
  });
  it("does not change the state", () => {
    const s = withMission(makeState({ territories: {}, fill: "a" }), kill);
    const copy = structuredClone(s);
    missionSatisfied(s, testland, "a");
    expect(s).toEqual(copy);
  });
});

describe("validateMissions", () => {
  const ok = (): MissionSet => structuredClone(testlandMissions);
  const bad = (edit: (s: MissionSet) => void) => {
    const s = ok();
    edit(s);
    return validateMissions(testland, s).ok;
  };
  it("accepts the testland list and finds it by map id", () => {
    expect(validateMissions(testland, testlandMissions)).toEqual({ ok: true });
    expect(getMissionSet("testland")).toBe(testlandMissions);
    expect(getMissionSet("nowhere")).toBeUndefined();
  });
  it("rejects every kind of bad list", () => {
    expect(bad((s) => (s.missions = [s.missions[0]!]))).toBe(false);
    expect(bad((s) => s.missions.push({ ...s.missions[0]! }))).toBe(false);
    expect(bad((s) => s.missions.push({ type: "eliminatePlayer", targetPlayerId: "x" }))).toBe(
      false,
    );
    expect(
      bad((s) =>
        s.missions.push({ type: "conquerContinents", continentIds: ["mars"], extraContinents: 0 }),
      ),
    ).toBe(false);
    expect(
      bad((s) =>
        s.missions.push({
          type: "conquerContinents",
          continentIds: ["nordreich", "nordreich"],
          extraContinents: 0,
        }),
      ),
    ).toBe(false);
    expect(
      bad((s) =>
        s.missions.push({
          type: "conquerContinents",
          continentIds: ["nordreich", "suedmark"],
          extraContinents: 1,
        }),
      ),
    ).toBe(false);
    expect(
      bad((s) =>
        s.missions.push({ type: "conquerContinents", continentIds: [], extraContinents: 0 }),
      ),
    ).toBe(false);
    expect(bad((s) => s.missions.push(hold(0, 1)))).toBe(false);
    expect(bad((s) => s.missions.push(hold(9, 1)))).toBe(false);
    expect(bad((s) => s.missions.push(hold(3, 0)))).toBe(false);
    expect(bad((s) => (s.fallback = hold(9, 1) as MissionSet["fallback"]))).toBe(false);
    expect(
      bad((s) => (s.fallback = { type: "eliminatePlayer", targetPlayerId: "a" } as never)),
    ).toBe(false);
    expect(bad(() => {})).toBe(true);
  });
  it("every testland mission needs at least 4 own territories (never met at the start)", () => {
    for (const m of testlandMissions.missions) {
      const needs = m.type === "holdTerritories" ? m.count : 4;
      expect(needs).toBeGreaterThanOrEqual(4);
    }
  });
});

describe("cloneMission", () => {
  it("copies without sharing the continent list", () => {
    const m: Extract<Mission, { type: "conquerContinents" }> = {
      type: "conquerContinents",
      continentIds: ["nordreich"],
      extraContinents: 1,
    };
    const c = cloneMission(m);
    expect(c).toEqual(m);
    expect(c.continentIds).not.toBe(m.continentIds);
    expect(cloneMission({ type: "holdTerritories", count: 6, minArmies: 2 })).toEqual({
      type: "holdTerritories",
      count: 6,
      minArmies: 2,
    });
  });
});
