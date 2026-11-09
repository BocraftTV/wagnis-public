import type { MapDefinition } from "./map/types.js";
import { shuffle } from "./shuffle.js";
import type {
  Card,
  CardId,
  CardKind,
  CardRules,
  GameEvent,
  GameState,
  PlayerId,
  Rng,
  RuleConfig,
  TerritoryId,
  SuggestedSet,
} from "./types.js";

/** Symbols of territory cards, handed out round-robin in map order (rules.md 9, question 12). */
const SYMBOLS: readonly CardKind[] = ["infantry", "cavalry", "artillery"];

/**
 * All cards of a game: one per territory in map order (fixed symbol, independent of the RNG),
 * then the jokers. Pure function of map and rules; the state only stores the ids.
 */
export function cardCatalog(map: MapDefinition, rules: Pick<RuleConfig, "cards">): Card[] {
  const cards: Card[] = map.territories.map((t, i) => ({
    id: `card-${t.id}`,
    kind: SYMBOLS[i % SYMBOLS.length]!,
    territoryId: t.id,
  }));
  for (let n = 1; n <= rules.cards.jokers; n++) {
    cards.push({ id: `card-joker-${n}`, kind: "joker", territoryId: null });
  }
  return cards;
}

/**
 * Draws the top card for `playerId`. An empty deck is refilled from the shuffled discard pile first
 * (`deckReshuffled`); with both empty nothing is drawn. The `cardDrawn` event carries no card id.
 * Uses the `rng` only when it has to reshuffle.
 */
export function drawCard(
  state: GameState,
  playerId: PlayerId,
  rng: Rng,
): { state: GameState; events: GameEvent[] } {
  const events: GameEvent[] = [];
  let { deck, discard } = state.secret;
  if (deck.length === 0 && discard.length > 0) {
    deck = shuffle(discard, rng);
    discard = [];
    events.push({ type: "deckReshuffled" });
  }
  const top = deck[0];
  if (top === undefined) return { state, events };
  events.push({ type: "cardDrawn", playerId });
  return {
    state: {
      ...state,
      secret: {
        ...state.secret,
        deck: deck.slice(1),
        discard,
        hand: { ...state.secret.hand, [playerId]: [...(state.secret.hand[playerId] ?? []), top] },
      },
    },
    events,
  };
}

const SYMBOL_KINDS: readonly CardKind[] = ["infantry", "cavalry", "artillery"];

/** Armies for one concrete set of symbols (no jokers): three of a kind or one of each kind. */
function symbolValue(kinds: readonly CardKind[], values: CardRules["tradeValues"]): number | null {
  if (kinds.length !== 3) return null;
  const distinct = new Set(kinds);
  if (distinct.size === 1) return values[kinds[0] as "infantry" | "cavalry" | "artillery"];
  if (distinct.size === 3) return values.mixed;
  return null;
}

/**
 * Armies for three cards, or null if they are no set. A joker stands for any symbol and the best
 * reading counts: the highest value over all ways to read the jokers (rules.md 6).
 */
export function tradeValue(
  kinds: readonly CardKind[],
  rules: Pick<RuleConfig, "cards">,
): number | null {
  const fixed = kinds.filter((k) => k !== "joker");
  const jokers = kinds.length - fixed.length;
  let best: number | null = null;
  const read = (symbols: CardKind[], left: number): void => {
    if (left > 0) {
      for (const k of SYMBOL_KINDS) read([...symbols, k], left - 1);
      return;
    }
    const v = symbolValue(symbols, rules.cards.tradeValues);
    if (v !== null && (best === null || v > best)) best = v;
  };
  read(fixed, jokers);
  return best;
}

/** Own territories shown by the cards, in card order, each once. Jokers show none. */
export function bonusCandidates(
  state: GameState,
  playerId: PlayerId,
  cards: readonly Card[],
): TerritoryId[] {
  const out: TerritoryId[] = [];
  for (const c of cards) {
    const t = c.territoryId;
    if (t !== null && state.territories[t]?.ownerId === playerId && !out.includes(t)) out.push(t);
  }
  return out;
}

/**
 * At most one suggested set per trade value (so at most 4 with the default values), sorted by value, high
 * first: the best concrete set of the hand for that value. Best means, in this order: with a territory
 * bonus before without, fewer jokers, then by the position of the cards in the hand. The size does not
 * depend on the hand size. `cardIds` follow the hand order, and the bonus territory is the first one shown
 * by those cards. Players may still trade any 3 cards of their hand; the engine checks those.
 */
export function findSuggestedSets(
  state: GameState,
  playerId: PlayerId,
  catalog: ReadonlyMap<CardId, Card>,
): SuggestedSet[] {
  const hand = (state.secret.hand[playerId] ?? []).filter((id) => catalog.has(id));
  const best = new Map<number, { set: SuggestedSet; rank: [number, number, number[]] }>();
  const better = (a: [number, number, number[]], b: [number, number, number[]]): boolean => {
    if (a[0] !== b[0]) return a[0] < b[0];
    if (a[1] !== b[1]) return a[1] < b[1];
    for (let i = 0; i < 3; i++) if (a[2][i] !== b[2][i]) return a[2][i]! < b[2][i]!;
    return false;
  };
  for (let i = 0; i < hand.length; i++) {
    for (let j = i + 1; j < hand.length; j++) {
      for (let k = j + 1; k < hand.length; k++) {
        const ids = [hand[i]!, hand[j]!, hand[k]!];
        const cards = ids.map((id) => catalog.get(id)!);
        const value = tradeValue(
          cards.map((c) => c.kind),
          state.rules,
        );
        if (value === null) continue;
        const bonus = bonusCandidates(state, playerId, cards)[0] ?? null;
        const rank: [number, number, number[]] = [
          bonus === null ? 1 : 0,
          cards.filter((c) => c.kind === "joker").length,
          [i, j, k],
        ];
        const current = best.get(value);
        if (!current || better(rank, current.rank)) {
          best.set(value, { set: { cardIds: ids, value, bonusTerritoryId: bonus }, rank });
        }
      }
    }
  }
  return [...best.values()].map((e) => e.set).sort((a, b) => b.value - a.value);
}

/** Mandatory trade: the active player is in the reinforce phase holding `mustTradeAt` or more cards. */
export function mustTrade(state: GameState, playerId: PlayerId): boolean {
  return (
    state.winnerId === null &&
    playerId === state.activePlayerId &&
    state.phase === "reinforce" &&
    (state.secret.hand[playerId]?.length ?? 0) >= state.rules.cards.mustTradeAt
  );
}
