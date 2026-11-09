import { findTerritory } from "./attack.js";
import { bonusCandidates, cardCatalog, tradeValue } from "./cards.js";
import { getMap } from "./maps/index.js";
import type { Action, ActionErrorCode, ActionResult, Card, GameState, PlayerId } from "./types.js";

type TradeAction = Extract<Action, { type: "tradeCards" }>;

const fail = (code: ActionErrorCode): ActionResult => ({ ok: false, code });

/**
 * Trades one set of 3 cards (rules.md 6). Order of checks after the turn, game-over and pending-occupation
 * checks in `applyAction`: phase, 3 distinct ids, cards in the own hand, valid combination, bonus territory.
 */
export function applyTradeCards(
  state: GameState,
  playerId: PlayerId,
  action: TradeAction,
): ActionResult {
  if (state.phase !== "reinforce") return fail("WRONG_PHASE");
  const map = getMap(state.mapId);
  if (!map) return fail("UNKNOWN_MAP");
  const ids = action.cardIds;
  if (!Array.isArray(ids) || ids.length !== 3 || new Set(ids).size !== 3)
    return fail("INVALID_SET");
  const hand = state.secret.hand[playerId] ?? [];
  const catalog = new Map(cardCatalog(map, state.rules).map((c) => [c.id, c]));
  if (!ids.every((id) => hand.includes(id) && catalog.has(id))) return fail("UNKNOWN_CARD");
  const cards: Card[] = ids.map((id) => ({ ...catalog.get(id)! }));
  const armies = tradeValue(
    cards.map((c) => c.kind),
    state.rules,
  );
  if (armies === null) return fail("INVALID_SET");

  const candidates = bonusCandidates(state, playerId, cards);
  let bonusTerritoryId = candidates[0] ?? null;
  if (action.bonusTerritoryId !== undefined) {
    if (!candidates.includes(action.bonusTerritoryId)) return fail("INVALID_BONUS_TERRITORY");
    bonusTerritoryId = action.bonusTerritoryId;
  }

  const territories = { ...state.territories };
  if (bonusTerritoryId !== null) {
    const t = findTerritory(state, bonusTerritoryId)!;
    territories[bonusTerritoryId] = { ...t, armies: t.armies + state.rules.cards.territoryBonus };
  }
  const seq = state.tradeSeq + 1;
  return {
    ok: true,
    state: {
      ...state,
      territories,
      reinforcementsLeft: state.reinforcementsLeft + armies,
      secret: {
        ...state.secret,
        hand: { ...state.secret.hand, [playerId]: hand.filter((id) => !ids.includes(id)) },
        discard: [...state.secret.discard, ...ids],
      },
      tradeSeq: seq,
      lastTrade: { seq, playerId, cards, armies, bonusTerritoryId },
    },
    events: [
      {
        type: "cardsTraded",
        playerId,
        cards: cards.map((c) => ({ ...c })),
        armies,
        bonusTerritoryId,
      },
    ],
  };
}
