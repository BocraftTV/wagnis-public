import { describe, expect, it } from "vitest";
import { encodeText, maxBytes } from "./encode.js";
import {
  MASK_COUNT,
  buildMatrix,
  formatBits,
  penalty,
  penaltyBalance,
  penaltyBlocks,
  penaltyFinderLike,
  penaltyRuns,
  qrMatrix,
  versionBits,
} from "./matrix.js";
import type { Matrix } from "./matrix.js";
import { QUIET_ZONE, matrixPath, moduleSize, symbolModules } from "./render.js";
import { decodeSymbol } from "./test-decoder.js";
import { MAX_VERSION, sizeOf, versionSpec } from "./tables.js";

const bin = (n: number, len: number) => n.toString(2).padStart(len, "0");
const grid = (n: number, fill: (r: number, c: number) => boolean): Matrix =>
  Array.from({ length: n }, (_, r) => Array.from({ length: n }, (_, c) => fill(r, c)));

function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

describe("format and version information", () => {
  it("matches the known bit strings", () => {
    expect(bin(formatBits(0), 15)).toBe("101010000010010"); // M, mask 0
    expect(bin(formatBits(0, 0b01), 15)).toBe("111011111000100"); // L, mask 0
    expect(bin(versionBits(7), 18)).toBe("000111110010010100");
  });
  it("gives 15 valid BCH words for all masks at level M", () => {
    for (let mask = 0; mask < MASK_COUNT; mask++) {
      let rest = formatBits(mask) ^ 0x5412;
      for (let i = 14; i >= 10; i--) if ((rest >>> i) & 1) rest ^= 0x537 << (i - 10);
      expect(rest, `mask ${mask}`).toBe(0);
      expect(formatBits(mask)).toBeLessThan(1 << 15);
    }
  });
});

describe("penalty rules", () => {
  it("rule 1: runs", () => {
    expect(penaltyRuns(grid(6, () => false))).toBe(48); // 12 lines with a run of 6: 3 + 1 each
    expect(penaltyRuns(grid(5, (r, c) => (r + c) % 2 === 0))).toBe(0);
  });
  it("rule 2: 2x2 blocks", () => {
    expect(penaltyBlocks(grid(3, () => false))).toBe(12);
    expect(penaltyBlocks(grid(5, (r, c) => (r + c) % 2 === 0))).toBe(0);
  });
  it("rule 3: finder-like patterns", () => {
    const row = [1, 0, 1, 1, 1, 0, 1, 0, 0, 0, 0].map(Boolean);
    expect(penaltyFinderLike(grid(11, (r, c) => r === 3 && row[c]!))).toBe(40);
    const rev = [...row].reverse();
    expect(penaltyFinderLike(grid(11, (r, c) => c === 5 && rev[r]!))).toBe(40);
    expect(penaltyFinderLike(grid(11, () => false))).toBe(0);
  });
  it("rule 4: balance", () => {
    expect(penaltyBalance(grid(10, () => false))).toBe(100);
    expect(penaltyBalance(grid(10, () => true))).toBe(100);
    expect(penaltyBalance(grid(10, (r) => r < 5))).toBe(0);
    expect(penaltyBalance(grid(10, (r, c) => r * 10 + c < 40))).toBe(20); // 40 % dark: 10 points off -> 2 steps
  });
  it("adds all rules", () => {
    expect(penalty(grid(5, () => false))).toBe(30 + 48 + 100);
    expect(penalty(grid(5, (r, c) => (r + c) % 2 === 0))).toBe(0);
  });
});

describe("structure", () => {
  const text = (v: number) => "x".repeat(maxBytes(v));

  it("has the side length, finders, timing, dark module and alignment patterns", () => {
    for (let v = 1; v <= MAX_VERSION; v++) {
      const r = qrMatrix(text(v));
      if (!r.ok) throw new Error("not ok");
      const m = r.matrix;
      const n = sizeOf(v);
      expect(r.version).toBe(v);
      expect(m).toHaveLength(21 + 4 * (v - 1));
      expect(m.every((row) => row.length === n)).toBe(true);
      // finder patterns: 7x7 ring, 3x3 core, light ring between
      for (const [r0, c0] of [
        [0, 0],
        [0, n - 7],
        [n - 7, 0],
      ] as const) {
        for (let y = 0; y < 7; y++) {
          for (let x = 0; x < 7; x++) {
            const ring = Math.max(Math.abs(y - 3), Math.abs(x - 3));
            expect(m[r0 + y]![c0 + x], `v${v} finder ${r0},${c0} ${y},${x}`).toBe(ring !== 2);
          }
        }
      }
      // separators
      for (let i = 0; i < 8; i++) {
        expect(m[7]![i]).toBe(false);
        expect(m[i]![7]).toBe(false);
        expect(m[7]![n - 1 - i]).toBe(false);
        expect(m[i]![n - 8]).toBe(false);
        expect(m[n - 8]![i]).toBe(false);
        expect(m[n - 1 - i]![7]).toBe(false);
      }
      for (let i = 8; i < n - 8; i++) {
        expect(m[6]![i]).toBe(i % 2 === 0);
        expect(m[i]![6]).toBe(i % 2 === 0);
      }
      expect(m[n - 8]![8]).toBe(true);
      // alignment patterns (not at the three finders)
      const c = versionSpec(v).alignment;
      c.forEach((cy, i) =>
        c.forEach((cx, j) => {
          const atFinder =
            (i === 0 && j === 0) ||
            (i === 0 && j === c.length - 1) ||
            (i === c.length - 1 && j === 0);
          if (atFinder) return;
          for (let dy = -2; dy <= 2; dy++) {
            for (let dx = -2; dx <= 2; dx++) {
              expect(m[cy + dy]![cx + dx], `v${v} align ${cy},${cx}`).toBe(
                Math.max(Math.abs(dx), Math.abs(dy)) !== 1,
              );
            }
          }
        }),
      );
    }
  });
});

describe("round trip with the independent reader", () => {
  it("reads back 200 addresses and texts exactly, in the smallest version", () => {
    const next = lcg(2024);
    const pick = <T>(xs: readonly T[]) => xs[Math.floor(next() * xs.length)]!;
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const code = () => Array.from({ length: 6 }, () => alphabet[Math.floor(next() * 32)]).join("");
    const hosts = [
      "wagnis.example.test",
      "192.0.2.10",
      "10.0.0.7",
      "spiel.heim.example.test",
      "a.test",
    ];
    const texts: string[] = [];
    for (let i = 0; i < 100; i++) {
      const port = next() < 0.5 ? `:${1000 + Math.floor(next() * 60000)}` : "";
      texts.push(`${pick(["http", "https"])}://${pick(hosts)}${port}/r/${code()}`);
    }
    for (let i = 0; i < 100; i++) {
      const len = 1 + Math.floor(next() * maxBytes(MAX_VERSION));
      texts.push(
        Array.from({ length: len }, () => String.fromCharCode(32 + Math.floor(next() * 95))).join(
          "",
        ),
      );
    }
    expect(texts).toHaveLength(200);
    for (const t of texts) {
      const r = qrMatrix(t);
      if (!r.ok) throw new Error(`not ok: ${t}`);
      expect(decodeSymbol(r.matrix), t).toEqual({ text: t });
      const smaller = r.version === 1 ? 0 : maxBytes(r.version - 1);
      expect(t.length > smaller && t.length <= maxBytes(r.version), t).toBe(true);
    }
  });
  it("reads every version at full capacity with every mask", () => {
    for (let v = 1; v <= MAX_VERSION; v++) {
      const t = Array.from({ length: maxBytes(v) }, (_, i) =>
        String.fromCharCode(33 + ((i * 7) % 90)),
      ).join("");
      const e = encodeText(t);
      if (!e.ok) throw new Error("not ok");
      for (let mask = 0; mask < MASK_COUNT; mask++) {
        const built = buildMatrix(e.version, e.codewords, mask);
        expect(decodeSymbol(built.matrix), `v${v} mask ${mask}`).toEqual({ text: t });
      }
    }
  });
  it("notices damage", () => {
    const r = qrMatrix("http://192.0.2.10:3000/r/K7M2XQ");
    if (!r.ok) throw new Error("not ok");
    const bad = r.matrix.map((row) => [...row]);
    bad[r.matrix.length - 1]![r.matrix.length - 1] =
      !bad[r.matrix.length - 1]![r.matrix.length - 1];
    expect(decodeSymbol(bad)).toHaveProperty("error");
  });
});

describe("mask choice", () => {
  it("picks the lowest penalty, the lowest number on ties", () => {
    for (const t of [
      "http://192.0.2.10:3000/r/K7M2XQ",
      "https://wagnis.example.test/r/ABCDEF",
      "a",
      "x".repeat(100),
    ]) {
      const e = encodeText(t);
      if (!e.ok) throw new Error("not ok");
      const scores = Array.from({ length: MASK_COUNT }, (_, k) =>
        penalty(buildMatrix(e.version, e.codewords, k).matrix),
      );
      const best = buildMatrix(e.version, e.codewords);
      expect(best.mask).toBe(scores.indexOf(Math.min(...scores)));
      expect(penalty(best.matrix)).toBe(Math.min(...scores));
    }
  });
});

describe("limits", () => {
  it("returns error values", () => {
    expect(qrMatrix("")).toEqual({ ok: false, reason: "empty" });
    expect(qrMatrix("ä")).toEqual({ ok: false, reason: "nonAscii" });
    expect(qrMatrix("a".repeat(maxBytes(MAX_VERSION) + 1))).toEqual({
      ok: false,
      reason: "tooLong",
    });
  });
});

describe("render", () => {
  it("covers exactly the dark modules", () => {
    const r = qrMatrix("http://192.0.2.10:3000/r/K7M2XQ");
    if (!r.ok) throw new Error("not ok");
    const path = matrixPath(r.matrix);
    const n = symbolModules(r.matrix);
    expect(n).toBe(r.matrix.length + 2 * QUIET_ZONE);
    const back = grid(n, () => false);
    const re = /M(\d+) (\d+)h(\d+)v1h-(\d+)z/g;
    let used = 0;
    for (const hit of path.matchAll(re)) {
      const [x, y, len] = [Number(hit[1]), Number(hit[2]), Number(hit[3])];
      expect(Number(hit[4])).toBe(len);
      for (let i = 0; i < len; i++) {
        expect(back[y]![x + i]).toBe(false); // no module twice
        back[y]![x + i] = true;
      }
      used += hit[0].length;
    }
    expect(used).toBe(path.length); // nothing but runs in the path
    const expected = grid(n, (y, x) => r.matrix[y - QUIET_ZONE]?.[x - QUIET_ZONE] ?? false);
    expect(back).toEqual(expected);
  });
  it("chooses whole pixels per module that fit, at least 220 px at lobby width", () => {
    expect(moduleSize(320, 41)).toBe(7);
    expect(moduleSize(10, 41)).toBe(1);
    for (let v = 1; v <= MAX_VERSION; v++) {
      const modules = sizeOf(v) + 2 * QUIET_ZONE;
      for (const available of [320, 360, 600]) {
        const px = moduleSize(available, modules);
        expect(Number.isInteger(px)).toBe(true);
        expect(px * modules).toBeLessThanOrEqual(available);
        expect(px * modules).toBeGreaterThanOrEqual(220);
      }
    }
  });
});
