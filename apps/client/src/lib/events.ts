// World events (plan 014 B, rules.md 12): texts only. Which event stands, which continent it hits and what the fog
// hides comes ready from the view; the client works out nothing.
import type { GameViewMessage } from "@wagnis/shared";

export type WorldEvent = NonNullable<GameViewMessage["worldEvent"]>;

export const worldEventsLabel = "Weltereignisse";

export function worldEventsHint(on: boolean): string {
  return on
    ? "Zu Beginn jeder Runde wird ein Ereignis aufgedeckt, das bis zum Ende der Runde gilt: Sturm, Goldrausch, Seuche, Mobilmachung, Waffenstillstand, Rebellion, Kartenflut oder Nebel."
    : "Keine Ereignisse, die Runden laufen wie gewohnt.";
}

const titles: Record<WorldEvent["kind"], string> = {
  storm: "Sturm",
  goldRush: "Goldrausch",
  plague: "Seuche",
  mobilize: "Mobilmachung",
  truce: "Waffenstillstand",
  rebellion: "Rebellion",
  cardFlood: "Kartenflut",
  fog: "Nebel",
};

export const eventTitle = (kind: WorldEvent["kind"]): string => titles[kind];

export interface EventContext {
  continentName: (id: string) => string;
  playerName: (id: string) => string;
}

function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} und ${names[names.length - 1]}`;
}

/** One or two sentences for the banner, in our own words. */
export function eventText(event: WorldEvent, ctx: EventContext): string {
  const where = event.continentId ? ctx.continentName(event.continentId) : "";
  switch (event.kind) {
    case "storm":
      return "Die Seewege sind gesperrt: kein Angriff und keine Verschiebung übers Meer.";
    case "goldRush":
      return `Der Kontinentbonus von ${where} zählt doppelt.`;
    case "plague":
      return `In ${where} hat jedes Gebiet mit mindestens 2 Armeen 1 Armee verloren.`;
    case "mobilize":
      return "Jeder bekommt in seinem Zug 3 Armeen zusätzlich.";
    case "truce":
      return `Gebiete in ${where} dürfen in dieser Runde nicht angegriffen werden.`;
    case "rebellion": {
      const who = joinNames(event.playerIds.map(ctx.playerName));
      return who
        ? `Aufstand bei ${who}: ${event.territoryIds.length} Gebiete sind neutral geworden.`
        : "Ein Aufstand brach aus, doch niemand musste Gebiete abgeben.";
    }
    case "cardFlood":
      return "Jede Eroberung in dieser Runde bringt am Zugende eine Karte.";
    case "fog":
      return "Fremde Armeezahlen sind verborgen, du siehst nur deine eigenen.";
  }
}
