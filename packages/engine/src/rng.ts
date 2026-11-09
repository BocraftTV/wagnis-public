import type { Rng } from "./types.js";

/** Deterministic RNG (mulberry32) for tests and reproducible setups. */
export function createSeededRng(seed: number): Rng {
  let a = seed >>> 0;
  const next = (): number => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return { int: (maxExclusive) => Math.floor(next() * maxExclusive) };
}

/**
 * Test RNG with a fixed sequence of die faces (1-6), consumed by `int(6)` calls in order.
 * Throws when the sequence is exhausted or asked for anything but a die, instead of guessing.
 */
export function createDiceRng(faces: readonly number[]): Rng & { remaining(): number } {
  let i = 0;
  return {
    int(maxExclusive) {
      if (maxExclusive !== 6)
        throw new Error(`dice rng: expected int(6), got int(${maxExclusive})`);
      if (i >= faces.length) throw new Error("dice rng: sequence exhausted");
      return faces[i++]! - 1;
    },
    remaining: () => faces.length - i,
  };
}
