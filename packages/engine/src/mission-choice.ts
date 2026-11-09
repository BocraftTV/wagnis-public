import { getMap } from "./maps/index.js";
import { isEliminated } from "./players.js";
import { calculateReinforcements } from "./reinforcement.js";
import { teamMembers } from "./teams.js";
import { checkVictory } from "./victory.js";
import type {
  Action,
  ActionResult,
  GameEvent,
  GameState,
  Mission,
  PlayerId,
  Rng,
} from "./types.js";

type ChooseMissionAction = Extract<Action, { type: "chooseMission" }>;

const fail = (code: Extract<ActionResult, { ok: false }>["code"]): ActionResult => ({
  ok: false,
  code,
});

/** Players who still have to choose: not removed and with an open offer (rules.md 1.1, plan 013). */
export function pendingChoosers(state: GameState): PlayerId[] {
  return state.playerOrder.filter(
    (p) => !state.removedPlayerIds.includes(p) && state.secret.missionOffer[p] != null,
  );
}

/** Same mission by value: the offer holds replaced cards, `missionOfferDealt` the cards as drawn. */
const same = (a: Mission, b: Mission): boolean => JSON.stringify(a) === JSON.stringify(b);

/**
 * Applies one choice without starting the game: the chosen mission becomes the player's mission (and its dealt
 * card the `originalMission`), the other card is put away face down. The caller has checked everything.
 */
function choose(state: GameState, playerId: PlayerId, index: 0 | 1): GameState {
  // In a team game the first choice counts for the whole team (rules.md 13, question 56).
  let next = state;
  for (const p of teamMembers(state, playerId)) {
    if (
      p === playerId ||
      (next.secret.missionOffer[p] != null && !next.removedPlayerIds.includes(p))
    )
      next = chooseOne(next, p, index);
  }
  return next;
}

function chooseOne(state: GameState, playerId: PlayerId, index: 0 | 1): GameState {
  const offer = state.secret.missionOffer[playerId]!;
  const dealt = state.secret.missionOfferDealt[playerId]!;
  const secret = state.secret;
  return {
    ...state,
    secret: {
      ...secret,
      mission: { ...secret.mission, [playerId]: offer[index] },
      originalMission: { ...secret.originalMission, [playerId]: dealt[index] },
      missionReplaced: {
        ...secret.missionReplaced,
        [playerId]: !same(offer[index], dealt[index]),
      },
      discardedMission: { ...secret.discardedMission, [playerId]: dealt[index === 0 ? 1 : 0] },
      missionOffer: { ...secret.missionOffer, [playerId]: null },
      missionOfferDealt: { ...secret.missionOfferDealt, [playerId]: null },
    },
  };
}

/**
 * Begins the first turn once nobody has an open offer: the first player in seat order who is still in plays, the
 * reinforcements are worked out and the usual start-of-turn check runs (as `createGame` does without the draft).
 */
export function startFirstTurn(state: GameState, events: GameEvent[]): ActionResult {
  const map = getMap(state.mapId);
  if (!map) return fail("UNKNOWN_MAP");
  const order = state.playerOrder;
  const from = Math.max(0, order.indexOf(state.activePlayerId));
  let first = state.activePlayerId;
  for (let step = 0; step < order.length; step++) {
    const candidate = order[(from + step) % order.length]!;
    if (!isEliminated(state, candidate)) {
      first = candidate;
      break;
    }
  }
  const reinforcements = calculateReinforcements(
    map,
    state.rules,
    state.territories,
    first,
    state.worldEvent,
    teamMembers(state, first),
  );
  const next: GameState = {
    ...state,
    activePlayerId: first,
    phase: "reinforce",
    reinforcementsLeft: reinforcements,
  };
  return {
    ok: true,
    ...checkVictory(next, [
      ...events,
      { type: "roundStarted", round: next.round },
      { type: "phaseChanged", playerId: first, phase: "reinforce" },
      { type: "turnStarted", playerId: first, turn: next.turn, reinforcements },
    ]),
  };
}

/** Starts the first turn if everybody has chosen, otherwise returns the state as it is. */
export function startIfAllChose(state: GameState, events: GameEvent[]): ActionResult {
  if (pendingChoosers(state).length > 0) return { ok: true, state, events };
  return startFirstTurn(state, events);
}

/**
 * `chooseMission { index }` (plan 013, rules.md 1.1): valid for every player, not only the active one. Check order:
 * `GAME_OVER`, `WRONG_PHASE` (not in `missionChoice`), `UNKNOWN_PLAYER`, `PLAYER_REMOVED`, `ALREADY_CHOSEN`,
 * `INVALID_CHOICE`. The choice is final. The last choice starts the first turn.
 */
export function applyChooseMission(
  state: GameState,
  playerId: PlayerId,
  action: ChooseMissionAction,
): ActionResult {
  if (state.winnerId !== null) return fail("GAME_OVER");
  if (state.phase !== "missionChoice") return fail("WRONG_PHASE");
  if (!state.playerOrder.includes(playerId)) return fail("UNKNOWN_PLAYER");
  if (state.removedPlayerIds.includes(playerId)) return fail("PLAYER_REMOVED");
  if (state.secret.missionOffer[playerId] == null) return fail("ALREADY_CHOSEN");
  if (action.index !== 0 && action.index !== 1) return fail("INVALID_CHOICE");
  const next = choose(state, playerId, action.index);
  return startIfAllChose(next, [{ type: "missionChosen", playerId }]);
}

/**
 * Host `skipTurn` in `missionChoice` (rules.md 1.6, question 44): everybody who has not chosen gets one of their two
 * missions at random over the `Rng`, in seat order; in a team game once per team. Then the first turn starts.
 */
export function chooseForPending(
  state: GameState,
  rng: Rng,
): { state: GameState; events: GameEvent[] } {
  let next = state;
  const events: GameEvent[] = [];
  for (const p of pendingChoosers(state)) {
    // In a team game the choice for the first open member settled the mates too (rules.md 13, question 56).
    if (next.secret.missionOffer[p] == null) continue;
    next = choose(next, p, rng.int(2) === 0 ? 0 : 1);
    events.push({ type: "missionChosen", playerId: p });
  }
  return { state: next, events };
}
