// Round limit (plan 014 A, rules.md 11): texts only. Which round it is, who won and the score come ready from the
// view; the client works out nothing.
import type { GameViewMessage } from "@wagnis/shared";

export type RoundLimit = GameViewMessage["roundLimit"];
export type ScoreEntry = NonNullable<GameViewMessage["scores"]>[number];

/** The values the host can pick in the lobby, `null` is off. */
export const roundLimitChoices: readonly RoundLimit[] = [null, 8, 12, 16];

export const roundLimitSectionLabel = "Rundenlimit";

export function roundLimitLabel(limit: RoundLimit): string {
  return limit === null ? "Kein Limit" : `${limit} Runden`;
}

export function roundLimitHint(limit: RoundLimit): string {
  return limit === null
    ? "Die Partie läuft, bis jemand gewinnt."
    : `Nach ${limit} Runden endet die Partie mit einer Wertung: ein Punkt je Gebiet plus der Bonus jedes ganz gehaltenen Kontinents, bei Gleichstand zählen die Armeen. Wer vorher gewinnt, gewinnt sofort.`;
}

/** "Runde 5 von 12", or "Runde 5" without a limit. */
export function roundText(round: number, limit: RoundLimit): string {
  return limit === null ? `Runde ${round}` : `Runde ${round} von ${limit}`;
}

/** "Anna hat gewonnen" / "Anna und Ben haben gewonnen" (a tie after the round limit). */
export function winnersText(
  winnerIds: string[],
  winnerId: string,
  nameOf: (id: string) => string,
  me: string,
): string {
  const ids = winnerIds.length > 0 ? winnerIds : [winnerId];
  const names = ids.map((id) => `${nameOf(id)}${id === me ? " (du)" : ""}`);
  if (names.length === 1) return `${names[0]} hat gewonnen`;
  const last = names[names.length - 1]!;
  return `${names.slice(0, -1).join(", ")} und ${last} haben gewonnen`;
}

export interface ScoreRow {
  playerId: string;
  points: number;
  detail: string;
  armies: number;
  winner: boolean;
}

/** Table rows in the server's order: "5 Gebiete + 2 Bonus", the armies for the tie-break, and who won. */
export function scoreRows(scores: ScoreEntry[] | null, winnerIds: string[]): ScoreRow[] {
  if (!scores) return [];
  return scores.map((s) => ({
    playerId: s.playerId,
    points: s.points,
    detail:
      s.continentBonus > 0
        ? `${s.territories} Gebiete + ${s.continentBonus} Bonus`
        : `${s.territories} Gebiete`,
    armies: s.armies,
    winner: winnerIds.includes(s.playerId),
  }));
}
