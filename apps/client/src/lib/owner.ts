// Display of territory owners. `null` is the neutral owner (any number of players): not a seat, no list entry, no turn.
export const NEUTRAL_NAME = "Neutral";
export const NEUTRAL_COLOR = "var(--player-neutral)";

/** Shades per team color family (`--team-a-0` to `--team-c-2` in `styles/colors.css`); 3v3 uses all of them. */
export const TEAM_SHADES = 3;

export interface PlayerRef {
  id: string;
  name: string;
  seat: number;
  /** Plan 014 C: the public team assignment (lobby and game), or null/absent without teams. */
  team?: "A" | "B" | "C" | null | undefined;
}

export function ownerName(id: string | null, players: PlayerRef[]): string {
  return id === null ? NEUTRAL_NAME : (players.find((p) => p.id === id)?.name ?? "?");
}

/**
 * CSS color for an owner; the colors themselves live in `styles/colors.css` only. Without a team: the seat color.
 * In a team (plan 015): the team's color family, the shade by seat order within the team, so a player keeps the
 * color from the lobby assignment to the end (removed players stay in the list and keep their shade).
 */
export function ownerColor(id: string | null, players: PlayerRef[]): string {
  if (id === null) return NEUTRAL_COLOR;
  const player = players.find((p) => p.id === id);
  if (!player) return "var(--player-0)";
  const team = player.team;
  if (!team) return `var(--player-${player.seat})`;
  const shade = players.filter((p) => p.team === team && p.seat < player.seat).length;
  return `var(--team-${team.toLowerCase()}-${Math.min(shade, TEAM_SHADES - 1)})`;
}
