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

  it("colors team members in their team's family, the shade by seat within the team (plan 015)", () => {
    const team = [
      { id: "a", name: "Anna", seat: 0, team: "A" as const },
      { id: "b", name: "Ben", seat: 1, team: "B" as const },
      { id: "c", name: "Cleo", seat: 2, team: "A" as const },
      { id: "d", name: "Dan", seat: 3, team: "B" as const },
      { id: "e", name: "Ela", seat: 4, team: "A" as const },
      { id: "f", name: "Finn", seat: 5, team: null },
    ];
    expect(ownerColor("a", team)).toBe("var(--team-a-0)");
    expect(ownerColor("c", team)).toBe("var(--team-a-1)");
    expect(ownerColor("e", team)).toBe("var(--team-a-2)");
    expect(ownerColor("b", team)).toBe("var(--team-b-0)");
    expect(ownerColor("d", team)).toBe("var(--team-b-1)");
    // Not (yet) in a team: the seat color, as without teams; neutral stays grey.
    expect(ownerColor("f", team)).toBe("var(--player-5)");
    expect(ownerColor(null, team)).toBe(NEUTRAL_COLOR);
    // The list order does not matter, only the seats.
    expect(ownerColor("c", [...team].reverse())).toBe("var(--team-a-1)");
  });

  it("caps the shade when the host puts more players into one team than the layout has room for", () => {
    const crowded = [0, 1, 2, 3].map((seat) => ({
      id: `p${seat}`,
      name: "x",
      seat,
      team: "C" as const,
    }));
    expect(ownerColor("p3", crowded)).toBe("var(--team-c-2)");
  });

  it("eliminatedPlayers ignores the neutral owner", () => {
    const territories = {
      t1: { ownerId: "a" },
      t2: { ownerId: null },
    } as unknown as Parameters<typeof eliminatedPlayers>[0]["territories"];
    expect([...eliminatedPlayers({ playerOrder: ["a", "b"], territories })]).toEqual(["b"]);
  });
});
