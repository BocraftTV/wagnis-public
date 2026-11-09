// Display of territory owners. `null` is the neutral owner (any number of players): not a seat, no list entry, no turn.
export const NEUTRAL_NAME = "Neutral";
export const NEUTRAL_COLOR = "var(--player-neutral)";

export interface PlayerRef {
  id: string;
  name: string;
  seat: number;
}

export function ownerName(id: string | null, players: PlayerRef[]): string {
  return id === null ? NEUTRAL_NAME : (players.find((p) => p.id === id)?.name ?? "?");
}

/** CSS color for an owner; the colors themselves live in `styles/colors.css` only. */
export function ownerColor(id: string | null, players: PlayerRef[]): string {
  if (id === null) return NEUTRAL_COLOR;
  return `var(--player-${players.find((p) => p.id === id)?.seat ?? 0})`;
}
