import { getMap } from "@wagnis/engine/map-data";
import { describe, expect, it } from "vitest";
import type { CountryRule, Target } from "./assign.js";
import { applyLenses, lensMinDerivative } from "./lens.js";
import {
  COUNTRIES,
  EXTRA_RINGS,
  GAP_MIN,
  ISLAND_MIN_AREA,
  KEEP_ISLANDS,
  KERBE_MAX,
  LENSES,
} from "./welt.regions.js";
import { LAT_BOTTOM, LAT_TOP, LON_LEFT, LON_RIGHT, project } from "./project.js";

const ids = new Set(getMap("welt")!.territories.map((t) => t.id));

function targets(t: Target): (string | null)[] {
  if (t === null || typeof t === "string") return [t];
  return [...targets(t.left), ...targets(t.right)];
}
function ruleTargets(rule: CountryRule | string | null): (string | null)[] {
  if (rule === null || typeof rule === "string") return [rule];
  return [...targets(rule.all), ...(rule.rings ?? []).flatMap((r) => targets(r.to))];
}

describe("welt.regions", () => {
  it("gives every one of the 42 territories at least one country", () => {
    const used = new Set(Object.values(COUNTRIES).flatMap(ruleTargets));
    for (const id of ids) expect(used.has(id), id).toBe(true);
  });

  it("names only territories of the world map (rules, cuts, island rows)", () => {
    for (const [code, rule] of Object.entries(COUNTRIES))
      for (const t of ruleTargets(rule))
        if (t !== null) expect(ids.has(t), `${code} -> ${t}`).toBe(true);
    for (const id of Object.keys(EXTRA_RINGS)) expect(ids.has(id), id).toBe(true);
    for (const id of Object.keys(ISLAND_MIN_AREA)) expect(ids.has(id), id).toBe(true);
    for (const k of KEEP_ISLANDS) expect(ids.has(k.id), k.id).toBe(true);
  });

  it("uses three-letter country codes, each once (an object key cannot repeat, a typo would show here)", () => {
    for (const code of Object.keys(COUNTRIES)) expect(code).toMatch(/^[A-Z]{3}$/);
  });

  it("keeps the hand-made islands inside the map window", () => {
    for (const rings of Object.values(EXTRA_RINGS))
      for (const ring of rings)
        for (const [lon, lat] of ring) {
          expect(lon).toBeGreaterThan(LON_LEFT);
          expect(lon).toBeLessThan(LON_RIGHT);
          expect(lat).toBeGreaterThan(LAT_BOTTOM);
          expect(lat).toBeLessThan(LAT_TOP);
        }
  });

  it("has sound constants", () => {
    expect(GAP_MIN).toBe(1);
    expect(KERBE_MAX).toBe(12);
  });
});

describe("lenses", () => {
  it("stay below the fold limit one by one", () => {
    for (const l of LENSES) {
      expect(l.factor).toBeLessThan(2.25);
      expect(lensMinDerivative(l)).toBeGreaterThan(0);
    }
  });

  it("are invertible and fold-free together: the Jacobian determinant is positive over the whole window", () => {
    const f = (x: number, y: number) => applyLenses([x, y], LENSES);
    const h = 0.5;
    let min = Infinity;
    for (let x = 1; x < 1000; x += 7) {
      for (let y = 1; y < 540; y += 7) {
        const [x1, y1] = f(x + h, y);
        const [x0, y0] = f(x - h, y);
        const [x3, y3] = f(x, y + h);
        const [x2, y2] = f(x, y - h);
        const det =
          ((x1 - x0) / (2 * h)) * ((y3 - y2) / (2 * h)) -
          ((y1 - y0) / (2 * h)) * ((x3 - x2) / (2 * h));
        min = Math.min(min, det);
      }
    }
    expect(min).toBeGreaterThan(0.05);
  });

  it("keep the map window: the corners of the projection stay put", () => {
    expect(applyLenses(project(LON_LEFT, LAT_TOP), LENSES)).toEqual([0, 0]);
  });
});
