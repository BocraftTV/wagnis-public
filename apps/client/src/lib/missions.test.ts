import { describe, expect, it } from "vitest";
import {
  choiceWaitText,
  isSelfTarget,
  joinNames,
  missionText,
  progressText,
  resolutionRows,
  victoryPendingText,
  winReasonText,
} from "./missions.js";
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
    a: {
      mission: hold,
      originalMission: { type: "eliminatePlayer", targetPlayerId: "a" },
      discarded: null,
    },
    b: {
      mission: hold,
      originalMission: { type: "eliminatePlayer", targetPlayerId: "a" },
      discarded: null,
    },
    c: {
      mission: { type: "eliminatePlayer", targetPlayerId: "a" },
      originalMission: null,
      discarded: null,
    },
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
        discarded: null,
      },
      {
        playerId: "b",
        current: "Halte mindestens 6 Gebiete mit je 2 oder mehr Armeen",
        original: "Schalte Anna aus",
        discarded: null,
      },
      { playerId: "c", current: "Schalte Anna aus", original: null, discarded: null },
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

describe("plan 013 texts", () => {
  it("words the two new mission kinds", () => {
    expect(missionText({ type: "connectedRealm", count: 15 }, ctx)).toBe(
      "Halte mindestens 15 Gebiete, die ohne Lücke zusammenhängen",
    );
    expect(missionText({ type: "blitzkrieg", count: 6 }, ctx)).toBe(
      "Erobere in einem einzigen Zug 6 Gebiete",
    );
  });

  it("shows progress only for the two new kinds, from the numbers of the view", () => {
    expect(progressText({ type: "blitzkrieg", count: 6 }, { current: 4, target: 6 })).toBe(
      "Eroberungen in diesem Zug: 4 von 6",
    );
    expect(progressText({ type: "connectedRealm", count: 15 }, { current: 11, target: 15 })).toBe(
      "Größte zusammenhängende Gruppe: 11 von 15",
    );
    expect(progressText({ type: "holdTerritories", count: 5, minArmies: 1 }, null)).toBeNull();
    expect(progressText(null, null)).toBeNull();
    expect(
      progressText({ type: "holdTerritories", count: 5, minArmies: 1 }, { current: 1, target: 5 }),
    ).toBeNull();
  });

  it("the hold-to-win banner: own reminder first, otherwise only 'someone', never a name", () => {
    expect(victoryPendingText(false, false)).toBeNull();
    expect(victoryPendingText(true, false)).toBe("Jemand steht kurz vor dem Sieg.");
    expect(victoryPendingText(true, true)).toBe("Halte deine Mission bis zu deinem nächsten Zug.");
  });

  it("the waiting text counts who has chosen", () => {
    expect(choiceWaitText(3, 5)).toBe("Warte auf die anderen (3 von 5 haben gewählt)");
  });

  it("the resolution shows the discarded mission", () => {
    const rows = resolutionRows(
      {
        a: {
          mission: { type: "blitzkrieg", count: 6 },
          originalMission: null,
          discarded: { type: "connectedRealm", count: 15 },
        },
      },
      ["a"],
      "a",
      ctx,
    );
    expect(rows?.[0]?.discarded).toBe("Halte mindestens 15 Gebiete, die ohne Lücke zusammenhängen");
  });
});
