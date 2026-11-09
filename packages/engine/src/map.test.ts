import { describe, expect, it } from "vitest";
import { testland, validateMap } from "./index.js";
import type { MapDefinition } from "./index.js";

const clone = (): MapDefinition => structuredClone(testland);

describe("validateMap", () => {
  it("accepts testland with 8 territories in 2 continents", () => {
    expect(validateMap(testland)).toEqual({ ok: true });
    expect(testland.territories).toHaveLength(8);
    expect(testland.continents).toHaveLength(2);
  });

  it("has the specified continents, bonuses and members", () => {
    const members = (c: string) =>
      testland.territories.filter((t) => t.continentId === c).map((t) => t.name);
    expect(testland.continents).toEqual([
      { id: "nordreich", name: "Nordreich", bonus: 2 },
      { id: "suedmark", name: "Südmark", bonus: 3 },
    ]);
    expect(members("nordreich")).toEqual(["Eisenfurt", "Rabenhain", "Grauwacht", "Tannenfeld"]);
    expect(members("suedmark")).toEqual(["Salzmoor", "Dornental", "Kupferstadt", "Nebelküste"]);
  });

  const expectError = (map: MapDefinition, fragment: string) => {
    const result = validateMap(map);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join("\n")).toContain(fragment);
  };

  it("rejects asymmetric neighbors", () => {
    const m = clone();
    m.territories[0]!.neighbors = m.territories[0]!.neighbors.filter((n) => n !== "grauwacht");
    expectError(m, "not symmetric");
  });

  it("rejects self reference", () => {
    const m = clone();
    m.territories[0]!.neighbors.push("eisenfurt");
    expectError(m, "itself");
  });

  it("rejects unknown neighbor and unknown continent", () => {
    const m = clone();
    m.territories[0]!.neighbors.push("nirgendwo");
    m.territories[1]!.continentId = "unbekannt";
    expectError(m, "unknown neighbor nirgendwo");
    expectError(m, "unknown continent unbekannt");
  });

  it("rejects a disconnected graph", () => {
    const m = clone();
    const g = m.territories.find((t) => t.id === "grauwacht")!;
    const s = m.territories.find((t) => t.id === "salzmoor")!;
    g.neighbors = g.neighbors.filter((n) => n !== "salzmoor");
    s.neighbors = s.neighbors.filter((n) => n !== "grauwacht");
    expectError(m, "not connected");
  });

  it("rejects an empty continent", () => {
    const m = clone();
    m.continents.push({ id: "leer", name: "Leer", bonus: 1 });
    expectError(m, "continent leer has no territories");
  });

  it("rejects duplicate ids", () => {
    const m = clone();
    m.territories.push({ ...m.territories[0]! });
    expectError(m, "duplicate territory id");
  });
});
