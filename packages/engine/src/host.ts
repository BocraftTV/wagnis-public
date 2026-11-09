import { applyOccupy } from "./attack.js";
import { replaceTargetMissions } from "./missions.js";
import { endTurn } from "./turn.js";
import { checkLastPlayer, checkVictory } from "./victory.js";
import type {
  ActionErrorCode,
  ActionResult,
  GameEvent,
  GameState,
  HostAction,
  PlayerId,
  Rng,
  TerritoryState,
} from "./types.js";

type SkipTurnAction = Extract<HostAction, { type: "skipTurn" }>;
type RemovePlayerAction = Extract<HostAction, { type: "removePlayer" }>;

const fail = (code: ActionErrorCode): ActionResult => ({ ok: false, code });

/**
 * Applies one host action (rules.md 1.6). The engine does not know who the host is: the server checks that and
 * only then calls this. Rule violations are returned, never thrown; the input state is never changed.
 */
export function applyHostAction(state: GameState, action: HostAction, rng: Rng): ActionResult {
  switch (action.type) {
    case "skipTurn":
      return skipTurn(state, action, rng);
    case "removePlayer":
      return removePlayer(state, action, rng);
    default:
      return fail("UNKNOWN_ACTION");
  }
}

/**
 * `skipTurn { turn }`: ends the active player's turn without them (rules.md 1.6). Check order: `GAME_OVER`,
 * `STALE_TURN` (the host's `turn` is not the current one, e.g. a double tap or the player ended the turn first).
 * An open move-in is done with the minimum and, like after every `occupy`, the active player's win is checked
 * (plan assumption (a)); if that wins, the game ends without a turn end. Otherwise the remaining reinforcements
 * lapse (a mandatory trade is not looked at) and the turn ends as usual: card only after a conquest this turn,
 * turn change, start-of-turn check of the successor.
 */
function skipTurn(state: GameState, action: SkipTurnAction, rng: Rng): ActionResult {
  if (state.winnerId !== null) return fail("GAME_OVER");
  if (action.turn !== state.turn) return fail("STALE_TURN");
  const playerId = state.activePlayerId;
  let events: GameEvent[] = [{ type: "turnSkipped", playerId, turn: state.turn }];
  let next = state;
  if (next.pendingOccupation) {
    // The minimum already stands in the target territory; `occupy` with `min` only clears the open move-in.
    const moved = applyOccupy(next, playerId, {
      type: "occupy",
      count: next.pendingOccupation.min,
    });
    if (!moved.ok) return moved;
    const checked = checkVictory(moved.state, [...events, ...moved.events]);
    if (checked.state.winnerId !== null) return { ok: true, ...checked };
    next = checked.state;
    events = checked.events;
  }
  return endTurn({ ...next, reinforcementsLeft: 0 }, events, rng);
}

/**
 * `removePlayer { playerId }`: permanent (rules.md 1.6). Check order: `GAME_OVER`, `UNKNOWN_PLAYER` (not in
 * `playerOrder`), `PLAYER_REMOVED`. Then, in this order: territories turn neutral with their armies; the hand goes
 * to the discard pile (appended in hand order); the mission disappears; every `eliminatePlayer` mission aimed at the
 * player becomes the fallback, silently (no event, no field); the player enters `removedPlayerIds`. A removed player
 * keeps no territory, so `isEliminated` is true for them and the turn order and the win check need no second rule.
 *
 * Active player: the open move-in, the conquest flag (no card) and the reinforcements go; if somebody is left
 * alone he wins, otherwise the turn passes on with the usual start-of-turn check. Anyone else: only condition a)
 * (`checkLastPlayer`) is checked, never a mission, so nobody wins by mission in another player's turn.
 * Removing someone who is already eliminated takes the same path (nothing is left to take from them).
 */
function removePlayer(state: GameState, action: RemovePlayerAction, rng: Rng): ActionResult {
  if (state.winnerId !== null) return fail("GAME_OVER");
  const id: PlayerId = action.playerId;
  if (!state.playerOrder.includes(id)) return fail("UNKNOWN_PLAYER");
  if (state.removedPlayerIds.includes(id)) return fail("PLAYER_REMOVED");

  const territories: Record<string, TerritoryState> = {};
  let territoryCount = 0;
  for (const [tid, t] of Object.entries(state.territories)) {
    if (t.ownerId === id) {
      territories[tid] = { ...t, ownerId: null };
      territoryCount++;
    } else {
      territories[tid] = t;
    }
  }
  const hand = state.secret.hand[id] ?? [];
  let next: GameState = {
    ...state,
    territories,
    removedPlayerIds: [...state.removedPlayerIds, id],
    secret: {
      ...state.secret,
      hand: { ...state.secret.hand, [id]: [] },
      discard: [...state.secret.discard, ...hand],
      mission: { ...state.secret.mission, [id]: null },
      originalMission: { ...state.secret.originalMission, [id]: null },
      missionReplaced: { ...state.secret.missionReplaced, [id]: false },
    },
  };
  next = replaceTargetMissions(next, id, null);
  const events: GameEvent[] = [
    { type: "playerRemoved", playerId: id, territoryCount, discardedCount: hand.length },
  ];

  if (state.activePlayerId !== id) return { ok: true, ...checkLastPlayer(next, events) };

  next = { ...next, pendingOccupation: null, conqueredThisTurn: false, reinforcementsLeft: 0 };
  const last = checkLastPlayer(next, events);
  if (last.state.winnerId !== null) return { ok: true, ...last };
  return endTurn(last.state, last.events, rng);
}
