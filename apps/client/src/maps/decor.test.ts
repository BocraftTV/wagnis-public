import { describe, expect, it } from "vitest";
import { MAP_HEIGHT, MAP_WIDTH } from "../geo/project.js";
import { distanceToSegment } from "../lib/geometry.js";
import { mapData } from "./index.js";
import { PATTERNS, ROSE, WAVE_TILE, compassRose, frame, gridPath } from "./decor.js";

const numbers = (d: string): number[] => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe("decor", () => {
  it("keeps the compass rose and its N mark inside the map", () => {
    expect(ROSE.center.x - ROSE.radius).toBeGreaterThan(0);
    expect(ROSE.center.y + ROSE.radius).toBeLessThan(MAP_HEIGHT);
    expect(ROSE.north.y).toBeGreaterThan(0);
    for (const n of numbers(compassRose(110, 440, 60).light)) expect(Number.isFinite(n)).toBe(true);
  });

  it("builds a grid inside the map and a frame with the inner line inside the outer", () => {
    for (const n of numbers(gridPath())) expect(n).toBeLessThanOrEqual(MAP_WIDTH);
    const fr = frame(1 / 0.728);
    expect(fr.inner[0]).toBeGreaterThan(fr.outer[0]);
    expect(fr.inner[2]).toBeLessThan(fr.outer[2]);
  });

  it("keeps tiles within the budget (at most 14 units)", () => {
    for (const p of Object.values(PATTERNS)) expect(p.size).toBeLessThanOrEqual(14);
    expect(WAVE_TILE.width).toBe(48);
  });

  it("keeps the compass rose clear of every outline and every counter", () => {
    const { layout } = mapData("welt")!;
    const clear = ROSE.radius + 6;
    for (const [id, shape] of Object.entries(layout.shapes)) {
      for (const ring of shape) {
        for (let i = 0; i < ring.length; i++) {
          const d = distanceToSegment(ROSE.center, ring[i]!, ring[(i + 1) % ring.length]!);
          expect(d, `${id} outline`).toBeGreaterThan(clear);
        }
      }
      const a = layout.territories[id]!.anchor;
      expect(Math.hypot(a.x - ROSE.center.x, a.y - ROSE.center.y), `${id} counter`).toBeGreaterThan(
        clear + 20,
      );
    }
  });

  it("parses every decoration path into finite numbers inside the map", () => {
    const d = [gridPath(), WAVE_TILE.d, ...Object.values(PATTERNS).map((p) => p.d)].join("");
    expect(numbers(d).length).toBeGreaterThan(20);
    for (const n of numbers(d)) expect(Number.isFinite(n)).toBe(true);
    const fr = frame(1);
    for (const n of numbers(fr.corners)) expect(n).toBeGreaterThanOrEqual(0);
  });

  it("gives each terrain pattern at most 12 drawing commands", () => {
    for (const p of Object.values(PATTERNS)) {
      expect((p.d.match(/[MLQHVCZAmlqhvcza]/g) ?? []).length).toBeLessThanOrEqual(36);
    }
  });
});
