// Versions 1 to 10 at error correction level M (ISO/IEC 18004).

export const MIN_VERSION = 1;
export const MAX_VERSION = 10;

export interface VersionSpec {
  /** Error correction codewords in every block. */
  ecPerBlock: number;
  /** Block groups: number of blocks and data codewords in each of them. */
  groups: readonly (readonly [count: number, dataPerBlock: number])[];
  /** Alignment pattern centre coordinates (rows and columns); empty for version 1. */
  alignment: readonly number[];
}

const SPECS: Record<number, VersionSpec> = {
  1: { ecPerBlock: 10, groups: [[1, 16]], alignment: [] },
  2: { ecPerBlock: 16, groups: [[1, 28]], alignment: [6, 18] },
  3: { ecPerBlock: 26, groups: [[1, 44]], alignment: [6, 22] },
  4: { ecPerBlock: 18, groups: [[2, 32]], alignment: [6, 26] },
  5: { ecPerBlock: 24, groups: [[2, 43]], alignment: [6, 30] },
  6: { ecPerBlock: 16, groups: [[4, 27]], alignment: [6, 34] },
  7: { ecPerBlock: 18, groups: [[4, 31]], alignment: [6, 22, 38] },
  8: {
    ecPerBlock: 22,
    groups: [
      [2, 38],
      [2, 39],
    ],
    alignment: [6, 24, 42],
  },
  9: {
    ecPerBlock: 22,
    groups: [
      [3, 36],
      [2, 37],
    ],
    alignment: [6, 26, 46],
  },
  10: {
    ecPerBlock: 26,
    groups: [
      [4, 43],
      [1, 44],
    ],
    alignment: [6, 28, 50],
  },
};

export function versionSpec(version: number): VersionSpec {
  const spec = SPECS[version];
  if (!spec) throw new RangeError("QR version out of range");
  return spec;
}

export function blockCount(version: number): number {
  return versionSpec(version).groups.reduce((n, [count]) => n + count, 0);
}

export function dataCodewords(version: number): number {
  return versionSpec(version).groups.reduce((n, [count, data]) => n + count * data, 0);
}

export function totalCodewords(version: number): number {
  return dataCodewords(version) + blockCount(version) * versionSpec(version).ecPerBlock;
}

/** Bits after the last codeword that stay empty (0 for version 1 and 7 to 13, 7 for 2 to 6). */
export function remainderBits(version: number): number {
  return version >= 2 && version <= 6 ? 7 : 0;
}

/** Bits of the character count field in byte mode. */
export function countBits(version: number): number {
  return version < 10 ? 8 : 16;
}

export function sizeOf(version: number): number {
  return 21 + 4 * (version - 1);
}
