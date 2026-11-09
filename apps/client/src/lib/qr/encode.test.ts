import { describe, expect, it } from "vitest";
import { gfExp, gfMul } from "./gf256.js";
import { encodeText, maxBytes } from "./encode.js";
import { generatorPoly, rsRemainder } from "./reed-solomon.js";
import {
  MAX_VERSION,
  blockCount,
  dataCodewords,
  remainderBits,
  sizeOf,
  totalCodewords,
  versionSpec,
} from "./tables.js";

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s >>> 24;
  };
}

/** Evaluates a polynomial (highest coefficient first) at x in GF(256). */
function evalAt(poly: readonly number[], x: number): number {
  let acc = 0;
  for (const c of poly) acc = gfMul(acc, x) ^ c;
  return acc;
}

describe("gf256", () => {
  it("multiplies with the field rules", () => {
    expect(gfMul(0, 77)).toBe(0);
    expect(gfMul(1, 77)).toBe(77);
    expect(gfMul(2, 0x80)).toBe(0x1d); // x * x^7 = x^8 = x^4 + x^3 + x^2 + 1
    expect(gfExp(0)).toBe(1);
    expect(gfExp(8)).toBe(0x1d);
    expect(gfExp(255)).toBe(1);
    expect(gfMul(gfExp(100), gfExp(200))).toBe(gfExp(300));
  });
});

describe("reed-solomon", () => {
  it("matches the check words of 'HELLO WORLD' (version 1-M)", () => {
    const data = [32, 91, 11, 120, 209, 114, 220, 77, 67, 64, 236, 17, 236, 17, 236, 17];
    expect(rsRemainder(data, 10)).toEqual([196, 35, 39, 119, 235, 215, 231, 226, 93, 23]);
  });
  it("matches the check words of the standard's digit example", () => {
    const data = [16, 32, 12, 86, 97, 128, 236, 17, 236, 17, 236, 17, 236, 17, 236, 17];
    expect(rsRemainder(data, 10)).toEqual([165, 36, 212, 193, 237, 54, 199, 135, 44, 85]);
  });
  it("makes every codeword vanish at the generator's roots (syndrome 0)", () => {
    const next = lcg(7);
    for (const ec of [7, 10, 16, 18, 22, 24, 26]) {
      const data = Array.from({ length: 30 }, next);
      const word = [...data, ...rsRemainder(data, ec)];
      for (let i = 0; i < ec; i++) expect(evalAt(word, gfExp(i))).toBe(0);
      // and a single damaged byte is noticed
      word[3] = word[3]! ^ 0x55;
      expect(evalAt(word, gfExp(0))).not.toBe(0);
    }
    expect(generatorPoly(10)).toHaveLength(11);
    expect(generatorPoly(10)[0]).toBe(1);
  });
});

describe("tables", () => {
  it("has the total codeword counts of the standard", () => {
    const totals = [26, 44, 70, 100, 134, 172, 196, 242, 292, 346];
    totals.forEach((total, i) => expect(totalCodewords(i + 1)).toBe(total));
  });
  it("agrees with the data module count of the symbol layout", () => {
    for (let v = 1; v <= MAX_VERSION; v++) {
      const a = Math.floor(v / 7) + 2;
      const modules =
        (16 * v + 128) * v + 64 - (v >= 2 ? (25 * a - 10) * a - 55 : 0) - (v >= 7 ? 36 : 0);
      expect(modules, `version ${v}`).toBe(totalCodewords(v) * 8 + remainderBits(v));
      expect(sizeOf(v)).toBe(21 + 4 * (v - 1));
    }
  });
  it("lists alignment centres that start at 6 and end 7 modules before the edge", () => {
    expect(versionSpec(1).alignment).toEqual([]);
    for (let v = 2; v <= MAX_VERSION; v++) {
      const a = versionSpec(v).alignment;
      expect(a[0]).toBe(6);
      expect(a.at(-1)).toBe(sizeOf(v) - 7);
    }
  });
});

describe("encodeText", () => {
  const text = (n: number) => "a".repeat(n);

  it("has the capacities of the plan (version 4: 62 bytes, version 6: 106 bytes)", () => {
    expect(maxBytes(4)).toBe(62);
    expect(maxBytes(6)).toBe(106);
    expect(maxBytes(1)).toBe(14);
  });
  it("picks the smallest version that fits", () => {
    for (let v = 1; v <= MAX_VERSION; v++) {
      const fit = encodeText(text(maxBytes(v)));
      expect(fit.ok && fit.version).toBe(v);
      if (v < MAX_VERSION) {
        const over = encodeText(text(maxBytes(v) + 1));
        expect(over.ok && over.version).toBe(v + 1);
      }
    }
  });
  it("builds mode, count, data, terminator and padding", () => {
    const r = encodeText("A");
    if (!r.ok) throw new Error("not ok");
    expect(r.version).toBe(1);
    // de-interleaving a single block: first 16 words are the data words
    const words = r.codewords.slice(0, 16);
    expect(words.slice(0, 3)).toEqual([0x40, 0x14, 0x10]); // 0100 | 00000001 | 01000001 | 0000
    expect(words.slice(3, 7)).toEqual([0xec, 0x11, 0xec, 0x11]);
    expect(r.codewords).toHaveLength(26);
  });
  it("interleaves blocks so that every block is a valid Reed-Solomon word", () => {
    const next = lcg(99);
    for (let v = 1; v <= MAX_VERSION; v++) {
      const input = Array.from({ length: maxBytes(v) }, () => 33 + (next() % 90));
      const r = encodeText(String.fromCharCode(...input));
      if (!r.ok) throw new Error("not ok");
      expect(r.version).toBe(v);
      expect(r.codewords).toHaveLength(totalCodewords(v));
      const spec = versionSpec(v);
      const sizes = spec.groups.flatMap(([count, size]) => Array<number>(count).fill(size));
      expect(sizes).toHaveLength(blockCount(v));
      const blocks = sizes.map(() => [] as number[]);
      let at = 0;
      const longest = Math.max(...sizes);
      for (let i = 0; i < longest; i++) {
        sizes.forEach((size, b) => {
          if (i < size) blocks[b]!.push(r.codewords[at++]!);
        });
      }
      for (let i = 0; i < spec.ecPerBlock; i++) blocks.forEach((b) => b.push(r.codewords[at++]!));
      expect(at).toBe(totalCodewords(v));
      expect(blocks.reduce((n, b) => n + b.length - spec.ecPerBlock, 0)).toBe(dataCodewords(v));
      for (const b of blocks) {
        for (let i = 0; i < spec.ecPerBlock; i++) expect(evalAt(b, gfExp(i))).toBe(0);
      }
    }
  });
  it("returns an error value instead of throwing", () => {
    expect(encodeText("")).toEqual({ ok: false, reason: "empty" });
    expect(encodeText("Käse")).toEqual({ ok: false, reason: "nonAscii" });
    expect(encodeText("a".repeat(maxBytes(10) + 1))).toEqual({ ok: false, reason: "tooLong" });
  });
});
