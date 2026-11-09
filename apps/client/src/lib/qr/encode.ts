import { rsRemainder } from "./reed-solomon.js";
import { MAX_VERSION, MIN_VERSION, countBits, dataCodewords, versionSpec } from "./tables.js";

export type EncodeResult =
  | { ok: true; version: number; codewords: number[] }
  | { ok: false; reason: "empty" | "nonAscii" | "tooLong" };

/** Most bytes that fit into `version` at level M in byte mode. */
export function maxBytes(version: number): number {
  return Math.floor((dataCodewords(version) * 8 - 4 - countBits(version)) / 8);
}

function pushBits(bits: number[], value: number, length: number): void {
  for (let i = length - 1; i >= 0; i--) bits.push((value >>> i) & 1);
}

/** Data codewords of `bytes` in byte mode for `version`: mode, count, data, terminator, padding 0xEC/0x11. */
function dataWords(bytes: readonly number[], version: number): number[] {
  const bits: number[] = [];
  pushBits(bits, 0b0100, 4);
  pushBits(bits, bytes.length, countBits(version));
  for (const b of bytes) pushBits(bits, b, 8);
  const capacityBits = dataCodewords(version) * 8;
  pushBits(bits, 0, Math.min(4, capacityBits - bits.length));
  while (bits.length % 8 !== 0) bits.push(0);
  const words: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    words.push(parseInt(bits.slice(i, i + 8).join(""), 2));
  }
  for (let pad = 0xec; words.length < dataCodewords(version); pad ^= 0xec ^ 0x11) words.push(pad);
  return words;
}

/** Splits into blocks, appends Reed-Solomon codewords and interleaves data, then error correction. */
function interleave(words: readonly number[], version: number): number[] {
  const spec = versionSpec(version);
  const blocks: { data: number[]; ec: number[] }[] = [];
  let at = 0;
  for (const [count, size] of spec.groups) {
    for (let i = 0; i < count; i++) {
      const data = words.slice(at, at + size);
      at += size;
      blocks.push({ data, ec: rsRemainder(data, spec.ecPerBlock) });
    }
  }
  const out: number[] = [];
  const longest = Math.max(...blocks.map((b) => b.data.length));
  for (let i = 0; i < longest; i++) {
    for (const b of blocks) if (i < b.data.length) out.push(b.data[i]!);
  }
  for (let i = 0; i < spec.ecPerBlock; i++) for (const b of blocks) out.push(b.ec[i]!);
  return out;
}

/** Encodes ASCII text in byte mode at level M, in the smallest version that fits. Never throws. */
export function encodeText(text: string): EncodeResult {
  if (text.length === 0) return { ok: false, reason: "empty" };
  const bytes: number[] = [];
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code > 0x7f) return { ok: false, reason: "nonAscii" };
    bytes.push(code);
  }
  for (let version = MIN_VERSION; version <= MAX_VERSION; version++) {
    if (bytes.length <= maxBytes(version)) {
      return { ok: true, version, codewords: interleave(dataWords(bytes, version), version) };
    }
  }
  return { ok: false, reason: "tooLong" };
}
