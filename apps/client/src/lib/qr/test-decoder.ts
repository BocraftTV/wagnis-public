// Independent QR reader for tests only (not imported by the app). It shares no code with matrix.ts and
// encode.ts except the block table; field arithmetic, function module map and bit order are written again.

import { blockCount, versionSpec } from "./tables.js";

type Matrix = boolean[][];

function mulSlow(a: number, b: number): number {
  let r = 0;
  for (let i = 0; i < 8; i++) {
    if ((b >> i) & 1) r ^= a << i;
  }
  for (let i = 15; i >= 8; i--) {
    if ((r >> i) & 1) r ^= 0x11d << (i - 8);
  }
  return r;
}

function powAlpha(n: number): number {
  let r = 1;
  for (let i = 0; i < n; i++) r = mulSlow(r, 2);
  return r;
}

/** Remainder of a 15-bit format word divided by x^10 + x^8 + x^5 + x^4 + x^2 + x + 1; 0 for a valid word. */
function bchRest(word: number, poly: number, degree: number): number {
  let rest = word;
  for (let i = 31; i >= degree; i--) {
    if ((rest >>> i) & 1) rest ^= poly << (i - degree);
  }
  return rest;
}

function alignmentCentres(version: number, size: number): number[] {
  if (version === 1) return [];
  const n = Math.floor(version / 7) + 2;
  const step = Math.ceil((size - 13) / (n * 2 - 2)) * 2;
  const out = [6];
  for (let p = size - 7; out.length < n; p -= step) out.splice(1, 0, p);
  return out;
}

function functionMap(version: number, size: number): boolean[][] {
  const f = Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  for (let r = 0; r < size; r++) {
    for (let c = 0; c < size; c++) {
      if (r < 9 && c < 9) f[r]![c] = true;
      if (r < 9 && c >= size - 8) f[r]![c] = true;
      if (r >= size - 8 && c < 9) f[r]![c] = true;
      if (r === 6 || c === 6) f[r]![c] = true;
      if (version >= 7 && ((r < 6 && c >= size - 11) || (c < 6 && r >= size - 11))) f[r]![c] = true;
    }
  }
  const centres = alignmentCentres(version, size);
  for (const cy of centres) {
    for (const cx of centres) {
      const corner =
        (cy === 6 && cx === 6) || (cy === 6 && cx === size - 7) || (cy === size - 7 && cx === 6);
      if (corner) continue;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) f[cy + dy]![cx + dx] = true;
    }
  }
  return f;
}

const MASK_TESTS: ((r: number, c: number) => boolean)[] = [
  (r, c) => (r + c) % 2 === 0,
  (r) => r % 2 === 0,
  (_r, c) => c % 3 === 0,
  (r, c) => (r + c) % 3 === 0,
  (r, c) => (Math.floor(r / 2) + Math.floor(c / 3)) % 2 === 0,
  (r, c) => ((r * c) % 2) + ((r * c) % 3) === 0,
  (r, c) => (((r * c) % 2) + ((r * c) % 3)) % 2 === 0,
  (r, c) => (((r + c) % 2) + ((r * c) % 3)) % 2 === 0,
];

/** Reads a level M byte mode symbol. Returns the text, or an error string describing what is wrong. */
export function decodeSymbol(m: Matrix): { text: string } | { error: string } {
  const size = m.length;
  if (size < 21 || (size - 21) % 4 !== 0 || m.some((row) => row.length !== size)) {
    return { error: "bad size" };
  }
  const version = (size - 21) / 4 + 1;
  const px = (r: number, c: number) => (m[r]![c] ? 1 : 0);

  // format information, both copies (bit 0 is the least significant bit of the word)
  const copy1: number[] = [];
  for (let i = 0; i <= 5; i++) copy1[i] = px(i, 8);
  copy1[6] = px(7, 8);
  copy1[7] = px(8, 8);
  copy1[8] = px(8, 7);
  for (let i = 9; i < 15; i++) copy1[i] = px(8, 14 - i);
  const copy2: number[] = [];
  for (let i = 0; i < 8; i++) copy2[i] = px(8, size - 1 - i);
  for (let i = 8; i < 15; i++) copy2[i] = px(size - 15 + i, 8);
  const word = (bits: number[]) => bits.reduce((n, b, i) => n | (b << i), 0);
  const w1 = word(copy1);
  if (w1 !== word(copy2)) return { error: "format copies differ" };
  const format = w1 ^ 0x5412;
  if (bchRest(format, 0x537, 10) !== 0) return { error: "format BCH" };
  if (format >> 13 !== 0) return { error: "not level M" };
  const mask = (format >> 10) & 7;

  if (version >= 7) {
    let v1 = 0;
    let v2 = 0;
    for (let i = 0; i < 18; i++) {
      v1 |= px(Math.floor(i / 3), size - 11 + (i % 3)) << i;
      v2 |= px(size - 11 + (i % 3), Math.floor(i / 3)) << i;
    }
    if (v1 !== v2 || v1 >> 12 !== version || bchRest(v1, 0x1f25, 12) !== 0) {
      return { error: "version information" };
    }
  }
  if (!m[size - 8]![8]) return { error: "dark module missing" };

  // read the free modules in zigzag order, undoing the mask
  const isFunction = functionMap(version, size);
  const bits: number[] = [];
  let upward = true;
  for (let col = size - 1; col > 0; col -= 2) {
    if (col === 6) col = 5;
    for (let k = 0; k < size; k++) {
      const r = upward ? size - 1 - k : k;
      for (const c of [col, col - 1]) {
        if (isFunction[r]![c]) continue;
        bits.push(px(r, c) ^ (MASK_TESTS[mask]!(r, c) ? 1 : 0));
      }
    }
    upward = !upward;
  }
  const spec = versionSpec(version);
  const blocks = blockCount(version);
  const total = spec.groups.reduce((n, [count, data]) => n + count * (data + spec.ecPerBlock), 0);
  const words: number[] = [];
  for (let i = 0; i < total; i++) {
    words.push(bits.slice(i * 8, i * 8 + 8).reduce((n, b) => (n << 1) | b, 0));
  }
  if (bits.length - total * 8 !== (version >= 2 && version <= 6 ? 7 : 0)) {
    return { error: "free module count" };
  }

  // undo the interleaving
  const sizes = spec.groups.flatMap(([count, data]) => Array<number>(count).fill(data));
  const data: number[][] = sizes.map(() => []);
  const ec: number[][] = sizes.map(() => []);
  let at = 0;
  for (let i = 0; i < Math.max(...sizes); i++) {
    sizes.forEach((size2, b) => {
      if (i < size2) data[b]!.push(words[at++]!);
    });
  }
  for (let i = 0; i < spec.ecPerBlock; i++) ec.forEach((e) => e.push(words[at++]!));
  if (at !== total || sizes.length !== blocks) return { error: "block layout" };

  // syndrome of every block
  for (let b = 0; b < blocks; b++) {
    const word2 = [...data[b]!, ...ec[b]!];
    for (let i = 0; i < spec.ecPerBlock; i++) {
      const x = powAlpha(i);
      let acc = 0;
      for (const c of word2) acc = mulSlow(acc, x) ^ c;
      if (acc !== 0) return { error: `syndrome of block ${b}` };
    }
  }

  // byte mode payload
  const payload = data
    .flat()
    .flatMap((w) => Array.from({ length: 8 }, (_, i) => (w >> (7 - i)) & 1));
  const take = (from: number, n: number) =>
    payload.slice(from, from + n).reduce((v, b) => (v << 1) | b, 0);
  if (take(0, 4) !== 0b0100) return { error: "not byte mode" };
  const countLen = version < 10 ? 8 : 16;
  const count = take(4, countLen);
  let text = "";
  for (let i = 0; i < count; i++) text += String.fromCharCode(take(4 + countLen + i * 8, 8));
  return { text };
}
