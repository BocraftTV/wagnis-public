/// <reference types="node" />
// Performance and privacy rules of the dice animation as a source test (plan 008, 3.4, 3.5; plan 006, 5.8).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");
const strip = (s: string) =>
  s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*\/\/.*$/gm, "");
const dice = strip(read("../components/DiceRoll.svelte"));
const logic = strip(read("./dice.ts"));

describe("dice animation sources", () => {
  it("DiceRoll paints without filter, shadow or blur", () => {
    expect(dice).not.toMatch(/filter|box-shadow|drop-shadow|text-shadow|blur\(|<mask|clip-path/);
  });
  it("animates only transform and opacity", () => {
    const blocks = [...dice.matchAll(/@keyframes\s+\w+\s*\{([\s\S]*?\n\s*\})\s*\}/g)];
    expect(blocks.length).toBeGreaterThan(0);
    for (const [, body] of blocks) {
      const props = [...body!.matchAll(/([a-z-]+)\s*:/g)].map((m) => m[1]!);
      expect(props.length).toBeGreaterThan(0);
      for (const p of props) expect(["transform", "opacity"], p).toContain(p);
    }
  });
  it("handles prefers-reduced-motion in the style sheet", () => {
    expect(dice).toMatch(/@media \(prefers-reduced-motion: reduce\)[\s\S]*animation:\s*none/);
  });
  it("has no randomness, no loop timer and no external address", () => {
    expect(logic).not.toMatch(/Math\.random|crypto\.|Date\.now|performance\.now/);
    expect(dice).not.toMatch(/setInterval|requestAnimationFrame|Math\.random/);
    for (const text of [dice, logic]) expect(text).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });
  it("draws at most five dice", () => {
    expect(dice).toMatch(/ATTACKER_X = \[[^\]]*\]/);
    const count = (name: string) =>
      (dice.match(new RegExp(`${name} = \\[([^\\]]*)\\]`))![1]!.match(/\d+/g) ?? []).length;
    expect(count("ATTACKER_X") + count("DEFENDER_X")).toBe(5);
  });
});
