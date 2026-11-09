import { describe, expect, it } from "vitest";
import { cardCatalog, defaultCardRules, getMap, mapIds, validateMap, welt } from "./index.js";
import type { MapDefinition } from "./index.js";

/** The 16 sea routes of the world map (docs/weltkarte-entwurf.md 4); the engine itself does not tell them apart. */
const SEA_ROUTES: readonly (readonly [string, string])[] = [
  ["nordwestland", "ostsibirien"],
  ["hudsonland", "groenland"],
  ["groenland", "nebelinseln"],
  ["atlantikkueste", "antillen"],
  ["antillen", "orinokoland"],
  ["nordostkueste", "sahelguertel"],
  ["nebelinseln", "nordlande"],
  ["nebelinseln", "atlantikmark"],
  ["atlantikmark", "atlasland"],
  ["wuestenhalbinsel", "ostafrika"],
  ["ostsibirien", "japan"],
  ["kernland", "japan"],
  ["hinterindien", "sundainseln"],
  ["sundainseln", "neuguinea"],
  ["neuguinea", "suedland"],
  ["sundainseln", "suedland"],
];

const byId = new Map(welt.territories.map((t) => [t.id, t]));
const key = (a: string, b: string) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const edges = (map: MapDefinition): Set<string> =>
  new Set(map.territories.flatMap((t) => t.neighbors.map((n) => key(t.id, n))));
const members = (continentId: string) =>
  welt.territories.filter((t) => t.continentId === continentId);

describe("welt map", () => {
  it("is valid and registered", () => {
    expect(validateMap(welt)).toEqual({ ok: true });
    expect(getMap("welt")).toBe(welt);
    expect(getMap("constructor")).toBeUndefined();
    expect([...mapIds].sort()).toEqual(["testland", "welt"]);
    expect(welt.id).toBe("welt");
    expect(welt.name).toBe("Welt");
  });

  it("has 42 territories in 8 continents with the specified sizes and bonuses", () => {
    expect(welt.territories).toHaveLength(42);
    expect(new Set(welt.territories.map((t) => t.id)).size).toBe(42);
    expect(welt.continents.map((c) => c.id)).toEqual([
      "nordamerika",
      "karibischer-bogen",
      "suedamerika",
      "europa",
      "afrika",
      "vorderasien",
      "asien",
      "ozeanien",
    ]);
    expect(welt.continents.map((c) => members(c.id).length)).toEqual([6, 4, 4, 6, 6, 4, 9, 3]);
    expect(welt.continents.map((c) => c.bonus)).toEqual([3, 2, 2, 4, 4, 2, 6, 2]);
  });

  it("has 72 symmetric edges with 2 to 6 neighbors per territory", () => {
    expect(edges(welt).size).toBe(72);
    const degrees = welt.territories.map((t) => t.neighbors.length);
    expect(Math.min(...degrees)).toBe(2);
    expect(Math.max(...degrees)).toBe(6);
    expect(degrees.filter((d) => d === 2)).toHaveLength(8);
    expect(byId.get("osteuropa")!.neighbors).toHaveLength(6);
    for (const t of welt.territories) {
      expect(new Set(t.neighbors).size).toBe(t.neighbors.length);
      for (const n of t.neighbors) expect(byId.get(n)!.neighbors).toContain(t.id);
    }
  });

  it("has every continent connected within itself", () => {
    for (const c of welt.continents) {
      const own = new Set(members(c.id).map((t) => t.id));
      const seen = new Set([[...own][0]!]);
      const queue = [...seen];
      while (queue.length > 0) {
        for (const n of byId.get(queue.pop()!)!.neighbors) {
          if (own.has(n) && !seen.has(n)) {
            seen.add(n);
            queue.push(n);
          }
        }
      }
      expect(seen.size, c.id).toBe(own.size);
    }
  });
});

describe("welt sea routes", () => {
  it("are 16 distinct edges of the map, 7 of them across continents", () => {
    expect(new Set(SEA_ROUTES.map(([a, b]) => key(a, b))).size).toBe(16);
    const all = edges(welt);
    for (const [a, b] of SEA_ROUTES) expect(all.has(key(a, b)), `${a} - ${b}`).toBe(true);
    const across = SEA_ROUTES.filter(
      ([a, b]) => byId.get(a)!.continentId !== byId.get(b)!.continentId,
    );
    expect(across).toHaveLength(7);
    expect(all.size - SEA_ROUTES.length).toBe(56);
  });

  it("leave exactly the island territories without a land border", () => {
    const sea = new Set(SEA_ROUTES.map(([a, b]) => key(a, b)));
    const landless = welt.territories
      .filter((t) => t.neighbors.every((n) => sea.has(key(t.id, n))))
      .map((t) => t.id)
      .sort();
    expect(landless).toEqual(
      [
        "antillen",
        "groenland",
        "japan",
        "nebelinseln",
        "neuguinea",
        "suedland",
        "sundainseln",
      ].sort(),
    );
  });
});

describe("welt continent bonuses", () => {
  // bonus = max(2, round-half-up(territories / 2 + inner territories / 4)); inner = no neighbor outside
  it.each(welt.continents.map((c) => [c.id, c.bonus] as const))(
    "%s follows the formula",
    (id, bonus) => {
      const own = members(id);
      const inner = own.filter((t) =>
        t.neighbors.every((n) => byId.get(n)!.continentId === id),
      ).length;
      const value = own.length / 2 + inner / 4;
      expect(Math.max(2, Math.floor(value + 0.5))).toBe(bonus);
    },
  );

  it("sums to 25", () => {
    expect(welt.continents.reduce((sum, c) => sum + c.bonus, 0)).toBe(25);
  });
});

describe("welt card deck", () => {
  const cards = cardCatalog(welt, { cards: defaultCardRules });

  it("has 44 cards: one per territory plus 2 jokers", () => {
    expect(cards).toHaveLength(44);
    expect(new Set(cards.map((c) => c.id)).size).toBe(44);
    const withTerritory = cards.filter((c) => c.territoryId !== null);
    expect(withTerritory.map((c) => c.territoryId)).toEqual(welt.territories.map((t) => t.id));
    expect(cards.filter((c) => c.kind === "joker")).toHaveLength(2);
  });

  it("splits the symbols 14 / 14 / 14, round-robin in territory order", () => {
    for (const kind of ["infantry", "cavalry", "artillery"]) {
      expect(cards.filter((c) => c.kind === kind)).toHaveLength(14);
    }
    expect(cards.slice(0, 3).map((c) => c.kind)).toEqual(["infantry", "cavalry", "artillery"]);
    expect(cards.slice(0, 42).map((c) => c.kind)).toEqual(
      welt.territories.map((_, i) => (["infantry", "cavalry", "artillery"] as const)[i % 3]),
    );
  });
});
