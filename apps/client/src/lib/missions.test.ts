import { describe, expect, it } from "vitest";
import { isSelfTarget, joinNames, missionText, resolutionRows, winReasonText } from "./missions.js";
import type { Mission, MissionContext } from "./missions.js";

const ctx: MissionContext = {
  continentName: (id) =>
    ({ nordreich: "Nordreich", suedmark: "Südmark", mitte: "Mitte" })[id] ?? id,
  playerName: (id) => ({ a: "Anna", b: "Ben" })[id] ?? "?",
};

describe("joinNames", () => {
  it("joins with commas and und", () => {
    expect(joinNames([])).toBe("");
    expect(joinNames(["A"])).toBe("A");
    expect(joinNames(["A", "B"])).toBe("A und B");
    expect(joinNames(["A", "B", "C"])).toBe("A, B und C");
  });
});

describe("missionText", () => {
  it("conquerContinents: named continents, singular and plural", () => {
    expect(
      missionText(
        { type: "conquerContinents", continentIds: ["nordreich"], extraContinents: 0 },
        ctx,
      ),
    ).toBe("Halte den Kontinent Nordreich vollständig");
    expect(
      missionText(
        { type: "conquerContinents", continentIds: ["nordreich", "suedmark"], extraContinents: 0 },
        ctx,
      ),
    ).toBe("Halte die Kontinente Nordreich und Südmark vollständig");
  });

  it("conquerContinents: extraContinents alone and combined", () => {
    expect(
      missionText({ type: "conquerContinents", continentIds: [], extraContinents: 1 }, ctx),
    ).toBe("Halte einen beliebigen Kontinent vollständig");
    expect(
      missionText({ type: "conquerContinents", continentIds: [], extraContinents: 2 }, ctx),
    ).toBe("Halte 2 beliebige Kontinente vollständig");
    expect(
      missionText(
        { type: "conquerContinents", continentIds: ["nordreich"], extraContinents: 1 },
        ctx,
      ),
    ).toBe(
      "Halte den Kontinent Nordreich und dazu einen weiteren beliebigen Kontinent vollständig",
    );
    expect(
      missionText(
        { type: "conquerContinents", continentIds: ["nordreich", "mitte"], extraContinents: 2 },
        ctx,
      ),
    ).toBe(
      "Halte die Kontinente Nordreich und Mitte und dazu 2 weitere beliebige Kontinente vollständig",
    );
  });

  it("holdTerritories: plural, singular and without a minimum", () => {
    expect(missionText({ type: "holdTerritories", count: 5, minArmies: 2 }, ctx)).toBe(
      "Halte mindestens 5 Gebiete mit je 2 oder mehr Armeen",
    );
    expect(missionText({ type: "holdTerritories", count: 1, minArmies: 3 }, ctx)).toBe(
      "Halte mindestens 1 Gebiet mit 3 oder mehr Armeen",
    );
    expect(missionText({ type: "holdTerritories", count: 6, minArmies: 1 }, ctx)).toBe(
      "Halte mindestens 6 Gebiete",
    );
  });

  it("eliminatePlayer: uses the player name", () => {
    expect(missionText({ type: "eliminatePlayer", targetPlayerId: "b" }, ctx)).toBe(
      "Schalte Ben aus",
    );
  });
});

describe("isSelfTarget", () => {
  const self: Mission = { type: "eliminatePlayer", targetPlayerId: "a" };
  it("is true only for an elimination mission aimed at the row's own player", () => {
    expect(isSelfTarget("a", self)).toBe(true);
    expect(isSelfTarget("b", self)).toBe(false);
    expect(isSelfTarget("a", { type: "holdTerritories", count: 4, minArmies: 3 })).toBe(false);
    expect(isSelfTarget("a", null)).toBe(false);
  });
});

describe("resolutionRows", () => {
  const hold = { type: "holdTerritories", count: 6, minArmies: 2 } as const;
  const missions = {
    a: { mission: hold, originalMission: { type: "eliminatePlayer", targetPlayerId: "a" } },
    b: {
      mission: hold,
      originalMission: { type: "eliminatePlayer", targetPlayerId: "a" },
    },
    c: { mission: { type: "eliminatePlayer", targetPlayerId: "a" }, originalMission: null },
  } satisfies NonNullable<Parameters<typeof resolutionRows>[0]>;

  it("is null without the resolution", () => {
    expect(resolutionRows(null, ["a", "b"], "a", ctx)).toBeNull();
  });

  it("marks a replacement only with originalMission and words the self-target case", () => {
    const rows = resolutionRows(missions, ["a", "b", "c"], "a", ctx);
    expect(rows).toEqual([
      {
        playerId: "a",
        current: "Halte mindestens 6 Gebiete mit je 2 oder mehr Armeen",
        original: "du solltest dich selbst ausschalten",
      },
      {
        playerId: "b",
        current: "Halte mindestens 6 Gebiete mit je 2 oder mehr Armeen",
        original: "Schalte Anna aus",
      },
      { playerId: "c", current: "Schalte Anna aus", original: null },
    ]);
  });

  it("words the self-target case for other viewers by name", () => {
    const rows = resolutionRows(missions, ["a"], "b", ctx);
    expect(rows?.[0]?.original).toBe("Anna sollte sich selbst ausschalten");
  });

  it("skips players without an entry", () => {
    expect(resolutionRows({}, ["a"], "a", ctx)).toEqual([]);
  });
});

describe("winReasonText", () => {
  it("maps the delivered reason", () => {
    expect(winReasonText("lastPlayer")).toBe("als letzter verbliebener Spieler");
    expect(winReasonText("mission")).toBe("durch Erfüllen der Mission");
    expect(winReasonText(null)).toBeNull();
  });
});
