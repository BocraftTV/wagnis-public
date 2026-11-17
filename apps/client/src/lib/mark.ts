// How the map marks a territory: a ring when it can be picked or is chosen, in the tone of the current action.
import type { GameViewMessage } from "@wagnis/shared";
import type { Selection } from "./attack.js";

export interface TerritoryMark {
  pickable: boolean;
  ring: "none" | "pick" | "chosen";
  tone: "place" | "attack" | "move";
}

/** What the own player is doing right now (display only): placing, attacking, fortifying, or nothing to pick. */
export type PickMode = "place" | "attack" | "fortify" | null;

export interface MarkInput {
  mode: PickMode;
  me: string;
  territories: GameViewMessage["territories"];
  selection: Selection;
  /** Attack targets from `selection.from`. */
  targets: string[];
  /** Fortify targets from `selection.from`, and every territory a move can start from. */
  moveTargets: string[];
  moveOrigins: string[];
}

/** Whether a tap on the territory does something, by the same rules the taps use. */
export function pickable(input: MarkInput, id: string): boolean {
  const { mode, me, selection, targets, moveTargets, moveOrigins } = input;
  const t = input.territories[id];
  if (!t) return false;
  if (mode === "place") return t.ownerId === me;
  if (mode === "fortify") {
    return selection.from
      ? moveTargets.includes(id) || moveOrigins.includes(id)
      : moveOrigins.includes(id);
  }
  if (mode !== "attack") return false;
  return t.ownerId === me ? (t.maxAttackDice ?? 0) > 0 : targets.includes(id);
}

/** Ring marks for the map, in map order (`territoryIds`), for the territories the view knows. */
export function territoryMarks(
  input: MarkInput,
  territoryIds: string[],
): Record<string, TerritoryMark> {
  const out: Record<string, TerritoryMark> = {};
  const { mode, me, selection } = input;
  const choosing = mode === "attack" || mode === "fortify";
  for (const id of territoryIds) {
    const st = input.territories[id];
    if (!st) continue;
    const isFrom = choosing && selection.from === id;
    const isTo = choosing && selection.to === id;
    const canPick = pickable(input, id);
    const tone =
      mode === "fortify"
        ? "move"
        : mode === "attack" && (isTo || (!isFrom && st.ownerId !== me))
          ? "attack"
          : "place";
    out[id] = {
      pickable: canPick,
      ring: isFrom || isTo ? "chosen" : canPick ? "pick" : "none",
      tone,
    };
  }
  return out;
}
