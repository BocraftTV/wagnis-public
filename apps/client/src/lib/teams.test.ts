import { describe, expect, it } from "vitest";
import { clientMessageSchema } from "@wagnis/shared";
import {
  assignmentHint,
  mateIds,
  teamLetters,
  teamModeChoices,
  teamModeHint,
  teamModeLabel,
  teamModePlayers,
  teamOfPlayer,
  teamScoreRows,
  teamWinText,
  winningTeams,
} from "./teams.js";
import { targetsFrom } from "./attack.js";
import { randomTeamsMessage, settingsMessage, teamMessage } from "./host.js";
import { wsErrorText } from "./messages.js";

const names = (id: string) => ({ a: "Anna", b: "Ben", c: "Cleo", d: "Dora" })[id] ?? "?";
const teams = { A: ["a", "b"], B: ["c", "d"] };

describe("team layouts", () => {
  it("offers off, 2v2, 3v3 and 2v2v2", () => {
    expect(teamModeChoices).toEqual([null, "2v2", "3v3", "2v2v2"]);
    expect(teamModeLabel("2v2v2")).toBe("2 gegen 2 gegen 2");
    expect(teamModeLabel(null)).toBe("Keine Teams");
  });
  it("player counts and letters", () => {
    expect([
      teamModePlayers(null),
      teamModePlayers("2v2"),
      teamModePlayers("3v3"),
      teamModePlayers("2v2v2"),
    ]).toEqual([null, 4, 6, 6]);
    expect(teamLetters("2v2")).toEqual(["A", "B"]);
    expect(teamLetters("2v2v2")).toEqual(["A", "B", "C"]);
    expect(teamLetters(null)).toEqual([]);
  });
  it("hints", () => {
    expect(teamModeHint(null)).toContain("für sich");
    expect(teamModeHint("2v2")).toContain("genau 4 Spieler");
    expect(teamModeHint("3v3")).toContain("jeder im Team den vollen Bonus");
  });
});

describe("assignment hint (a note only, the server checks the start)", () => {
  it("no layout, no note", () => expect(assignmentHint(null, ["A"])).toBeNull());
  it("wrong player count", () => {
    expect(assignmentHint("2v2", [null, null, null])).toContain("genau 4 Spieler (jetzt 3)");
  });
  it("players without a team", () => {
    expect(assignmentHint("2v2", ["A", "B", null, null])).toContain("Noch 2 ohne Team");
  });
  it("unequal teams", () => {
    expect(assignmentHint("2v2", ["A", "A", "A", "B"])).toBe("Team A hat 3 statt 2 Spieler.");
  });
  it("a complete assignment has no note", () => {
    expect(assignmentHint("2v2", ["A", "B", "A", "B"])).toBeNull();
    expect(assignmentHint("2v2v2", ["A", "A", "B", "B", "C", "C"])).toBeNull();
  });
});

describe("in the game", () => {
  it("mates and team of a player", () => {
    expect(mateIds(teams, "a")).toEqual(["b"]);
    expect(mateIds(teams, "d")).toEqual(["c"]);
    expect(mateIds(null, "a")).toEqual([]);
    expect(teamOfPlayer(teams, "c")).toBe("B");
    expect(teamOfPlayer(null, "c")).toBeNull();
  });
  it("win text for a team", () => {
    expect(teamWinText(["A"], ["a", "b"], names)).toBe("Team A hat gewonnen: Anna und Ben");
    expect(teamWinText(["A", "B"], ["a", "b", "c", "d"], names)).toBe(
      "Team A und Team B haben gewonnen: Anna, Ben, Cleo und Dora",
    );
  });
  it("the winning teams come from winnerIds: one team, or every team level after the round limit", () => {
    expect(winningTeams(teams, ["a", "b"], "A")).toEqual(["A"]);
    expect(winningTeams(teams, ["a", "b", "c", "d"], "A")).toEqual(["A", "B"]);
    expect(winningTeams(teams, [], "B")).toEqual(["B"]);
    expect(winningTeams(null, [], null)).toEqual([]);
  });
  it("team score rows keep the order and mark the winner", () => {
    expect(
      teamScoreRows(
        [
          { teamId: "A", playerIds: ["a", "b"], points: 7, armies: 12 },
          { teamId: "B", playerIds: ["c", "d"], points: 5, armies: 9 },
        ],
        ["A"],
      ),
    ).toEqual([
      { teamId: "A", members: ["a", "b"], points: 7, armies: 12, winner: true },
      { teamId: "B", members: ["c", "d"], points: 5, armies: 9, winner: false },
    ]);
    expect(teamScoreRows(null, [])).toEqual([]);
    expect(
      teamScoreRows(
        [
          { teamId: "A", playerIds: ["a", "b"], points: 5, armies: 9 },
          { teamId: "B", playerIds: ["c", "d"], points: 5, armies: 9 },
        ],
        ["A", "B"],
      ).map((r) => r.winner),
    ).toEqual([true, true]);
  });
  it("attack targets leave out the partner's territories", () => {
    const neighbors = { x: ["y", "z", "w"] };
    const territories = {
      x: { ownerId: "a", armies: 3, maxAttackDice: 2, maxMove: 2 },
      y: { ownerId: "b", armies: 1, maxAttackDice: 0, maxMove: 0 },
      z: { ownerId: "c", armies: 1, maxAttackDice: 0, maxMove: 0 },
      w: { ownerId: null, armies: 1, maxAttackDice: 0, maxMove: 0 },
    };
    expect(targetsFrom(neighbors, territories, "a", "x")).toEqual(["y", "z", "w"]);
    expect(targetsFrom(neighbors, territories, "a", "x", ["b"])).toEqual(["z", "w"]);
  });
});

describe("messages", () => {
  it("are valid wire messages", () => {
    for (const m of [
      settingsMessage({ teams: "2v2v2" }),
      settingsMessage({ teams: null }),
      teamMessage("p2", "B"),
      teamMessage("p2", null),
      randomTeamsMessage(),
    ]) {
      expect(clientMessageSchema.safeParse(m).success, JSON.stringify(m)).toBe(true);
    }
  });
  it("have German error texts", () => {
    expect(wsErrorText.ALLY_TARGET).toContain("Partner");
    expect(wsErrorText.INVALID_TEAMS).toContain("Teams");
  });
});
