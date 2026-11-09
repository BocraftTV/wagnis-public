// Teams (plan 014 C, rules.md 13): texts and small display helpers. Who is in which team, who wins and the team
// score come ready from the view; whether an action is allowed is the server's decision.
import type { GameViewMessage, RoomView } from "@wagnis/shared";

export type TeamMode = RoomView["teams"];
export type TeamId = NonNullable<RoomView["players"][number]["team"]>;
type Teams = NonNullable<GameViewMessage["teams"]>;

/** The layouts the host can pick in the lobby; `null` is off. */
export const teamModeChoices: readonly TeamMode[] = [null, "2v2", "3v3", "2v2v2"];

export const teamsSectionLabel = "Teams";

export function teamModeLabel(mode: TeamMode): string {
  switch (mode) {
    case "2v2":
      return "2 gegen 2";
    case "3v3":
      return "3 gegen 3";
    case "2v2v2":
      return "2 gegen 2 gegen 2";
    default:
      return "Keine Teams";
  }
}

/** Short label on the buttons. */
export const teamModeButton = (mode: TeamMode): string =>
  mode === null ? "Aus" : teamModeLabel(mode);

/** How many players a layout needs. */
export function teamModePlayers(mode: TeamMode): number | null {
  return mode === "2v2" ? 4 : mode === "3v3" || mode === "2v2v2" ? 6 : null;
}

export function teamModeHint(mode: TeamMode): string {
  if (mode === null) return "Jeder spielt für sich.";
  return `${teamModeLabel(mode)}, genau ${teamModePlayers(mode)} Spieler. Partner sehen gegenseitig ihre Karten, verschieben Armeen auch in Partnergebiete, greifen sich aber nie an. Jedes Team hat eine gemeinsame Mission; gewinnt einer, gewinnt das Team.`;
}

/** The team letters a layout has, in order. */
export function teamLetters(mode: TeamMode): TeamId[] {
  if (mode === "2v2" || mode === "3v3") return ["A", "B"];
  if (mode === "2v2v2") return ["A", "B", "C"];
  return [];
}

export const teamName = (id: TeamId): string => `Team ${id}`;

/** What the lobby says about the assignment: how many are placed, and what is still missing. */
export function assignmentHint(mode: TeamMode, teams: (TeamId | null)[]): string | null {
  const need = teamModePlayers(mode);
  if (need === null) return null;
  if (teams.length !== need)
    return `Für ${teamModeLabel(mode)} braucht es genau ${need} Spieler (jetzt ${teams.length}).`;
  const open = teams.filter((t) => t === null).length;
  if (open > 0) return `Noch ${open} ohne Team. Zuteilen oder „Zufällig“ tippen.`;
  const size = need / teamLetters(mode).length;
  for (const letter of teamLetters(mode)) {
    const n = teams.filter((t) => t === letter).length;
    if (n !== size) return `${teamName(letter)} hat ${n} statt ${size} Spieler.`;
  }
  return null;
}

/** The team mates of a player (display only), not including the player. */
export function mateIds(teams: GameViewMessage["teams"], me: string): string[] {
  if (!teams) return [];
  for (const members of Object.values(teams as Teams)) {
    if (members?.includes(me)) return members.filter((p) => p !== me);
  }
  return [];
}

/** The team of a player in the game view, or null. */
export function teamOfPlayer(teams: GameViewMessage["teams"], id: string): TeamId | null {
  if (!teams) return null;
  for (const [letter, members] of Object.entries(teams as Teams)) {
    if (members?.includes(id)) return letter as TeamId;
  }
  return null;
}

/** "Team A hat gewonnen: Anna und Ben" for a team game. */
export function teamWinText(
  teamId: TeamId,
  winnerIds: string[],
  nameOf: (id: string) => string,
): string {
  const names = winnerIds.map(nameOf);
  const list =
    names.length <= 1
      ? names.join("")
      : `${names.slice(0, -1).join(", ")} und ${names[names.length - 1]}`;
  return `${teamName(teamId)} hat gewonnen: ${list}`;
}

export interface TeamScoreRow {
  teamId: TeamId;
  members: string[];
  points: number;
  armies: number;
  winner: boolean;
}

/** Team table rows in the server's order; the winners are marked from `winnerTeamId`. */
export function teamScoreRows(
  scores: GameViewMessage["teamScores"],
  winnerTeamId: TeamId | null,
): TeamScoreRow[] {
  if (!scores) return [];
  return scores.map((s) => ({
    teamId: s.teamId,
    members: s.playerIds,
    points: s.points,
    armies: s.armies,
    winner: s.teamId === winnerTeamId,
  }));
}
