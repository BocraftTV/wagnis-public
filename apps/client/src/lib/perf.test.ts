/// <reference types="node" />
// Performance rules of the map (plan 006, 5.8) as a source test over the components and style sheets: nothing that
// makes Safari re-rasterize heavily during pan and pinch.
import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const dir = (rel: string): URL => new URL(rel, import.meta.url);
const sources = (rel: string, ext: string): [string, string][] =>
  readdirSync(dir(rel))
    .filter((f) => f.endsWith(ext))
    .map((f) => [f, readFileSync(new URL(f, dir(rel)), "utf8")]);

const MAP_FILES = [
  "MapCanvas.svelte",
  "MapBackdrop.svelte",
  "MapDefs.svelte",
  "MapControls.svelte",
];
const mapSources = sources("../components/", ".svelte").filter(([f]) => MAP_FILES.includes(f));

describe("map performance rules", () => {
  it("finds the map components", () => {
    expect(mapSources.map(([f]) => f).sort()).toEqual([...MAP_FILES].sort());
  });

  it("uses no filter, mask, clip-path, shadow or blur in the map components", () => {
    const banned =
      /filter\s*[=:]|<filter|feGaussianBlur|feDropShadow|\bmask\b|clip-path|<clipPath|box-shadow|drop-shadow|text-shadow|blur\(/;
    for (const [file, text] of mapSources) {
      // Comments may name the banned things; strip them first.
      const code = text.replace(/<!--[\s\S]*?-->/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
      expect(banned.test(code), file).toBe(false);
    }
  });

  it("defines at most four patterns (waves and three terrains)", () => {
    const count = mapSources.reduce((n, [, t]) => n + (t.match(/<pattern\b/g) ?? []).length, 0);
    expect(count).toBeLessThanOrEqual(4);
  });

  it("rewrites no stroke width per zoom step except the two sea route paths", () => {
    const canvas = mapSources.find(([f]) => f === "MapCanvas.svelte")![1];
    const perZoom = canvas.match(/stroke-width=\{[^}]*\/\s*s[^}]*\}/g) ?? [];
    expect(perZoom).toHaveLength(2);
  });

  it("keeps the other map decoration free of zoom-dependent attributes", () => {
    for (const f of ["MapBackdrop.svelte", "MapDefs.svelte"]) {
      const text = mapSources.find(([n]) => n === f)![1];
      expect(/\/\s*s\b|\bs\s*\}/.test(text.replace(/<style>[\s\S]*<\/style>/, "")), f).toBe(false);
    }
  });

  it("keeps all colors in colors.css (no hex or rgb value in components or other style sheets)", () => {
    const files = [
      ...mapSources,
      ...sources("../styles/", ".css").filter(([f]) => f !== "colors.css" && f !== "app.css"),
    ];
    for (const [file, text] of files) {
      expect(/#[0-9a-fA-F]{3,8}\b|\brgba?\(/.test(text), file).toBe(false);
    }
  });
});
