import { drawCard } from "./cards.js";
import { getMap } from "./maps/index.js";
import { isEliminated } from "./players.js";
import { calculateReinforcements } from "./reinforcement.js";
import { checkTurnStart, finishByRoundLimit, markVictoryPending } from "./victory.js";
import { drawWorldEvent, eventOf } from "./world-events.js";
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
  // Card flood (plan 014 B): one card per conquest instead of at most one.
  const cards = eventOf(state, "cardFlood")
    ? state.conquestsThisTurn
    : state.conqueredThisTurn
      ? 1
      : 0;
  let drawn: { state: GameState; events: GameEvent[] } = { state, events: [] };
  for (let i = 0; i < cards; i++) {
    const one = drawCard(drawn.state, state.activePlayerId, rng);
    drawn = { state: one.state, events: [...drawn.events, ...one.events] };
  }
  const after = drawn.state;
  const allEvents = [...events, ...drawn.events];
  const nextId = nextPlayer(after);
  // A new round starts when the turn order wraps around (rules.md 11.1): the next player is not behind the
  // current one in seat order. After the last round the game is scored instead of passing the turn on (11.2).
  const wraps =
    after.playerOrder.indexOf(nextId) <= after.playerOrder.indexOf(after.activePlayerId);
  const limit = after.rules.roundLimit;
  if (wraps && limit !== null && after.round >= limit) {
    return { ok: true, ...finishByRoundLimit(after, allEvents) };
  }
  const round = wraps ? after.round + 1 : after.round;
  // The event of the new round is drawn before the reinforcements, so it counts for the first player too.
  const event = wraps ? drawWorldEvent(after, rng) : { state: after, events: [] };
  const base = event.state;
  const reinforcements = calculateReinforcements(
    map,
    base.rules,
    base.territories,
    nextId,
    base.worldEvent,
  );
  const turn = after.turn + 1;
  const next: GameState = {
    ...base,
    activePlayerId: nextId,
    phase: "reinforce",
    turn,
    round,
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
      ...(wraps ? [{ type: "roundStarted" as const, round }] : []),
      ...event.events,
      { type: "phaseChanged", playerId: nextId, phase: "reinforce" },
      { type: "turnStarted", playerId: nextId, turn, reinforcements },
    ]),
  };
}
