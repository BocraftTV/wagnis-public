import { applyAttack, applyBlitz, applyOccupy, findTerritory } from "./attack.js";
import { mustTrade } from "./cards.js";
import { applyFortify } from "./fortify.js";
import { applyTradeCards } from "./trade.js";
import { endTurn } from "./turn.js";
import { checkVictory } from "./victory.js";
import type { Action, ActionResult, GameEvent, GameState, Phase, PlayerId, Rng } from "./types.js";

const fail = (code: Extract<ActionResult, { ok: false }>["code"]): ActionResult => ({
  ok: false,
  code,
});

/** Applies one player's action. Rule violations are returned, never thrown. */
export function applyAction(
  state: GameState,
  playerId: PlayerId,
  action: Action,
  rng: Rng,
): ActionResult {
  const result = applyChecked(state, playerId, action, rng);
  // Win check for the active player after every accepted action that can change ownership or armies.
  // `endPhase` changes neither (the turn-start check lives in `endTurn`), `fortify` checks before it ends the turn.
  if (!result.ok || action.type === "endPhase" || action.type === "fortify") return result;
  return { ok: true, ...checkVictory(result.state, result.events) };
}

function applyChecked(
  state: GameState,
  playerId: PlayerId,
  action: Action,
  rng: Rng,
): ActionResult {
  if (playerId !== state.activePlayerId) return fail("NOT_YOUR_TURN");
  if (state.winnerId !== null) return fail("GAME_OVER");
  // While a conquest is waiting for its move-in, nothing but `occupy` is valid.
  if (state.pendingOccupation && action.type !== "occupy") return fail("OCCUPY_PENDING");
  switch (action.type) {
    case "placeArmies": {
      if (state.phase !== "reinforce") return fail("WRONG_PHASE");
      if (mustTrade(state, playerId)) return fail("MUST_TRADE");
      const territory = findTerritory(state, action.territoryId);
      if (!territory) return fail("UNKNOWN_TERRITORY");
      if (territory.ownerId !== playerId) return fail("NOT_OWNER");
      if (!Number.isInteger(action.count) || action.count < 1) return fail("INVALID_COUNT");
      if (action.count > state.reinforcementsLeft) return fail("NOT_ENOUGH_REINFORCEMENTS");
      const next: GameState = {
        ...state,
        reinforcementsLeft: state.reinforcementsLeft - action.count,
        territories: {
          ...state.territories,
          [action.territoryId]: { ...territory, armies: territory.armies + action.count },
        },
      };
      const events: GameEvent[] = [
        { type: "armiesPlaced", playerId, territoryId: action.territoryId, count: action.count },
      ];
      return { ok: true, state: next, events };
    }
    case "attack":
      return applyAttack(state, playerId, action, rng);
    case "blitz":
      return applyBlitz(state, playerId, action, rng);
    case "occupy":
      return applyOccupy(state, playerId, action);
    case "tradeCards":
      return applyTradeCards(state, playerId, action);
    case "fortify":
      return applyFortify(state, playerId, action, rng);
    case "endPhase": {
      if (mustTrade(state, playerId)) return fail("MUST_TRADE");
      if (state.phase === "reinforce" && state.reinforcementsLeft > 0) {
        return fail("REINFORCEMENTS_REMAINING");
      }
      if (state.phase === "reinforce" || state.phase === "attack") {
        const phase: Phase = state.phase === "reinforce" ? "attack" : "fortify";
        return {
          ok: true,
          state: { ...state, phase },
          events: [{ type: "phaseChanged", playerId, phase }],
        };
      }
      return endTurn(state, [], rng);
    }
    default:
      return fail("UNKNOWN_ACTION");
  }
}
