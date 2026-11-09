import { getMap } from "./maps/index.js";
import { missionSatisfied } from "./missions.js";
import { isEliminated } from "./players.js";
import type { GameEvent, GameState, PlayerId, WinReason } from "./types.js";

/**
 * Condition a) alone: exactly one player is left (eliminated and removed players do not count, and neither does
 * the neutral owner). Nobody else's mission is looked at. The host's `removePlayer` uses this on its own, because a
 * host action must not let the active player win by mission in the middle of their turn (rules.md 1.6).
 * Sets `winnerId`, `winReason: "lastPlayer"`, clears `pendingOccupation` and appends `gameWon`.
 */
export function checkLastPlayer(
  state: GameState,
  events: GameEvent[],
): { state: GameState; events: GameEvent[] } {
  if (state.winnerId !== null) return { state, events };
  const alive = state.playerOrder.filter((p) => !isEliminated(state, p));
  if (alive.length !== 1) return { state, events };
  return declareWinner(state, events, alive[0]!, "lastPlayer");
}

function declareWinner(
  state: GameState,
  events: GameEvent[],
  winnerId: PlayerId,
  reason: WinReason,
): { state: GameState; events: GameEvent[] } {
  return {
    state: { ...state, winnerId, winReason: reason, pendingOccupation: null },
    events: [...events, { type: "gameWon", playerId: winnerId, reason }],
  };
}

/**
 * Win check for the ACTIVE player only (rules.md 1.2); nobody wins in another player's turn. Called after every
 * accepted action of the active player except `endPhase`, before the turn ends in `fortify`, and at the start
 * of a turn (after the turn change, and for the first player in `createGame`).
 *
 * a) exactly one player is left (the neutral owner never counts), in both modes; wins before b).
 * b) `"missions"` only: the active player's mission is met. While a move-in is open (`pendingOccupation`) a
 *    `holdTerritories` mission is not checked (question 21): the move-in still changes the army counts.
 *
 * A win sets `winnerId` and `winReason`, clears `pendingOccupation` and appends `gameWon`.
 */
export function checkVictory(
  state: GameState,
  events: GameEvent[],
): { state: GameState; events: GameEvent[] } {
  const last = checkLastPlayer(state, events);
  if (last.state !== state || state.winnerId !== null) return last;
  if (state.rules.victoryMode !== "missions") return { state, events };
  const active = state.activePlayerId;
  const mission = state.secret.mission[active];
  const map = getMap(state.mapId);
  const deferred = state.pendingOccupation !== null && mission?.type === "holdTerritories";
  if (map && mission && !deferred && missionSatisfied(state, map, active)) {
    return declareWinner(state, events, active, "mission");
  }
  return { state, events };
}
