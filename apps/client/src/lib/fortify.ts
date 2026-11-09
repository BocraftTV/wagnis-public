// Presentation helpers for the fortify phase. No rules here: which territories can reach each other comes
// from the server view (`fortify.groups` / `fortify.targets`, `maxMove`); this only highlights and selects.
import type { GameViewMessage } from "@wagnis/shared";
import { emptySelection } from "./attack.js";
import type { Selection } from "./attack.js";

type Fortify = NonNullable<GameViewMessage["fortify"]>;
type Territories = GameViewMessage["territories"];

/** Territories the view offers as targets for this origin (looked up, not computed). */
export function fortifyTargets(fortify: Fortify | null, from: string | null): string[] {
  if (!fortify || !from) return [];
  if (fortify.reach === "adjacent") return fortify.targets[from] ?? [];
  const group = fortify.groups.find((g) => g.includes(from));
  return group ? group.filter((id) => id !== from) : [];
}

/** Own territories the view lists with at least one target and that have armies to spare. */
export function fortifyOrigins(
  fortify: Fortify | null,
  territories: Territories,
  me: string,
): string[] {
  if (!fortify) return [];
  const listed =
    fortify.reach === "adjacent" ? Object.keys(fortify.targets) : fortify.groups.flat();
  return listed.filter((id) => {
    const t = territories[id];
    return (
      t !== undefined &&
      t.ownerId === me &&
      (t.maxMove ?? 0) > 0 &&
      fortifyTargets(fortify, id).length > 0
    );
  });
}

/** What a tap on a territory does to the selection (the server still decides about validity). */
export function selectionAfterFortifyTap(
  current: Selection,
  tapped: string,
  fortify: Fortify | null,
  territories: Territories,
  me: string,
): Selection {
  const targets = fortifyTargets(fortify, current.from);
  if (current.from && targets.includes(tapped)) {
    return { from: current.from, to: tapped === current.to ? null : tapped };
  }
  if (!fortifyOrigins(fortify, territories, me).includes(tapped)) return current;
  return tapped === current.from ? emptySelection : { from: tapped, to: null };
}

/** Drops parts of the selection that no longer match the latest snapshot. */
export function pruneFortifySelection(
  sel: Selection,
  fortify: Fortify | null,
  territories: Territories,
  me: string,
): Selection {
  if (!sel.from || !fortifyOrigins(fortify, territories, me).includes(sel.from)) {
    return emptySelection;
  }
  if (sel.to && !fortifyTargets(fortify, sel.from).includes(sel.to)) {
    return { from: sel.from, to: null };
  }
  return sel;
}

/** Count to send: the player's choice, clamped to 1 … the `maxMove` the view reported (default: all). */
export function effectiveMove(chosen: number | null, maxMove: number): number {
  if (maxMove < 1) return 0;
  return chosen === null ? maxMove : Math.min(Math.max(chosen, 1), maxMove);
}

/** "Verschiebung 1 von 2", only for the two-move setting; the single-move setting shows no counter. */
export function fortifyProgress(fortify: Fortify | null): string | null {
  if (!fortify || fortify.movesMax < 2) return null;
  return `Verschiebung ${fortify.movesDone + 1} von ${fortify.movesMax}`;
}

/** Moves already made this turn as the view reports them (0 outside the fortify phase). */
export function movesDoneOf(fortify: Fortify | null): number {
  return fortify?.movesDone ?? 0;
}

/** True when a new snapshot moved the counter, so a leftover origin/target pair must be dropped. */
export function movesDoneChanged(previous: number | null, fortify: Fortify | null): boolean {
  return previous !== null && previous !== movesDoneOf(fortify);
}

/** Remembers which snapshot version and error count a move was sent at (double-tap guard). */
export interface SendLock {
  version: number;
  errors: number;
}

/**
 * The move button stays locked from sending until the next snapshot (new version) or an error arrives.
 * With two moves a duplicated `fortify` would be a valid second move, so the client never sends twice.
 */
export function isSendLocked(lock: SendLock | null, version: number, errors: number): boolean {
  return lock !== null && lock.version === version && lock.errors === errors;
}
