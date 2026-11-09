import { describe, expect, it } from "vitest";
import { eventText, eventTitle, worldEventsHint } from "./events.js";
import type { WorldEvent } from "./events.js";

const ctx = {
  continentName: (id: string) => ({ nordreich: "Nordreich" })[id] ?? id,
  playerName: (id: string) => ({ a: "Anna", b: "Ben", c: "Cleo" })[id] ?? "?",
};
const ev = (kind: WorldEvent["kind"], extra: Partial<WorldEvent> = {}): WorldEvent => ({
  kind,
  continentId: null,
  playerIds: [],
  territoryIds: [],
  ...extra,
});

describe("world event texts", () => {
  it("every kind has a title", () => {
    const kinds: WorldEvent["kind"][] = [
      "storm",
      "goldRush",
      "plague",
      "mobilize",
      "truce",
      "rebellion",
      "cardFlood",
      "fog",
    ];
    expect(kinds.map(eventTitle)).toEqual([
      "Sturm",
      "Goldrausch",
      "Seuche",
      "Mobilmachung",
      "Waffenstillstand",
      "Rebellion",
      "Kartenflut",
      "Nebel",
    ]);
  });
  it("names the continent where there is one", () => {
    const n = { continentId: "nordreich" };
    expect(eventText(ev("goldRush", n), ctx)).toContain("Nordreich");
    expect(eventText(ev("plague", n), ctx)).toContain("Nordreich");
    expect(eventText(ev("truce", n), ctx)).toContain("Nordreich");
  });
  it("rebellion names the players and the number of territories, or says nobody lost any", () => {
    const hit = ev("rebellion", { playerIds: ["a", "b"], territoryIds: ["x", "y", "z"] });
    expect(eventText(hit, ctx)).toBe("Aufstand bei Anna und Ben: 3 Gebiete sind neutral geworden.");
    expect(eventText(ev("rebellion"), ctx)).toContain("niemand");
  });
  it("storm, mobilize, card flood and fog", () => {
    expect(eventText(ev("storm"), ctx)).toContain("Seewege");
    expect(eventText(ev("mobilize"), ctx)).toContain("3 Armeen");
    expect(eventText(ev("cardFlood"), ctx)).toContain("Karte");
    expect(eventText(ev("fog"), ctx)).toContain("verborgen");
  });
  it("lobby hint", () => {
    expect(worldEventsHint(true)).toContain("Zu Beginn jeder Runde");
    expect(worldEventsHint(false)).toContain("Keine Ereignisse");
  });
});
