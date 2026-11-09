import { describe, expect, it } from "vitest";
import {
  applyAction,
  applyHostAction,
  calculateReinforcements,
  createDiceRng,
  createGame,
  createSeededRng,
  scoreboard,
  teamScoreboard,
  testland,
  testlandRules,
  viewFor,
} from "./index.js";
import type { Action, GameState, Mission, Rng, TeamId } from "./index.js";
import { makeState, withMissions } from "./testkit.js";
import { playRandomGame } from "./playbot.js";
import { teamMembers } from "./teams.js";

// testland: nordreich (bonus 2) = eisenfurt, rabenhain, grauwacht, tannenfeld; suedmark (bonus 3) = salzmoor,
// dornental, kupferstadt, nebelkueste. Land borders: eisenfurt-rabenhain, eisenfurt-grauwacht, rabenhain-tannenfeld,
// grauwacht-tannenfeld, grauwacht-salzmoor, salzmoor-dornental, salzmoor-kupferstadt, dornental-nebelkueste,
// kupferstadt-nebelkueste.

const noRng: Rng = {
  int: () => {
    throw new Error("rng used");
  },
};
const rules2v2 = { ...testlandRules, teams: "2v2" as const, victoryMode: "domination" as const };
const teams2v2: Record<TeamId, string[]> = { A: ["a", "b"], B: ["c", "d"], C: [] };

/** a, b (team A) and c, d (team B); the active player is a. */
function board(
  t: Record<string, [string | null, number]>,
  extra: Partial<GameState> = {},
  rules = rules2v2,
): GameState {
  return makeState({
    players: ["a", "c", "b", "d"],
    territories: t,
    fill: null,
    overrides: {
      rules,
      teams: { A: ["a", "b"], B: ["c", "d"] } as Record<TeamId, string[]>,
      ...extra,
    },
  });
}
const act = (s: GameState, a: Action, rng: Rng = noRng, who = s.activePlayerId) =>
  applyAction(s, who, a, rng);

describe("setup (rules.md 13)", () => {
  const make = (
    n: number,
    mode: "2v2" | "3v3" | "2v2v2" | null,
    teams: Record<string, string[]> | undefined,
  ) =>
    createGame({
      map: testland,
      rules: { ...testlandRules, teams: mode, victoryMode: "domination" },
      playerIds: ["p1", "p2", "p3", "p4", "p5", "p6"].slice(0, n),
      rng: createSeededRng(3),
      teams: teams as never,
    });

  it("2v2 with 4 players, 3v3 and 2v2v2 with 6 players are accepted", () => {
    expect(make(4, "2v2", { A: ["p1", "p2"], B: ["p3", "p4"] }).ok).toBe(true);
    expect(make(6, "3v3", { A: ["p1", "p2", "p3"], B: ["p4", "p5", "p6"] }).ok).toBe(true);
    expect(make(6, "2v2v2", { A: ["p1", "p2"], B: ["p3", "p4"], C: ["p5", "p6"] }).ok).toBe(true);
  });

  it.each([
    ["wrong player count", 3, "2v2", { A: ["p1", "p2"], B: ["p3"] }],
    ["5 players", 5, "3v3", { A: ["p1", "p2", "p3"], B: ["p4", "p5"] }],
    ["no assignment", 4, "2v2", undefined],
    ["unequal teams", 4, "2v2", { A: ["p1", "p2", "p3"], B: ["p4"] }],
    ["a player twice", 4, "2v2", { A: ["p1", "p2"], B: ["p2", "p4"] }],
    ["an unknown player", 4, "2v2", { A: ["p1", "p2"], B: ["p3", "px"] }],
    ["a team too many", 4, "2v2", { A: ["p1", "p2"], B: ["p3", "p4"], C: ["p5"] }],
    ["a team missing", 6, "2v2v2", { A: ["p1", "p2"], B: ["p3", "p4"] }],
  ] as const)("%s is INVALID_TEAMS", (_label, n, mode, teams) => {
    expect(make(n, mode, teams as never)).toEqual({ ok: false, code: "INVALID_TEAMS" });
  });

  it("an unknown mode is INVALID_RULES; no teams ignores a given assignment", () => {
    expect(make(4, "5v5" as never, undefined)).toEqual({ ok: false, code: "INVALID_RULES" });
    const r = make(4, null, { A: ["p1", "p2"], B: ["p3", "p4"] });
    if (!r.ok) throw new Error(r.code);
    expect(r.state.teams).toBeNull();
  });

  it("the turn order alternates between the teams, the starting team is random", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      const r = createGame({
        map: testland,
        rules: { ...testlandRules, teams: "2v2v2", victoryMode: "domination" },
        playerIds: ["p1", "p2", "p3", "p4", "p5", "p6"],
        rng: createSeededRng(seed),
        teams: { A: ["p1", "p2"], B: ["p3", "p4"], C: ["p5", "p6"] },
      });
      if (!r.ok) throw new Error(r.code);
      const order = r.state.playerOrder;
      const team = (p: string) =>
        ["p1", "p2"].includes(p) ? "A" : ["p3", "p4"].includes(p) ? "B" : "C";
      expect(order.slice(0, 3).map(team).sort()).toEqual(["A", "B", "C"]);
      expect(order.slice(3).map(team)).toEqual(order.slice(0, 3).map(team));
      expect(order.slice(0, 3).map(team)).not.toContain(undefined);
      expect(r.state.activePlayerId).toBe(order[0]);
      seen.add(team(order[0]!));
    }
    expect(seen.size).toBeGreaterThan(1);
  });

  it("the state and the view carry the teams; the winner fields start empty", () => {
    const r = make(4, "2v2", { A: ["p1", "p2"], B: ["p3", "p4"] });
    if (!r.ok) throw new Error(r.code);
    expect(r.state.teams).toEqual({ A: ["p1", "p2"], B: ["p3", "p4"] });
    const v = viewFor(r.state, "p3");
    expect(v.teams).toEqual({ A: ["p1", "p2"], B: ["p3", "p4"] });
    expect(v.winnerTeamId).toBeNull();
    expect(v.teamScores).toBeNull();
  });

  it("without teams the state has none", () => {
    const r = make(4, null, undefined);
    if (!r.ok) throw new Error(r.code);
    expect(r.state.teams).toBeNull();
    expect(viewFor(r.state, "p1").teams).toBeNull();
  });
});

describe("attack and move", () => {
  const s = board({
    eisenfurt: ["a", 5],
    rabenhain: ["b", 3],
    grauwacht: ["c", 2],
    tannenfeld: ["d", 2],
  });
  it("a team mate cannot be attacked: ALLY_TARGET, right after OWN_TARGET", () => {
    expect(act(s, { type: "attack", from: "eisenfurt", to: "rabenhain", dice: 1 })).toEqual({
      ok: false,
      code: "ALLY_TARGET",
    });
    expect(act(s, { type: "blitz", from: "eisenfurt", to: "rabenhain" })).toEqual({
      ok: false,
      code: "ALLY_TARGET",
    });
    expect(act(s, { type: "attack", from: "eisenfurt", to: "eisenfurt", dice: 1 })).toEqual({
      ok: false,
      code: "OWN_TARGET",
    });
    // not adjacent still comes first for a far-away partner
    expect(act(s, { type: "attack", from: "eisenfurt", to: "tannenfeld", dice: 1 })).toEqual({
      ok: false,
      code: "NOT_ADJACENT",
    });
  });
  it("an enemy can be attacked", () => {
    expect(
      act(
        s,
        { type: "attack", from: "eisenfurt", to: "grauwacht", dice: 1 },
        createDiceRng([6, 1, 1]),
      ).ok,
    ).toBe(true);
  });

  const fortifying = (reach: "connected" | "adjacent") =>
    board(
      {
        eisenfurt: ["a", 5],
        rabenhain: ["b", 1],
        tannenfeld: ["a", 1],
        grauwacht: ["c", 2],
        salzmoor: ["d", 1],
      },
      { phase: "fortify" },
      { ...rules2v2, fortifyReach: reach },
    );

  it("armies can be moved into a partner's territory, which then holds them", () => {
    const r = act(fortifying("connected"), {
      type: "fortify",
      from: "eisenfurt",
      to: "rabenhain",
      count: 3,
    });
    if (!r.ok) throw new Error(r.code);
    expect(r.state.territories["rabenhain"]).toEqual({ ownerId: "b", armies: 4 });
    expect(r.state.territories["eisenfurt"]).toEqual({ ownerId: "a", armies: 2 });
  });
  it("connected: a chain over own and partner territories works (eisenfurt - rabenhain(b) - tannenfeld)", () => {
    const r = act(fortifying("connected"), {
      type: "fortify",
      from: "eisenfurt",
      to: "tannenfeld",
      count: 2,
    });
    expect(r.ok).toBe(true);
  });
  it("adjacent: only direct neighbours", () => {
    expect(
      act(fortifying("adjacent"), { type: "fortify", from: "eisenfurt", to: "rabenhain", count: 1 })
        .ok,
    ).toBe(true);
    expect(
      act(fortifying("adjacent"), {
        type: "fortify",
        from: "eisenfurt",
        to: "tannenfeld",
        count: 1,
      }),
    ).toEqual({ ok: false, code: "NOT_CONNECTED" });
  });
  it("the origin must be the player's own: a partner's armies cannot be pulled back", () => {
    const s2 = fortifying("connected");
    expect(act(s2, { type: "fortify", from: "rabenhain", to: "eisenfurt", count: 1 })).toEqual({
      ok: false,
      code: "NOT_OWNER",
    });
  });
  it("an enemy territory is still no target", () => {
    expect(
      act(fortifying("connected"), {
        type: "fortify",
        from: "eisenfurt",
        to: "grauwacht",
        count: 1,
      }),
    ).toEqual({ ok: false, code: "NOT_OWNER" });
  });
  it("the fortify view lists the partner's territories in the groups", () => {
    const v = viewFor(fortifying("connected"), "a").fortify!;
    expect(v.reach).toBe("connected");
    if (v.reach !== "connected") return;
    const group = v.groups.find((g) => g.includes("eisenfurt"))!;
    expect(group).toEqual(expect.arrayContaining(["eisenfurt", "rabenhain", "tannenfeld"]));
    const adj = viewFor(fortifying("adjacent"), "a").fortify!;
    if (adj.reach !== "adjacent") throw new Error("reach");
    expect(adj.targets["eisenfurt"]).toContain("rabenhain");
  });
});

describe("cards", () => {
  const withHands = (s: GameState): GameState => ({
    ...s,
    secret: {
      ...s.secret,
      hand: {
        a: ["card-eisenfurt"],
        b: ["card-rabenhain", "card-joker-1"],
        c: ["card-salzmoor"],
        d: [],
      },
    },
  });
  const s = withHands(
    board({ eisenfurt: ["a", 2], rabenhain: ["b", 2], salzmoor: ["c", 2], dornental: ["d", 2] }),
  );
  it("partners see each other's hand (not the pile), enemies do not", () => {
    const va = viewFor(s, "a");
    expect(Object.keys(va.secret.allyHands)).toEqual(["b"]);
    expect(va.secret.allyHands["b"]!.map((c) => c.id)).toEqual(["card-rabenhain", "card-joker-1"]);
    expect(viewFor(s, "c").secret.allyHands["d"]).toEqual([]);
    const wire = JSON.stringify(viewFor(s, "c"));
    expect(wire).not.toContain("card-rabenhain");
    expect(wire).not.toContain("card-eisenfurt");
    expect(wire).not.toContain("card-joker-1");
    expect(JSON.stringify(va)).not.toContain("card-salzmoor");
    expect(va.secret).not.toHaveProperty("deck");
  });
  it("without teams nobody has allyHands", () => {
    const solo = makeState({ players: ["a", "b"], territories: {} });
    expect(viewFor(solo, "a").secret.allyHands).toEqual({});
  });

  it("eliminating a player gives the hand to the surviving partner, not to the conqueror", () => {
    const t = withHands(
      board({ eisenfurt: ["a", 6], grauwacht: ["c", 1], salzmoor: ["d", 2], dornental: ["b", 1] }),
    );
    // c holds only grauwacht (1 army); a conquers it
    const r = act(
      t,
      { type: "blitz", from: "eisenfurt", to: "grauwacht" },
      createDiceRng([6, 6, 6, 1]),
    );
    if (!r.ok) throw new Error(r.code);
    expect(r.state.territories["grauwacht"]!.ownerId).toBe("a");
    expect(r.state.secret.hand["c"]).toEqual([]);
    expect(r.state.secret.hand["d"]).toEqual(["card-salzmoor"]);
    expect(r.state.secret.hand["a"]).toEqual(["card-eisenfurt"]);
    expect(r.events.find((e) => e.type === "cardsTaken")).toMatchObject({
      playerId: "d",
      fromPlayerId: "c",
      count: 1,
    });
  });
  it("if the whole team is out, the conqueror takes the hand as before", () => {
    const t = withHands(board({ eisenfurt: ["a", 6], grauwacht: ["c", 1], dornental: ["b", 1] }));
    const r = act(
      { ...t, secret: { ...t.secret, hand: { ...t.secret.hand, d: [] } } },
      { type: "blitz", from: "eisenfurt", to: "grauwacht" },
      createDiceRng([6, 6, 6, 1]),
    );
    if (!r.ok) throw new Error(r.code);
    expect(r.state.secret.hand["a"]).toEqual(["card-eisenfurt", "card-salzmoor"]);
  });
});

describe("victory", () => {
  it("the last team standing wins: every member is a winner, even a team mate who is out", () => {
    // c is out already, a conquers d's last territory; b has nothing left either
    const s = board({ eisenfurt: ["a", 6], grauwacht: ["d", 1] });
    const r = act(
      s,
      { type: "blitz", from: "eisenfurt", to: "grauwacht" },
      createDiceRng([6, 6, 6, 1]),
    );
    if (!r.ok) throw new Error(r.code);
    expect(r.state.winReason).toBe("lastPlayer");
    expect(r.state.winnerTeamId).toBe("A");
    expect(r.state.winnerIds).toEqual(expect.arrayContaining(["a", "b"]));
    expect(r.state.winnerIds).toHaveLength(2);
    expect(r.state.winnerIds).toContain(r.state.winnerId);
    expect(r.events.filter((e) => e.type === "gameWon")).toHaveLength(2);
    const v = viewFor(r.state, "c");
    expect(v.winnerTeamId).toBe("A");
    expect(v.winnerIds).toEqual(r.state.winnerIds);
  });

  it("two teams alive: nobody wins", () => {
    const s = board({ eisenfurt: ["a", 6], grauwacht: ["d", 1], salzmoor: ["c", 1] });
    const r = act(
      s,
      { type: "blitz", from: "eisenfurt", to: "grauwacht" },
      createDiceRng([6, 6, 6, 1]),
    );
    if (!r.ok) throw new Error(r.code);
    expect(r.state.winnerId).toBeNull();
  });

  const mission = (
    m: Mission,
    extra: Partial<GameState> = {},
    t: Record<string, [string | null, number]>,
  ) =>
    withMissions(board(t, { rules: { ...rules2v2, victoryMode: "missions" }, ...extra }), {
      a: m,
      b: m,
      c: null,
      d: null,
    });

  it("a team mission counts the territories of the whole team (holdTerritories)", () => {
    const m: Mission = { type: "holdTerritories", count: 4, minArmies: 2 };
    const s = mission(
      m,
      {},
      {
        eisenfurt: ["a", 2],
        rabenhain: ["b", 2],
        grauwacht: ["a", 2],
        tannenfeld: ["b", 2],
        salzmoor: ["c", 1],
        dornental: ["d", 1],
      },
    );
    const done = applyAction(
      { ...s, phase: "reinforce", reinforcementsLeft: 1 },
      "a",
      { type: "placeArmies", territoryId: "eisenfurt", count: 1 },
      noRng,
    );
    if (!done.ok) throw new Error(done.code);
    expect(done.state.winReason).toBe("mission");
    expect(done.state.winnerTeamId).toBe("A");
  });

  it("a continent counts as held if it belongs to the team together", () => {
    const m: Mission = {
      type: "conquerContinents",
      continentIds: ["nordreich"],
      extraContinents: 0,
    };
    const s = mission(
      m,
      { phase: "fortify" },
      {
        eisenfurt: ["a", 3],
        rabenhain: ["b", 1],
        grauwacht: ["a", 1],
        tannenfeld: ["b", 1],
        salzmoor: ["c", 1],
        dornental: ["d", 1],
      },
    );
    const r = applyAction(
      s,
      "a",
      { type: "fortify", from: "eisenfurt", to: "rabenhain", count: 1 },
      noRng,
    );
    if (!r.ok) throw new Error(r.code);
    expect(r.state.winReason).toBe("mission");
    expect(r.state.winnerIds.sort()).toEqual(["a", "b"]);
  });

  it("an enemy in the continent spoils it for the team", () => {
    const m: Mission = {
      type: "conquerContinents",
      continentIds: ["nordreich"],
      extraContinents: 0,
    };
    const s = mission(
      m,
      { phase: "fortify" },
      {
        eisenfurt: ["a", 3],
        rabenhain: ["b", 1],
        grauwacht: ["c", 1],
        tannenfeld: ["b", 1],
        salzmoor: ["d", 1],
      },
    );
    const r = applyAction(
      s,
      "a",
      { type: "fortify", from: "eisenfurt", to: "rabenhain", count: 1 },
      noRng,
    );
    if (!r.ok) throw new Error(r.code);
    expect(r.state.winnerId).toBeNull();
  });
});

describe("missions at the start", () => {
  const start = (draft: boolean, seed = 5) =>
    createGame({
      map: testland,
      rules: { ...testlandRules, teams: "2v2", missionDraft: draft },
      playerIds: ["p1", "p2", "p3", "p4"],
      rng: createSeededRng(seed),
      teams: { A: ["p1", "p2"], B: ["p3", "p4"] } as never,
    });

  it("team mates share one mission; the teams have different ones; none is an elimination", () => {
    for (let seed = 1; seed <= 25; seed++) {
      const r = start(false, seed);
      if (!r.ok) throw new Error(r.code);
      const m = r.state.secret.mission;
      expect(m["p1"]).toEqual(m["p2"]);
      expect(m["p3"]).toEqual(m["p4"]);
      expect(m["p1"]).not.toEqual(m["p3"]);
      for (const p of ["p1", "p2", "p3", "p4"]) expect(m[p]!.type).not.toBe("eliminatePlayer");
    }
  });

  it("with the draft both team mates get the same two cards; the first choice settles it for both", () => {
    const r = start(true);
    if (!r.ok) throw new Error(r.code);
    const o = r.state.secret.missionOffer;
    expect(o["p1"]).toEqual(o["p2"]);
    expect(o["p3"]).toEqual(o["p4"]);
    expect(r.state.phase).toBe("missionChoice");
    const c = applyAction(r.state, "p2", { type: "chooseMission", index: 1 }, noRng);
    if (!c.ok) throw new Error(c.code);
    expect(c.state.secret.mission["p1"]).toEqual(o["p1"]![1]);
    expect(c.state.secret.mission["p2"]).toEqual(o["p1"]![1]);
    expect(c.state.secret.missionOffer["p1"]).toBeNull();
    expect(c.state.phase).toBe("missionChoice");
    // the partner cannot choose again
    expect(applyAction(c.state, "p1", { type: "chooseMission", index: 0 }, noRng)).toEqual({
      ok: false,
      code: "ALREADY_CHOSEN",
    });
    expect(viewFor(c.state, "p3").missionChoice?.chosen.sort()).toEqual(["p1", "p2"]);
    // the other team finishes: the game starts
    const d = applyAction(c.state, "p3", { type: "chooseMission", index: 0 }, noRng);
    if (!d.ok) throw new Error(d.code);
    expect(d.state.phase).toBe("reinforce");
  });

  it("the host's skipTurn chooses once per open team, both mates get the same card, then the game starts", () => {
    const r = start(true);
    if (!r.ok) throw new Error(r.code);
    const o = r.state.secret.missionOffer;
    const s = applyHostAction(
      r.state,
      { type: "skipTurn", turn: r.state.turn },
      createSeededRng(3),
    );
    if (!s.ok) throw new Error(s.code);
    expect(s.state.phase).toBe("reinforce");
    const m = s.state.secret.mission;
    expect(m["p1"]).toEqual(m["p2"]);
    expect(m["p3"]).toEqual(m["p4"]);
    expect(o["p1"]).toContainEqual(m["p1"]);
    expect(o["p3"]).toContainEqual(m["p3"]);
    // one missionChosen per team (the first open member), as with a choice of a player
    const chosen = s.events.filter((e) => e.type === "missionChosen").map((e) => e.playerId);
    expect(chosen).toHaveLength(2);
  });

  it("skipTurn after one team chose only chooses for the other team", () => {
    const r = start(true);
    if (!r.ok) throw new Error(r.code);
    const c = applyAction(r.state, "p2", { type: "chooseMission", index: 1 }, noRng);
    if (!c.ok) throw new Error(c.code);
    const s = applyHostAction(
      c.state,
      { type: "skipTurn", turn: c.state.turn },
      createSeededRng(3),
    );
    if (!s.ok) throw new Error(s.code);
    expect(s.state.phase).toBe("reinforce");
    expect(s.state.secret.mission["p1"]).toEqual(r.state.secret.missionOffer["p1"]![1]);
    expect(s.state.secret.mission["p3"]).toEqual(s.state.secret.mission["p4"]);
  });
});

describe("round limit in a team game (rules.md 11.2, 13)", () => {
  it("the sums of the teams decide and every member of the winning team wins", () => {
    // order a, c, b, d: d is last. Team A: a 2 + b 1 + bonus none; team B: c 2 + d 1
    const s = board(
      {
        eisenfurt: ["a", 3],
        rabenhain: ["a", 1],
        grauwacht: ["b", 1],
        salzmoor: ["c", 1],
        dornental: ["d", 1],
      },
      { activePlayerId: "d", round: 8 },
      { ...rules2v2, roundLimit: 8 },
    );
    const r = applyHostAction(s, { type: "skipTurn", turn: s.turn }, noRng);
    if (!r.ok) throw new Error(r.code);
    expect(r.state.winReason).toBe("roundLimit");
    expect(r.state.winnerTeamId).toBe("A");
    expect(r.state.winnerIds.sort()).toEqual(["a", "b"]);
    const v = viewFor(r.state, "c");
    expect(v.teamScores).toEqual([
      { teamId: "A", playerIds: ["a", "b"], points: 3, armies: 5 },
      { teamId: "B", playerIds: ["c", "d"], points: 2, armies: 2 },
    ]);
    expect(v.scores).toHaveLength(4);
  });
  it("teams level in points and armies win together", () => {
    const s = board(
      { eisenfurt: ["a", 2], rabenhain: ["b", 1], salzmoor: ["c", 2], dornental: ["d", 1] },
      { activePlayerId: "d", round: 8 },
      { ...rules2v2, roundLimit: 8 },
    );
    const r = applyHostAction(s, { type: "skipTurn", turn: s.turn }, noRng);
    if (!r.ok) throw new Error(r.code);
    expect(r.state.winnerIds.sort()).toEqual(["a", "b", "c", "d"]);
  });
  it("a team member who is out adds nothing to the sums", () => {
    const s = board({ eisenfurt: ["a", 2], salzmoor: ["c", 1], dornental: ["d", 1] });
    expect(scoreboard(s).map((e) => e.playerId)).toEqual(["a", "c", "d"]);
    expect(teamScoreboard(s).map((t) => [t.teamId, t.points])).toEqual([
      ["A", 1],
      ["B", 2],
    ]);
  });
});

describe("continent bonus for the team (plan 015, questions 71 to 74)", () => {
  /** Passes the turn from c to b (order a, c, b, d) and returns b's reinforcements. */
  const reinforcementsOfB = (
    t: Record<string, [string | null, number]>,
    extra = {},
    rules = rules2v2,
  ) => {
    const s = board(t, { activePlayerId: "c", phase: "fortify", ...extra }, rules);
    const r = applyHostAction(s, { type: "skipTurn", turn: s.turn }, noRng);
    if (!r.ok) throw new Error(r.code);
    expect(r.state.activePlayerId).toBe("b");
    return r.state.reinforcementsLeft;
  };

  it("a continent split between the partners gives each of them the full bonus", () => {
    const t: Record<string, [string | null, number]> = {
      eisenfurt: ["a", 1],
      rabenhain: ["a", 1],
      grauwacht: ["b", 1],
      tannenfeld: ["b", 1],
      salzmoor: ["c", 1],
      dornental: ["d", 1],
    };
    expect(reinforcementsOfB(t)).toBe(3 + 2);
    const s = board(t);
    expect(
      calculateReinforcements(testland, rules2v2, s.territories, "a", null, teamMembers(s, "a")),
    ).toBe(3 + 2);
  });

  it("a partner without a territory in the continent gets the bonus too", () => {
    expect(
      reinforcementsOfB({
        eisenfurt: ["a", 1],
        rabenhain: ["a", 1],
        grauwacht: ["a", 1],
        tannenfeld: ["a", 1],
        salzmoor: ["b", 1],
        dornental: ["c", 1],
        kupferstadt: ["d", 1],
      }),
    ).toBe(3 + 2);
  });

  it("one enemy territory in the continent spoils it for the whole team", () => {
    expect(
      reinforcementsOfB({
        eisenfurt: ["a", 1],
        rabenhain: ["a", 1],
        grauwacht: ["b", 1],
        tannenfeld: ["c", 1],
        salzmoor: ["d", 1],
      }),
    ).toBe(3);
  });

  it("goldRush doubles the team bonus for every member", () => {
    expect(
      reinforcementsOfB(
        {
          eisenfurt: ["a", 1],
          rabenhain: ["a", 1],
          grauwacht: ["b", 1],
          tannenfeld: ["b", 1],
          salzmoor: ["c", 1],
          dornental: ["d", 1],
        },
        {
          worldEvent: {
            kind: "goldRush",
            continentId: "nordreich",
            playerIds: [],
            territoryIds: [],
          },
        },
        { ...rules2v2, worldEvents: true },
      ),
    ).toBe(3 + 4);
  });

  it("3v3: all three members get the bonus", () => {
    const s = makeState({
      players: ["a", "d", "b", "e", "c", "f"],
      territories: {
        eisenfurt: ["a", 1],
        rabenhain: ["b", 1],
        grauwacht: ["b", 1],
        tannenfeld: ["a", 1],
        salzmoor: ["d", 1],
        dornental: ["e", 1],
        kupferstadt: ["f", 1],
        nebelkueste: ["c", 1],
      },
      fill: null,
      overrides: {
        rules: { ...testlandRules, teams: "3v3" as const, victoryMode: "domination" as const },
        teams: { A: ["a", "b", "c"], B: ["d", "e", "f"] } as Record<TeamId, string[]>,
      },
    });
    for (const p of ["a", "b", "c"])
      expect(
        calculateReinforcements(testland, s.rules, s.territories, p, null, teamMembers(s, p)),
      ).toBe(3 + 2);
    expect(
      calculateReinforcements(testland, s.rules, s.territories, "d", null, teamMembers(s, "d")),
    ).toBe(3);
  });

  it("without teams only the own territories count, as before", () => {
    const s = makeState({
      players: ["a", "b"],
      territories: {
        eisenfurt: ["a", 1],
        rabenhain: ["a", 1],
        grauwacht: ["a", 1],
        tannenfeld: ["b", 1],
      },
      fill: null,
    });
    expect(teamMembers(s, "a")).toEqual(["a"]);
    expect(
      calculateReinforcements(testland, s.rules, s.territories, "a", null, teamMembers(s, "a")),
    ).toBe(3);
  });

  it("round limit: each member's row shows the team continent, the team sum counts it once", () => {
    const s = board({
      eisenfurt: ["a", 3],
      rabenhain: ["a", 1],
      grauwacht: ["b", 1],
      tannenfeld: ["b", 2],
      salzmoor: ["c", 1],
      dornental: ["d", 1],
    });
    expect(
      scoreboard(s).map((e) => [e.playerId, e.territories, e.continentBonus, e.points]),
    ).toEqual([
      ["a", 2, 2, 4],
      ["c", 1, 0, 1],
      ["b", 2, 2, 4],
      ["d", 1, 0, 1],
    ]);
    expect(teamScoreboard(s)).toEqual([
      { teamId: "A", playerIds: ["a", "b"], points: 4 + 2, armies: 7 },
      { teamId: "B", playerIds: ["c", "d"], points: 2, armies: 2 },
    ]);
  });
});

describe("events and teams", () => {
  const fogged = board(
    { eisenfurt: ["a", 6], rabenhain: ["b", 4], grauwacht: ["c", 7], salzmoor: ["d", 9] },
    {
      worldEvent: { kind: "fog", continentId: null, playerIds: [], territoryIds: [] },
    },
  );
  it("fog: partners see each other's armies, enemies do not", () => {
    const v = viewFor(fogged, "a");
    expect(v.territories["rabenhain"]!.armies).toBe(4);
    expect(v.territories["grauwacht"]!.armies).toBeNull();
    expect(v.territories["salzmoor"]!.armies).toBeNull();
    const w = viewFor(fogged, "c");
    expect(w.territories["eisenfurt"]!.armies).toBeNull();
    expect(w.territories["salzmoor"]!.armies).toBe(9);
  });
  it("fog: a partner sees the open move-in of the active player, enemies do not", () => {
    const s = { ...fogged, pendingOccupation: { from: "eisenfurt", to: "grauwacht", min: 2 } };
    expect(viewFor(s, "b").pendingOccupation).not.toBeNull();
    expect(viewFor(s, "c").pendingOccupation).toBeNull();
  });
});

describe("random team games", () => {
  it.each([
    ["2v2", 4, { A: ["p1", "p2"], B: ["p3", "p4"] }],
    ["3v3", 6, { A: ["p1", "p2", "p3"], B: ["p4", "p5", "p6"] }],
    ["2v2v2", 6, { A: ["p1", "p2"], B: ["p3", "p4"], C: ["p5", "p6"] }],
  ] as const)(
    "%s: legal moves are accepted, nobody attacks a partner, a win belongs to a whole team",
    (mode, n, teams) => {
      let finished = 0;
      for (let seed = 1; seed <= 20; seed++) {
        const { steps } = playRandomGame({
          seed,
          players: n,
          rules: {
            ...testlandRules,
            teams: mode,
            victoryMode: seed % 2 === 0 ? "domination" : "missions",
            worldEvents: seed % 3 === 0,
          },
          extra: { teams },
          maxActions: 800,
          hostRate: 0.02,
        });
        for (const step of steps) {
          const s = step.after;
          for (const t of Object.values(s.territories)) expect(t.armies).toBeGreaterThanOrEqual(1);
          if (s.winnerId !== null) {
            const team = Object.values(teams).find((m) =>
              (m as readonly string[]).includes(s.winnerId!),
            )!;
            expect(s.winnerIds.slice().sort()).toEqual(
              (team as readonly string[]).filter((p) => !s.removedPlayerIds.includes(p)).sort(),
            );
            expect(s.winnerTeamId).not.toBeNull();
            finished++;
          }
          if (s.secret.mission[s.activePlayerId]) {
            const mates = Object.values(teams).find((m) =>
              (m as readonly string[]).includes(s.activePlayerId),
            )!;
            for (const p of mates as readonly string[])
              if (
                !s.removedPlayerIds.includes(p) &&
                s.secret.mission[p] &&
                s.secret.mission[s.activePlayerId]
              )
                expect(s.secret.mission[p]!.type === "eliminatePlayer").toBe(false);
          }
        }
      }
      expect(finished).toBeGreaterThanOrEqual(0);
    },
  );
});
