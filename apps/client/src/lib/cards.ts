// Presentation helpers for the card hand and the trade. No rules here: whether three cards form a set and
// what they are worth is decided by the server (`INVALID_SET`); suggestions, value and bonus come from the view.
import type { GameViewMessage } from "@wagnis/shared";

type Secret = GameViewMessage["secret"];
export type Card = Secret["hand"][number];
export type CardKind = Card["kind"];
export type SuggestedSet = Secret["suggestedSets"][number];
export type Trade = NonNullable<GameViewMessage["lastTrade"]>;

export const kindName: Record<CardKind, string> = {
  infantry: "Infanterie",
  cavalry: "Kavallerie",
  artillery: "Artillerie",
  joker: "Joker",
};

/** Tapping a card in the trade dialog: toggles it; a fourth card replaces the oldest choice. */
export function toggleChoice(selected: string[], id: string): string[] {
  if (selected.includes(id)) return selected.filter((x) => x !== id);
  return [...selected, id].slice(-3);
}

/** The delivered suggestion whose cards are exactly the chosen ones (order does not matter). */
export function matchingSuggestion(
  selected: string[],
  suggestions: SuggestedSet[],
): SuggestedSet | undefined {
  return suggestions.find(
    (s) => s.cardIds.length === selected.length && s.cardIds.every((id) => selected.includes(id)),
  );
}

/** Keeps only choices that are still in the hand after a new snapshot. */
export function pruneChoice(selected: string[], hand: Card[]): string[] {
  const kept = selected.filter((id) => hand.some((c) => c.id === id));
  return kept.length === selected.length ? selected : kept;
}

/** One line for everybody: who traded which cards for how many armies (as the record says). */
export function tradeLine(
  trade: Trade,
  playerName: (id: string) => string,
  territoryName: (id: string) => string,
): string {
  const cards = trade.cards.map((c) => kindName[c.kind]).join(", ");
  const bonus = trade.bonusTerritoryId
    ? `, Bonus auf ${territoryName(trade.bonusTerritoryId)}`
    : "";
  return `${playerName(trade.playerId)} hat getauscht: ${cards} → ${trade.armies} Armeen${bonus}`;
}

/** Shows each trade once per room for the lifetime of the page. In memory only, never stored. */
export class SeenTrades {
  private readonly seen = new Map<string, number>();

  /** True if this `seq` is new for this game of the room; remembers it. A `seq` never goes back. */
  markIfNew(roomId: string, gameNo: number, seq: number): boolean {
    // `seq` starts at 1 again in every game of a room, so the memory is per (room, game number)
    const key = `${roomId}#${gameNo}`;
    const last = this.seen.get(key);
    if (last !== undefined && seq <= last) return false;
    this.seen.set(key, seq);
    return true;
  }
}

/** One memory per page load, shared by every mount of the game view (a reconnect keeps it). */
export const seenTrades = new SeenTrades();

/**
 * Territories offered as the bonus territory: those of the chosen cards the view marks `bonusEligible`
 * (the engine decides; the client only filters by the field), in card order, without duplicates.
 */
export function bonusChoices(hand: Card[], selected: string[]): string[] {
  const out: string[] = [];
  for (const id of selected) {
    const card = hand.find((c) => c.id === id);
    if (card?.bonusEligible && card.territoryId && !out.includes(card.territoryId)) {
      out.push(card.territoryId);
    }
  }
  return out;
}

/**
 * The `bonusTerritoryId` to send. With fewer than two choices nothing is sent (the order of `cardIds`
 * gives the same result). Otherwise the player's pick, else the suggestion's bonus, else the first choice.
 */
export function bonusToSend(
  choices: string[],
  picked: string | null,
  suggested: string | null | undefined,
): string | undefined {
  if (choices.length < 2) return undefined;
  if (picked && choices.includes(picked)) return picked;
  if (suggested && choices.includes(suggested)) return suggested;
  return choices[0];
}
