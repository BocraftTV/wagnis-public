import { drawCard } from "./cards.js";
import { getMap } from "./maps/index.js";
import { isEliminated } from "./players.js";
import { calculateReinforcements } from "./reinforcement.js";
import { checkTurnStart, markVictoryPending } from "./victory.js";
import type { ActionResult, GameEvent, GameState, PlayerId, Rng } from "./types.js";

/** Next player in seat order who has not been eliminated. */
function nextPlayer(state: GameState): PlayerId {
  const order = state.playerOrder;
  const start = order.indexOf(state.activePlayerId);
  for (let step = 1; step <= order.length; step++) {
    const candidate = order[(start + step) % order.length]!;
    if (!isEliminated(state, candidate)) return candidate;
  }
  return state.activePlayerId;
}

/**
 * Ends the active player's turn in the fixed order end of turn -> draw card -> turn change: a player
 * who conquered something this turn draws 1 card (so the next player's first view already counts it),
 * then the next player who is still in takes over, the per-turn fields reset and the new reinforcements
 * are worked out. `events` are those of the action that ended the turn and stay in front.
 */
export function endTurn(state: GameState, events: GameEvent[], rng: Rng): ActionResult {
  const map = getMap(state.mapId);
  if (!map) return { ok: false, code: "UNKNOWN_MAP" };
  // End of the turn: with `holdToWin` a met mission sets the marker (plan 013).
  state = markVictoryPending(state);
  const drawn = state.conqueredThisTurn
    ? drawCard(state, state.activePlayerId, rng)
    : { state, events: [] };
  const after = drawn.state;
  const allEvents = [...events, ...drawn.events];
  const nextId = nextPlayer(after);
  const reinforcements = calculateReinforcements(map, after.rules, after.territories, nextId);
  const turn = after.turn + 1;
  const next: GameState = {
    ...after,
    activePlayerId: nextId,
    phase: "reinforce",
    turn,
    reinforcementsLeft: reinforcements,
    conqueredThisTurn: false,
    conquestsThisTurn: 0,
    fortifyMovesDone: 0,
    lastCombat: null, // combatSeq stays, so seq never jumps back
    lastTrade: null, // same for tradeSeq
  };
  // Start of the new player's turn: after the draw and the turn change, before any action of theirs.
  return {
    ok: true,
    ...checkTurnStart(next, [
      ...allEvents,
      { type: "phaseChanged", playerId: nextId, phase: "reinforce" },
      { type: "turnStarted", playerId: nextId, turn, reinforcements },
    ]),
  };
}
