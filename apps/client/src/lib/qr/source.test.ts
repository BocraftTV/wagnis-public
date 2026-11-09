/// <reference types="node" />
// Source rules for the QR code (plan 008, 6): no network access, no external address, no heavy painting.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const here = new URL("./", import.meta.url);
const appFiles = readdirSync(here).filter(
  (f) => f.endsWith(".ts") && !f.endsWith(".test.ts") && f !== "test-decoder.ts",
);
const strip = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

describe("lib/qr sources", () => {
  it("finds the encoder files", () => {
    expect(appFiles).toEqual(
      expect.arrayContaining(["encode.ts", "matrix.ts", "render.ts", "target.ts", "tables.ts"]),
    );
  });
  it("has no network access, no image loading and no http address", () => {
    for (const f of appFiles) {
      const text = strip(readFileSync(new URL(f, here), "utf8"));
      expect(text, f).not.toMatch(
        /\bfetch\s*\(|XMLHttpRequest|\bnew Image\b|WebSocket|sendBeacon|https?:\/\//,
      );
    }
  });
  it("QrCode.svelte paints plainly: no filter, shadow, blur or animation", () => {
    const text = strip(
      readFileSync(new URL("../../components/QrCode.svelte", import.meta.url), "utf8"),
    );
    expect(text).not.toMatch(
      /filter|box-shadow|drop-shadow|text-shadow|blur|animation|transition|@keyframes/,
    );
    expect(text).not.toMatch(/https?:\/\/(?!www\.w3\.org)/);
  });
});
