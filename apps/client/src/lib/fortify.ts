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
      t !== undefined && t.ownerId === me && t.maxMove > 0 && fortifyTargets(fortify, id).length > 0
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
