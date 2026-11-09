import { describe, expect, it } from "vitest";
import { eliminatedPlayers } from "./attack.js";
import { NEUTRAL_COLOR, ownerColor, ownerName } from "./owner.js";

const players = [
  { id: "a", name: "Anna", seat: 0 },
  { id: "b", name: "Ben", seat: 1 },
];

describe("owner display", () => {
  it("labels and colors the neutral owner (null)", () => {
    expect(ownerName(null, players)).toBe("Neutral");
    expect(ownerColor(null, players)).toBe(NEUTRAL_COLOR);
    expect(NEUTRAL_COLOR).toBe("var(--player-neutral)");
  });

  it("labels and colors players by seat", () => {
    expect(ownerName("b", players)).toBe("Ben");
    expect(ownerColor("b", players)).toBe("var(--player-1)");
    expect(ownerName("x", players)).toBe("?");
  });

  it("eliminatedPlayers ignores the neutral owner", () => {
    const territories = {
      t1: { ownerId: "a" },
      t2: { ownerId: null },
    } as unknown as Parameters<typeof eliminatedPlayers>[0]["territories"];
    expect([...eliminatedPlayers({ playerOrder: ["a", "b"], territories })]).toEqual(["b"]);
  });
});
