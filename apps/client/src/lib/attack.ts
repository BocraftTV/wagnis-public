// Presentation helpers for the attack phase. No rules here: validity, dice limits and move-in ranges
// come from the server view (`maxAttackDice`, `pendingOccupation`); this only draws what was delivered.
import type { GameViewMessage } from "@wagnis/shared";

type Combat = NonNullable<GameViewMessage["lastCombat"]>;
type Roll = Combat["rolls"][number];

export interface Selection {
  from: string | null;
  to: string | null;
}

export const emptySelection: Selection = { from: null, to: null };

/** Neighbours owned by someone else: only used to highlight possible targets. */
export function targetsFrom(
  neighbors: Record<string, string[]>,
  territories: GameViewMessage["territories"],
  me: string,
  from: string | null,
): string[] {
  if (!from) return [];
  return (neighbors[from] ?? []).filter((id) => {
    const t = territories[id];
    return t !== undefined && t.ownerId !== me;
  });
}

/** What a tap on a territory does to the selection (the server still decides about validity). */
export function selectionAfterTap(
  current: Selection,
  tapped: string,
  territories: GameViewMessage["territories"],
  me: string,
  targets: string[],
): Selection {
  const t = territories[tapped];
  if (!t) return current;
  if (t.ownerId === me) {
    if (t.maxAttackDice === 0) return current; // cannot attack from here
    return tapped === current.from ? emptySelection : { from: tapped, to: null };
  }
  if (current.from && targets.includes(tapped)) {
    return { from: current.from, to: tapped === current.to ? null : tapped };
  }
  return current;
}

/** Drops parts of the selection that no longer make sense after a new snapshot. */
export function pruneSelection(
  sel: Selection,
  territories: GameViewMessage["territories"],
  me: string,
): Selection {
  const from = sel.from && territories[sel.from];
  if (!sel.from || !from || from.ownerId !== me || from.maxAttackDice === 0) return emptySelection;
  const to = sel.to ? territories[sel.to] : undefined;
  if (!sel.to || !to || to.ownerId === me) return { from: sel.from, to: null };
  return sel;
}

/** Dice to send: the player's choice, but never above the limit the server reported. */
export function effectiveDice(chosen: number | null, maxAttackDice: number): number {
  return chosen === null ? maxAttackDice : Math.min(chosen, maxAttackDice);
}

export interface DicePair {
  attacker: number | null;
  defender: number | null;
  /** Which side's die is marked as the losing one of this comparison (display only). */
  loser: "attacker" | "defender" | null;
}

/**
 * Lines up the delivered dice for display: the highest pair first. Surplus dice have no partner and are
 * shown unmarked. The marking compares the delivered numbers; the losses in the record are authoritative.
 */
export function pairDice(roll: Pick<Roll, "attackerDice" | "defenderDice">): DicePair[] {
  const rows = Math.max(roll.attackerDice.length, roll.defenderDice.length);
  const out: DicePair[] = [];
  for (let i = 0; i < rows; i++) {
    const attacker = roll.attackerDice[i] ?? null;
    const defender = roll.defenderDice[i] ?? null;
    const loser =
      attacker === null || defender === null ? null : attacker > defender ? "defender" : "attacker";
    out.push({ attacker, defender, loser });
  }
  return out;
}

/** What the result field shows: a blitz gets its summary first and only the last roll. */
export interface CombatDisplay {
  showSummary: boolean;
  roll: Roll | undefined;
  rollCount: number;
}

export function combatDisplay(combat: Combat): CombatDisplay {
  return {
    showSummary: combat.summary.rollCount > 1,
    roll: combat.rolls.at(-1),
    rollCount: combat.summary.rollCount,
  };
}

/** Shows each combat once per room for the lifetime of the page. In memory only, never stored. */
export class SeenCombats {
  private readonly seen = new Map<string, number>();

  /** True if this `seq` is new for this game of the room; remembers it. A `seq` never goes back, so lower ones are old. */
  markIfNew(roomId: string, gameNo: number, seq: number): boolean {
    // `seq` starts at 1 again in every game of a room, so the memory is per (room, game number)
    const key = `${roomId}#${gameNo}`;
    const last = this.seen.get(key);
    if (last !== undefined && seq <= last) return false;
    this.seen.set(key, seq);
    return true;
  }
}

/** Players without a territory are out (display only; the server skips them). */
export function eliminatedPlayers(
  game: Pick<GameViewMessage, "playerOrder" | "territories">,
): Set<string> {
  const holders = new Set(Object.values(game.territories).map((t) => t.ownerId));
  return new Set(game.playerOrder.filter((p) => !holders.has(p)));
}

/** One memory per page load, shared by every mount of the game view (a reconnect keeps it). */
export const seenCombats = new SeenCombats();
