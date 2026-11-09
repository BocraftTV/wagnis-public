import { getMap } from "@wagnis/engine/map-data";

/** "Karte: Welt (42 Gebiete)" for the lobby; the id itself if the map is unknown. */
export function mapLabel(mapId: string): string {
  const map = getMap(mapId);
  return map ? `Karte: ${map.name} (${map.territories.length} Gebiete)` : `Karte: ${mapId}`;
}

export type VictoryMode = "missions" | "domination";

/** Lobby choice of the victory mode: label and one sentence of explanation. */
export function modeLabel(mode: VictoryMode): string {
  return mode === "domination" ? "Letzter Spieler gewinnt" : "Geheime Missionen";
}
export function modeHint(mode: VictoryMode): string {
  return mode === "domination"
    ? "Keine Missionen: Wer als Letzter übrig bleibt, gewinnt."
    : "Jeder hat eine geheime Mission. Wer sie zuerst erfüllt, gewinnt, oder der letzte verbliebene Spieler.";
}

/** The maps the host can choose: the world map, and testland only in a development build. */
export function mapOptions(dev: boolean): { id: "welt" | "testland"; label: string }[] {
  const options: { id: "welt" | "testland"; label: string }[] = [
    { id: "welt", label: getMap("welt")?.name ?? "Welt" },
  ];
  if (dev) options.push({ id: "testland", label: getMap("testland")?.name ?? "Testland" });
  return options;
}

export type FortifyMoves = 1 | 2;

/** Lobby choice of the moves per turn: label and one sentence of explanation. */
export function fortifyLabel(moves: FortifyMoves): string {
  return moves === 2 ? "Zwei Verschiebungen" : "Original";
}
export function fortifyHint(moves: FortifyMoves): string {
  return moves === 2
    ? "Bis zu zwei Verschiebungen pro Zug; „Zug beenden“ geht vorher."
    : "Eine Verschiebung pro Zug, danach endet der Zug.";
}

/** Lobby options for the missions (plan 013): label and one sentence each. */
export const missionDraftLabel = "Zwei ziehen, eine behalten";
export function missionDraftHint(on: boolean): string {
  return on
    ? "Jeder bekommt zwei Missionen und wählt vor dem ersten Zug geheim eine; die andere wird verdeckt abgelegt und am Ende aufgedeckt."
    : "Jeder bekommt eine Mission zugeteilt.";
}
export const holdToWinLabel = "Halten bis zum nächsten Zug";
export function holdToWinHint(on: boolean): string {
  return on
    ? "Wer seine Mission erfüllt, gewinnt erst, wenn sie zu Beginn seines nächsten Zugs noch erfüllt ist. Alle sehen nur „Jemand steht kurz vor dem Sieg“. Blitzkrieg und Ausschalten zählen sofort."
    : "Wer seine Mission erfüllt, gewinnt sofort.";
}
