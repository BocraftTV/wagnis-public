import { gfExp, gfMul } from "./gf256.js";

/** Generator polynomial (x - α^0)…(x - α^(degree-1)), coefficients highest first, leading 1 included. */
export function generatorPoly(degree: number): number[] {
  let poly = [1];
  for (let i = 0; i < degree; i++) {
    const next = new Array<number>(poly.length + 1).fill(0);
    const root = gfExp(i);
    for (let j = 0; j < poly.length; j++) {
      next[j] = next[j]! ^ poly[j]!;
      next[j + 1] = next[j + 1]! ^ gfMul(poly[j]!, root);
    }
    poly = next;
  }
  return poly;
}

/** The `ecLength` error correction codewords of `data` (remainder of data·x^ecLength divided by the generator). */
export function rsRemainder(data: readonly number[], ecLength: number): number[] {
  const gen = generatorPoly(ecLength);
  const rem = new Array<number>(ecLength).fill(0);
  for (const byte of data) {
    const factor = byte ^ rem.shift()!;
    rem.push(0);
    for (let i = 0; i < ecLength; i++) rem[i] = rem[i]! ^ gfMul(gen[i + 1]!, factor);
  }
  return rem;
}
