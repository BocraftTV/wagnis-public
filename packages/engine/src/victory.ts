import { getMap } from "./maps/index.js";
import { missionSatisfied } from "./missions.js";
import { isEliminated } from "./players.js";
import { scoreboard, scoreWinners } from "./scoring.js";
import type { GameEvent, GameState, Mission, PlayerId, WinReason } from "./types.js";

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
    state: {
      ...state,
      winnerId,
      winnerIds: [winnerId],
      winReason: reason,
      pendingOccupation: null,
    },
    events: [...events, { type: "gameWon", playerId: winnerId, reason }],
  };
}

/**
 * Whether `mission` is won by holding it until the next own turn (plan 013, rules.md 1.2): `holdToWin` is on, the mode
 * is `"missions"` and the mission is not a one-off event (`blitzkrieg`, `eliminatePlayer` win at once).
 */
export function isHeldMission(state: GameState, mission: Mission | null): boolean {
  return (
    state.rules.holdToWin &&
    state.rules.victoryMode === "missions" &&
    mission !== null &&
    mission.type !== "blitzkrieg" &&
    mission.type !== "eliminatePlayer"
  );
}

/**
 * End of the active player's own turn (called by `endTurn` before the turn changes): with `holdToWin` the marker is set
 * if the mission is met right now, and cleared otherwise. Nothing changes without a held mission.
 */
export function markVictoryPending(state: GameState): GameState {
  const active = state.activePlayerId;
  const mission = state.secret.mission[active] ?? null;
  if (!isHeldMission(state, mission)) return state;
  const map = getMap(state.mapId);
  const met = map !== undefined && missionSatisfied(state, map, active);
  if ((state.secret.victoryPending[active] ?? false) === met) return state;
  return {
    ...state,
    secret: { ...state.secret, victoryPending: { ...state.secret.victoryPending, [active]: met } },
  };
}

/**
 * Start of a turn (after the turn change): condition a) first; then, with `holdToWin`, a set marker wins if the
 * mission is still met and is dropped if not (no marker, no win, even if the mission happens to be met right now);
 * then the usual `checkVictory` for the other missions.
 */
export function checkTurnStart(
  state: GameState,
  events: GameEvent[],
): { state: GameState; events: GameEvent[] } {
  const last = checkLastPlayer(state, events);
  if (last.state !== state || state.winnerId !== null) return last;
  const active = state.activePlayerId;
  let next = state;
  if (state.secret.victoryPending[active]) {
    const map = getMap(state.mapId);
    if (map && isHeldMission(state, state.secret.mission[active] ?? null)) {
      if (missionSatisfied(state, map, active))
        return declareWinner(state, events, active, "mission");
    }
    next = {
      ...state,
      secret: {
        ...state.secret,
        victoryPending: { ...state.secret.victoryPending, [active]: false },
      },
    };
  }
  return checkVictory(next, events);
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
  // A held mission (plan 013) never wins in the middle of a turn: only `checkTurnStart` can award it.
  if (
    map &&
    mission &&
    !deferred &&
    !isHeldMission(state, mission) &&
    missionSatisfied(state, map, active)
  ) {
    return declareWinner(state, events, active, "mission");
  }
  return { state, events };
}

/**
 * End of the last round (plan 014 A, rules.md 11.2), called by `endTurn` once the turn of the last player of round
 * `roundLimit` is over. First a held mission (plan 013, question 53): the first player in turn order whose marker is
 * set and whose mission is still met wins by mission, before the score. Otherwise the score decides: most points,
 * then most armies; all who are level win together (`winnerIds`, `winnerId` is the first of them in seat order).
 */
export function finishByRoundLimit(
  state: GameState,
  events: GameEvent[],
): { state: GameState; events: GameEvent[] } {
  const map = getMap(state.mapId);
  if (map) {
    for (const p of state.playerOrder) {
      if (isEliminated(state, p) || !state.secret.victoryPending[p]) continue;
      if (isHeldMission(state, state.secret.mission[p] ?? null) && missionSatisfied(state, map, p))
        return declareWinner(state, events, p, "mission");
    }
  }
  const winners = scoreWinners(scoreboard(state));
  const first = winners[0] ?? state.activePlayerId;
  return {
    state: {
      ...state,
      winnerId: first,
      winnerIds: winners.length > 0 ? winners : [first],
      winReason: "roundLimit",
      pendingOccupation: null,
    },
    events: [
      ...events,
      ...(winners.length > 0 ? winners : [first]).map((playerId): GameEvent => ({
        type: "gameWon",
        playerId,
        reason: "roundLimit",
      })),
    ],
  };
}
