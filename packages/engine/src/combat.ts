import type { Rng } from "./types.js";

/** Rolls `count` dice and returns them sorted descending. */
export function rollDice(rng: Rng, count: number): number[] {
  const dice: number[] = [];
  for (let i = 0; i < count; i++) dice.push(rng.int(6) + 1);
  return dice.sort((a, b) => b - a);
}

export interface RollOutcome {
  attackerLosses: number;
  defenderLosses: number;
}

/**
 * Compares the highest dice pairwise (`min` of both counts); the lower die loses one army,
 * a tie goes to the defender. Surplus dice are ignored.
 */
export function resolveRoll(
  attackerDice: readonly number[],
  defenderDice: readonly number[],
): RollOutcome {
  const a = [...attackerDice].sort((x, y) => y - x);
  const d = [...defenderDice].sort((x, y) => y - x);
  let attackerLosses = 0;
  let defenderLosses = 0;
  for (let i = 0; i < Math.min(a.length, d.length); i++) {
    if (a[i]! > d[i]!) defenderLosses += 1;
    else attackerLosses += 1;
  }
  return { attackerLosses, defenderLosses };
}
