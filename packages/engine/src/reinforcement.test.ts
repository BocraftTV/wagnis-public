import { describe, expect, it } from "vitest";
import { calculateReinforcements, testland, testlandRules } from "./index.js";
import type { MapDefinition, TerritoryState } from "./index.js";

// 20 territories in a chain. Continent "solo" = t1 (bonus 2), continent "rest" = t2..t20.
const chain: MapDefinition = {
  id: "chain",
  name: "Chain",
  seaRoutes: [],
  continents: [
    { id: "solo", name: "Solo", bonus: 2 },
    { id: "rest", name: "Rest", bonus: 100 },
  ],
  territories: Array.from({ length: 20 }, (_, i) => {
    const id = `t${i + 1}`;
    return {
      id,
      name: id,
      continentId: i === 0 ? "solo" : "rest",
      neighbors: [i > 0 ? `t${i}` : null, i < 19 ? `t${i + 2}` : null].filter(
        (x): x is string => x !== null,
      ),
    };
  }),
};

/** Player "a" owns the given territory numbers, "b" the rest. */
function owned(numbers: number[]): Record<string, TerritoryState> {
  return Object.fromEntries(
    chain.territories.map((t, i) => [
      t.id,
      { ownerId: numbers.includes(i + 1) ? "a" : "b", armies: 1 },
    ]),
  );
}
const range = (from: number, to: number) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

describe("calculateReinforcements on testland", () => {
  const hold = (ids: string[]) =>
    Object.fromEntries(
      testland.territories.map((t) => [
        t.id,
        { ownerId: ids.includes(t.id) ? "a" : "b", armies: 1 },
      ]),
    );
  it("adds +2 for Nordreich and +3 for Südmark", () => {
    const north = ["eisenfurt", "rabenhain", "grauwacht", "tannenfeld"];
    const south = ["salzmoor", "dornental", "kupferstadt", "nebelkueste"];
    expect(calculateReinforcements(testland, testlandRules, hold(north), "a")).toBe(3 + 2);
    expect(calculateReinforcements(testland, testlandRules, hold(south), "a")).toBe(3 + 3);
    expect(calculateReinforcements(testland, testlandRules, hold([...north, ...south]), "a")).toBe(
      3 + 2 + 3,
    );
    expect(calculateReinforcements(testland, testlandRules, hold(north.slice(1)), "a")).toBe(3);
  });
});

describe("calculateReinforcements (minimum 3, divisor 3)", () => {
  const cases: [number, number][] = [
    [1, 3],
    [2, 3],
    [5, 3],
    [11, 3],
    [12, 4],
    [13, 4],
    [14, 4],
    [15, 5],
    [17, 5],
    [18, 6],
  ];
  it.each(cases)("%i territories without a full continent -> %i", (count, expected) => {
    // t2..t(count+1): never contains t1, so "solo" is not held; "rest" is not complete (<19 owned)
    expect(calculateReinforcements(chain, testlandRules, owned(range(2, count + 1)), "a")).toBe(
      expected,
    );
  });
  it.each(cases)("%i territories with the bonus-2 continent -> %i + 2", (count, expected) => {
    expect(calculateReinforcements(chain, testlandRules, owned(range(1, count)), "a")).toBe(
      expected + 2,
    );
  });
  it("counts the continent bonus of every completely held continent", () => {
    expect(calculateReinforcements(chain, testlandRules, owned(range(1, 20)), "a")).toBe(
      6 + 2 + 100,
    );
  });
  it("gives a player without territories the minimum", () => {
    expect(calculateReinforcements(chain, testlandRules, owned([]), "a")).toBe(3);
  });
});
