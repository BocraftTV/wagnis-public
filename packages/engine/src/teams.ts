import type { GameState, PlayerId, TeamId, TeamMode } from "./types.js";

export const TEAM_IDS: readonly TeamId[] = ["A", "B", "C"];

/** Team sizes a mode asks for, in team order; the number of players is their sum. */
export function teamSizes(mode: TeamMode): number[] | null {
  switch (mode) {
    case "2v2":
      return [2, 2];
    case "3v3":
      return [3, 3];
    case "2v2v2":
      return [2, 2, 2];
    default:
      return null;
  }
}

/** The team of a player, or null (no teams, or not in any). */
export function teamOf(state: GameState, playerId: PlayerId): TeamId | null {
  if (!state.teams) return null;
  for (const id of TEAM_IDS) if (state.teams[id]?.includes(playerId)) return id;
  return null;
}

/** The player and the team mates (the player alone without teams). Includes players who are out. */
export function teamMembers(state: GameState, playerId: PlayerId): PlayerId[] {
  const id = teamOf(state, playerId);
  return id && state.teams ? [...(state.teams[id] ?? [])] : [playerId];
}

/** Two different players of the same team. */
export function areAllies(state: GameState, a: PlayerId | null, b: PlayerId | null): boolean {
  if (a === null || b === null || a === b || !state.teams) return false;
  const team = teamOf(state, a);
  return team !== null && teamOf(state, b) === team;
}

/** Whether `ownerId` owns ground for `playerId`: the player or a team mate. */
export function ownsForTeam(
  state: GameState,
  ownerId: PlayerId | null,
  playerId: PlayerId,
): boolean {
  return ownerId !== null && (ownerId === playerId || areAllies(state, ownerId, playerId));
}
