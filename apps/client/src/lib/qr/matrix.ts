import { encodeText } from "./encode.js";
import { sizeOf, totalCodewords, versionSpec } from "./tables.js";

/** `matrix[row][col]`, true for a dark module. */
export type Matrix = boolean[][];

const FORMAT_BITS_M = 0b00;

/** 15 format bits for level M and the given mask: 5 data bits, BCH(15,5) remainder, XOR 0x5412. */
export function formatBits(mask: number, levelBits: number = FORMAT_BITS_M): number {
  const data = (levelBits << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

/** 18 version bits (version 7 and up): 6 data bits and the BCH(18,6) remainder. */
export function versionBits(version: number): number {
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  return (version << 12) | rem;
}

const bit = (value: number, i: number) => ((value >>> i) & 1) === 1;

interface Grid {
  size: number;
  dark: boolean[][];
  isFunction: boolean[][];
}

function newGrid(size: number): Grid {
  const make = () => Array.from({ length: size }, () => new Array<boolean>(size).fill(false));
  return { size, dark: make(), isFunction: make() };
}

function setFunction(g: Grid, x: number, y: number, dark: boolean): void {
  g.dark[y]![x] = dark;
  g.isFunction[y]![x] = true;
}

function drawFinder(g: Grid, cx: number, cy: number): void {
  for (let dy = -4; dy <= 4; dy++) {
    for (let dx = -4; dx <= 4; dx++) {
      const x = cx + dx;
      const y = cy + dy;
      if (x < 0 || y < 0 || x >= g.size || y >= g.size) continue;
      const dist = Math.max(Math.abs(dx), Math.abs(dy));
      setFunction(g, x, y, dist !== 2 && dist !== 4);
    }
  }
}

function drawAlignment(g: Grid, cx: number, cy: number): void {
  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      setFunction(g, cx + dx, cy + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
    }
  }
}

function drawFormat(g: Grid, mask: number): void {
  const bits = formatBits(mask);
  const { size } = g;
  for (let i = 0; i <= 5; i++) setFunction(g, 8, i, bit(bits, i));
  setFunction(g, 8, 7, bit(bits, 6));
  setFunction(g, 8, 8, bit(bits, 7));
  setFunction(g, 7, 8, bit(bits, 8));
  for (let i = 9; i < 15; i++) setFunction(g, 14 - i, 8, bit(bits, i));
  for (let i = 0; i < 8; i++) setFunction(g, size - 1 - i, 8, bit(bits, i));
  for (let i = 8; i < 15; i++) setFunction(g, 8, size - 15 + i, bit(bits, i));
  setFunction(g, 8, size - 8, true); // the always-dark module
}

function drawVersion(g: Grid, version: number): void {
  if (version < 7) return;
  const bits = versionBits(version);
  for (let i = 0; i < 18; i++) {
    const a = g.size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    setFunction(g, a, b, bit(bits, i));
    setFunction(g, b, a, bit(bits, i));
  }
}

/** Function patterns of the version; the format area is drawn for `mask` (reserved with mask 0 first). */
function functionGrid(version: number, mask: number): Grid {
  const g = newGrid(sizeOf(version));
  for (let i = 0; i < g.size; i++) {
    setFunction(g, 6, i, i % 2 === 0);
    setFunction(g, i, 6, i % 2 === 0);
  }
  drawFinder(g, 3, 3);
  drawFinder(g, g.size - 4, 3);
  drawFinder(g, 3, g.size - 4);
  const centres = versionSpec(version).alignment;
  const last = centres.length - 1;
  centres.forEach((cy, i) => {
    centres.forEach((cx, j) => {
      const atFinder = (i === 0 && j === 0) || (i === 0 && j === last) || (i === last && j === 0);
      if (!atFinder) drawAlignment(g, cx, cy);
    });
  });
  drawFormat(g, mask);
  drawVersion(g, version);
  return g;
}

/** Writes the codewords in the zigzag order of the standard into the free modules. */
function placeData(g: Grid, codewords: readonly number[]): void {
  // remainder bits (version 2 to 6, 7 bits) stay light
  const total = codewords.length * 8;
  let i = 0;
  for (let right = g.size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5; // the vertical timing column is skipped
    for (let vert = 0; vert < g.size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? g.size - 1 - vert : vert;
        if (!g.isFunction[y]![x] && i < total) {
          g.dark[y]![x] = bit(codewords[i >>> 3]!, 7 - (i & 7));
          i++;
        }
      }
    }
  }
}

const MASKS: readonly ((x: number, y: number) => boolean)[] = [
  (x, y) => (x + y) % 2 === 0,
  (_x, y) => y % 2 === 0,
  (x) => x % 3 === 0,
  (x, y) => (x + y) % 3 === 0,
  (x, y) => (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0,
  (x, y) => ((x * y) % 2) + ((x * y) % 3) === 0,
  (x, y) => (((x * y) % 2) + ((x * y) % 3)) % 2 === 0,
  (x, y) => (((x + y) % 2) + ((x * y) % 3)) % 2 === 0,
];

export const MASK_COUNT = MASKS.length;

function applyMask(g: Grid, mask: number): void {
  for (let y = 0; y < g.size; y++) {
    for (let x = 0; x < g.size; x++) {
      if (!g.isFunction[y]![x] && MASKS[mask]!(x, y)) g.dark[y]![x] = !g.dark[y]![x];
    }
  }
}

/** Rule 1: runs of five or more equal modules in a row or column, 3 + (length − 5) each. */
export function penaltyRuns(m: Matrix): number {
  const n = m.length;
  let score = 0;
  for (let k = 0; k < n; k++) {
    for (const at of [(i: number) => m[k]![i]!, (i: number) => m[i]![k]!]) {
      let run = 1;
      for (let i = 1; i <= n; i++) {
        if (i < n && at(i) === at(i - 1)) {
          run++;
        } else {
          if (run >= 5) score += 3 + (run - 5);
          run = 1;
        }
      }
    }
  }
  return score;
}

/** Rule 2: every 2×2 block of equal modules, 3 each. */
export function penaltyBlocks(m: Matrix): number {
  const n = m.length;
  let score = 0;
  for (let y = 0; y + 1 < n; y++) {
    for (let x = 0; x + 1 < n; x++) {
      const v = m[y]![x]!;
      if (m[y]![x + 1] === v && m[y + 1]![x] === v && m[y + 1]![x + 1] === v) score += 3;
    }
  }
  return score;
}

const FINDER_LIKE = [
  [true, false, true, true, true, false, true, false, false, false, false],
  [false, false, false, false, true, false, true, true, true, false, true],
];

/** Rule 3: 1:1:3:1:1 patterns with four light modules on one side (11-module windows), 40 each. */
export function penaltyFinderLike(m: Matrix): number {
  const n = m.length;
  let score = 0;
  for (let k = 0; k < n; k++) {
    for (let start = 0; start + 11 <= n; start++) {
      for (const pattern of FINDER_LIKE) {
        if (pattern.every((v, i) => m[k]![start + i] === v)) score += 40;
        if (pattern.every((v, i) => m[start + i]![k] === v)) score += 40;
      }
    }
  }
  return score;
}

/** Rule 4: 10 points per full 5 % the share of dark modules differs from 50 %. */
export function penaltyBalance(m: Matrix): number {
  const total = m.length * m.length;
  const dark = m.reduce((n, row) => n + row.filter(Boolean).length, 0);
  return 10 * Math.floor(Math.abs((dark * 100) / total - 50) / 5);
}

export function penalty(m: Matrix): number {
  return penaltyRuns(m) + penaltyBlocks(m) + penaltyFinderLike(m) + penaltyBalance(m);
}

export interface BuiltMatrix {
  matrix: Matrix;
  version: number;
  mask: number;
}

/** Builds the symbol; `forceMask` is for tests, otherwise the mask with the lowest penalty wins (ties: lowest). */
export function buildMatrix(
  version: number,
  codewords: readonly number[],
  forceMask?: number,
): BuiltMatrix {
  if (codewords.length !== totalCodewords(version)) throw new RangeError("wrong codeword count");
  const masks = forceMask === undefined ? [...MASKS.keys()] : [forceMask];
  let best: BuiltMatrix | undefined;
  let bestScore = Infinity;
  for (const mask of masks) {
    const g = functionGrid(version, mask);
    placeData(g, codewords);
    applyMask(g, mask);
    const score = penalty(g.dark);
    if (score < bestScore) {
      bestScore = score;
      best = { matrix: g.dark, version, mask };
    }
  }
  return best!;
}

export type QrResult =
  { ok: true; version: number; matrix: Matrix } | { ok: false; reason: string };

/** Text → finished symbol (level M, byte mode, version 1 to 10). Never throws for bad input. */
export function qrMatrix(text: string): QrResult {
  const encoded = encodeText(text);
  if (!encoded.ok) return encoded;
  const { matrix, version } = buildMatrix(encoded.version, encoded.codewords);
  return { ok: true, version, matrix };
}
