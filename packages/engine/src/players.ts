import type { GameState, PlayerId } from "./types.js";

/** A player without any territory is out. Derived, never stored, so there is no second truth. */
export function isEliminated(state: GameState, playerId: PlayerId): boolean {
  return !Object.values(state.territories).some((t) => t.ownerId === playerId);
}
