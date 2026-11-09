import { describe, expect, it } from "vitest";
import {
  applyAction,
  applyHostAction,
  calculateReinforcements,
  createGame,
  createSeededRng,
  testland,
  testlandRules,
  viewFor,
  welt,
  weltRules,
} from "./index.js";
import type { Action, GameState, Rng, WorldEvent, WorldEventKind } from "./index.js";
import { makeState } from "./testkit.js";
import { WORLD_EVENT_KINDS, drawWorldEvent, freshEventDeck } from "./world-events.js";
import { playRandomGame } from "./playbot.js";

// testland: nordreich (bonus 2) = eisenfurt, rabenhain, grauwacht, tannenfeld; suedmark (bonus 3) = salzmoor,
// dornental, kupferstadt, nebelkueste. welt sea routes include hudsonland - groenland and kernland - japan.

const noRng: Rng = {
  int: () => {
    throw new Error("rng used");
  },
};
const ev = (kind: WorldEventKind, extra: Partial<WorldEvent> = {}): WorldEvent => ({
  kind,
  continentId: null,
  playerIds: [],
  territoryIds: [],
  ...extra,
});
const eventRules = { ...testlandRules, worldEvents: true };

function withEvent(s: GameState, event: WorldEvent | null, deck: WorldEventKind[] = []): GameState {
  return { ...s, worldEvent: event, secret: { ...s.secret, eventDeck: deck } };
}
const act = (s: GameState, a: Action, rng: Rng = noRng) => applyAction(s, s.activePlayerId, a, rng);

describe("drawing the event (rules.md 12)", () => {
  const base = (deck: WorldEventKind[]) =>
    withEvent(
      makeState({ players: ["a", "b"], territories: {}, overrides: { rules: eventRules } }),
      null,
      deck,
    );

  it("does nothing with the option off", () => {
    const s = makeState({ players: ["a", "b"], territories: {} });
    expect(drawWorldEvent(s, noRng)).toEqual({ state: s, events: [] });
  });

  it("takes the top card, keeps the rest, and reports it", () => {
    const r = drawWorldEvent(base(["mobilize", "fog"]), noRng);
    expect(r.state.worldEvent).toEqual(ev("mobilize"));
    expect(r.state.secret.eventDeck).toEqual(["fog"]);
    expect(r.events).toEqual([{ type: "worldEventDrawn", event: ev("mobilize") }]);
  });

  it("an empty deck is filled with all eight first", () => {
    const r = drawWorldEvent(base([]), createSeededRng(3));
    expect(r.state.worldEvent).not.toBeNull();
    expect(r.state.secret.eventDeck).toHaveLength(7);
    const all = [r.state.worldEvent!.kind, ...r.state.secret.eventDeck].sort();
    expect(all).toEqual([...WORLD_EVENT_KINDS].sort());
  });

  it("the fresh deck holds each event once", () => {
    expect([...freshEventDeck(createSeededRng(5))].sort()).toEqual([...WORLD_EVENT_KINDS].sort());
  });

  it("storm on a map without sea routes is skipped", () => {
    const r = drawWorldEvent(base(["storm", "fog"]), noRng);
    expect(r.state.worldEvent).toEqual(ev("fog"));
    expect(r.state.secret.eventDeck).toEqual([]);
  });

  it("goldRush, plague and truce get a random continent over the Rng", () => {
    for (const kind of ["goldRush", "plague", "truce"] as const) {
      const r = drawWorldEvent(base([kind]), createSeededRng(7));
      expect(["nordreich", "suedmark"]).toContain(r.state.worldEvent!.continentId);
    }
  });
});

describe("goldRush and mobilize (reinforcements)", () => {
  const owned = makeState({
    players: ["a", "b"],
    territories: {
      eisenfurt: ["a", 1],
      rabenhain: ["a", 1],
      grauwacht: ["a", 1],
      tannenfeld: ["a", 1],
    },
    fill: null,
  }).territories;

  it("goldRush doubles the bonus of its continent only if the player holds it", () => {
    const rules = testlandRules;
    expect(calculateReinforcements(testland, rules, owned, "a")).toBe(3 + 2);
    const gold = ev("goldRush", { continentId: "nordreich" });
    expect(calculateReinforcements(testland, rules, owned, "a", gold)).toBe(3 + 4);
    const other = ev("goldRush", { continentId: "suedmark" });
    expect(calculateReinforcements(testland, rules, owned, "a", other)).toBe(3 + 2);
    expect(calculateReinforcements(testland, rules, owned, "b", gold)).toBe(3);
  });

  it("mobilize adds 3 for everybody", () => {
    expect(calculateReinforcements(testland, testlandRules, owned, "a", ev("mobilize"))).toBe(8);
    expect(calculateReinforcements(testland, testlandRules, owned, "b", ev("mobilize"))).toBe(6);
  });

  it("the new round's event counts for the first player of that round", () => {
    const s = withEvent(
      makeState({
        players: ["a", "b"],
        active: "b",
        territories: { eisenfurt: ["a", 1], salzmoor: ["b", 1] },
        overrides: { rules: eventRules },
      }),
      ev("fog"),
      ["mobilize"],
    );
    const r = applyHostAction(s, { type: "skipTurn", turn: s.turn }, noRng);
    if (!r.ok) throw new Error(r.code);
    expect(r.state.activePlayerId).toBe("a");
    expect(r.state.worldEvent?.kind).toBe("mobilize");
    expect(r.state.reinforcementsLeft).toBe(3 + 3);
    const types = r.events.map((e) => e.type);
    expect(types.indexOf("roundStarted")).toBeLessThan(types.indexOf("worldEventDrawn"));
    expect(types.indexOf("worldEventDrawn")).toBeLessThan(types.indexOf("turnStarted"));
  });

  it("within a round the event stays; the next round replaces it", () => {
    const s = withEvent(
      makeState({
        players: ["a", "b", "c"],
        overrides: { rules: eventRules },
        territories: { eisenfurt: ["a", 1], salzmoor: ["b", 1], dornental: ["c", 1] },
      }),
      ev("mobilize"),
      ["fog"],
    );
    const s2 = applyHostAction(s, { type: "skipTurn", turn: s.turn }, noRng);
    if (!s2.ok) throw new Error(s2.code);
    expect(s2.state.worldEvent?.kind).toBe("mobilize");
    expect(s2.state.reinforcementsLeft).toBe(6);
    expect(s2.events.map((e) => e.type)).not.toContain("worldEventDrawn");
  });
});

describe("plague", () => {
  it("every territory of the continent with 2+ armies loses 1, never the last; neutral too; others untouched", () => {
    const s = makeState({
      players: ["a", "b"],
      territories: {
        eisenfurt: ["a", 3],
        rabenhain: ["a", 1],
        grauwacht: [null, 2],
        tannenfeld: ["b", 5],
        salzmoor: ["a", 4],
      },
      overrides: { rules: eventRules },
    });
    // continent pick: Rng returning 0 = nordreich
    const first: Rng = { int: () => 0 };
    const r = drawWorldEvent(withEvent(s, null, ["plague"]), first);
    const t = r.state.territories;
    expect([t["eisenfurt"]!.armies, t["rabenhain"]!.armies]).toEqual([2, 1]);
    expect([t["grauwacht"]!.armies, t["tannenfeld"]!.armies]).toEqual([1, 4]);
    expect(t["salzmoor"]!.armies).toBe(4);
    expect(r.state.worldEvent?.continentId).toBe("nordreich");
  });
});

describe("truce", () => {
  const s = withEvent(
    makeState({
      players: ["a", "b"],
      territories: {
        eisenfurt: ["a", 5],
        grauwacht: ["b", 2],
        salzmoor: ["a", 5],
        dornental: ["b", 2],
      },
    }),
    ev("truce", { continentId: "suedmark" }),
  );
  it("targets in the continent are closed, others are not", () => {
    const blocked = act(
      { ...s, activePlayerId: "a" },
      { type: "attack", from: "salzmoor", to: "dornental", dice: 1 },
      { int: () => 0 },
    );
    expect(blocked).toEqual({ ok: false, code: "TRUCE" });
    const blitz = act(s, { type: "blitz", from: "salzmoor", to: "dornental" });
    expect(blitz).toEqual({ ok: false, code: "TRUCE" });
    const open = act(
      s,
      { type: "attack", from: "eisenfurt", to: "grauwacht", dice: 1 },
      { int: () => 3 },
    );
    expect(open.ok).toBe(true);
  });
  it("an attack from the continent into another one is allowed", () => {
    const from = withEvent(
      makeState({ players: ["a", "b"], territories: { salzmoor: ["a", 5], grauwacht: ["b", 2] } }),
      ev("truce", { continentId: "suedmark" }),
    );
    expect(
      act(from, { type: "attack", from: "salzmoor", to: "grauwacht", dice: 1 }, { int: () => 3 })
        .ok,
    ).toBe(true);
  });
  it("the older errors come first: not adjacent before TRUCE, TRUCE before NOT_ENOUGH_ARMIES", () => {
    expect(act(s, { type: "attack", from: "eisenfurt", to: "dornental", dice: 1 })).toEqual({
      ok: false,
      code: "NOT_ADJACENT",
    });
    const weak = withEvent(
      makeState({ players: ["a", "b"], territories: { salzmoor: ["a", 1], dornental: ["b", 2] } }),
      ev("truce", { continentId: "suedmark" }),
    );
    expect(act(weak, { type: "attack", from: "salzmoor", to: "dornental", dice: 1 })).toEqual({
      ok: false,
      code: "TRUCE",
    });
  });
});

describe("storm (welt)", () => {
  function weltGame(): GameState {
    const r = createGame({
      map: welt,
      rules: weltRules,
      playerIds: ["a", "b", "c"],
      rng: createSeededRng(11),
    });
    if (!r.ok) throw new Error(r.code);
    return r.state;
  }
  const set = (s: GameState, owners: Record<string, [string, number]>): GameState => ({
    ...s,
    territories: {
      ...s.territories,
      ...Object.fromEntries(
        Object.entries(owners).map(([id, [ownerId, armies]]) => [id, { ownerId, armies }]),
      ),
    },
  });
  const board = (event: WorldEvent | null): GameState => {
    const s = weltGame();
    return {
      ...set(s, {
        hudsonland: [s.activePlayerId, 6],
        groenland: ["b", 2],
        nordwestland: [s.activePlayerId, 6],
        praerieland: ["b", 2],
      }),
      phase: "attack",
      reinforcementsLeft: 0,
      worldEvent: event,
    };
  };

  it("the sea routes are in the map data", () => {
    expect(welt.seaRoutes).toHaveLength(16);
    expect(testland.seaRoutes).toEqual([]);
  });

  it("an attack over a sea route is SEA_BLOCKED during the storm and fine otherwise", () => {
    const calm = board(null);
    const dice = { int: () => 3 };
    const sea = { type: "attack", from: "hudsonland", to: "groenland", dice: 1 } as const;
    expect(act(calm, sea, dice).ok).toBe(true);
    expect(act(board(ev("storm")), sea, dice)).toEqual({ ok: false, code: "SEA_BLOCKED" });
    expect(
      act(board(ev("storm")), { type: "blitz", from: "hudsonland", to: "groenland" }, dice),
    ).toEqual({ ok: false, code: "SEA_BLOCKED" });
  });

  it("land borders stay open in a storm", () => {
    const s = board(ev("storm"));
    const land = welt.territories
      .find((t) => t.id === "hudsonland")!
      .neighbors.find(
        (n) =>
          !welt.seaRoutes.some(
            ([x, y]) => (x === "hudsonland" && y === n) || (y === "hudsonland" && x === n),
          ),
      )!;
    const g = set(s, { [land]: ["b", 2] });
    expect(
      act(g, { type: "attack", from: "hudsonland", to: land, dice: 1 }, { int: () => 3 }).ok,
    ).toBe(true);
  });

  it("fortify: sea routes do not connect during the storm (chains and adjacent)", () => {
    for (const reach of ["connected", "adjacent"] as const) {
      const s0 = weltGame();
      const me = s0.activePlayerId;
      const base = (event: WorldEvent | null): GameState => ({
        ...set(s0, { hudsonland: [me, 5], groenland: [me, 1] }),
        phase: "fortify",
        worldEvent: event,
        rules: { ...s0.rules, fortifyReach: reach },
      });
      const move = { type: "fortify", from: "hudsonland", to: "groenland", count: 1 } as const;
      // only meaningful if there is no land chain between them; check the calm case decides
      const calm = act(base(null), move);
      expect(calm.ok, reach).toBe(true);
      expect(act(base(ev("storm")), move), reach).toEqual({ ok: false, code: "NOT_CONNECTED" });
      const view = viewFor(base(ev("storm")), me).fortify!;
      const listed = view.reach === "connected" ? view.groups.flat() : Object.keys(view.targets);
      expect(
        listed.includes("groenland") && listed.includes("hudsonland") && view.reach === "adjacent",
      ).toBe(false);
    }
  });

  it("the storm card is drawn on the world map", () => {
    const s = { ...weltGame(), rules: { ...weltRules, worldEvents: true } };
    const r = drawWorldEvent(withEvent(s, null, ["storm"]), noRng);
    expect(r.state.worldEvent?.kind).toBe("storm");
  });
});

describe("rebellion", () => {
  const base = (t: Record<string, [string | null, number]>) =>
    withEvent(
      makeState({
        players: ["a", "b", "c"],
        territories: t,
        fill: null,
        overrides: { rules: eventRules },
      }),
      null,
      ["rebellion"],
    );

  it("the player with most territories loses two to Neutral, armies stay", () => {
    const s = base({
      eisenfurt: ["a", 3],
      rabenhain: ["a", 2],
      grauwacht: ["a", 4],
      tannenfeld: ["b", 1],
      salzmoor: ["c", 1],
    });
    const r = drawWorldEvent(s, createSeededRng(2));
    const lost = r.state.worldEvent!.territoryIds;
    expect(lost).toHaveLength(2);
    expect(r.state.worldEvent!.playerIds).toEqual(["a"]);
    for (const id of lost) {
      expect(r.state.territories[id]!.ownerId).toBeNull();
      expect(r.state.territories[id]!.armies).toBe(s.territories[id]!.armies);
      expect(s.territories[id]!.ownerId).toBe("a");
    }
    expect(Object.values(r.state.territories).filter((t) => t.ownerId === "a")).toHaveLength(1);
  });

  it("a tie in territories goes to the most armies; level in both: all of them lose", () => {
    const byArmies = base({
      eisenfurt: ["a", 3],
      rabenhain: ["a", 3],
      grauwacht: ["a", 3],
      tannenfeld: ["b", 1],
      salzmoor: ["b", 1],
      dornental: ["b", 2],
      kupferstadt: ["c", 1],
    });
    expect(drawWorldEvent(byArmies, createSeededRng(1)).state.worldEvent!.playerIds).toEqual(["a"]);
    const level = base({
      eisenfurt: ["a", 3],
      rabenhain: ["a", 1],
      grauwacht: ["a", 1],
      tannenfeld: ["b", 2],
      salzmoor: ["b", 2],
      dornental: ["b", 1],
      kupferstadt: ["c", 1],
    });
    expect(drawWorldEvent(level, createSeededRng(1)).state.worldEvent!.playerIds).toEqual([
      "a",
      "b",
    ]);
  });

  it("never takes the last territory", () => {
    const two = base({
      eisenfurt: ["a", 3],
      rabenhain: ["a", 2],
      grauwacht: ["b", 1],
      tannenfeld: ["b", 1],
    });
    const r = drawWorldEvent(two, createSeededRng(4));
    // a and b are level in territories (2) but a has more armies: a loses one, keeps one
    expect(r.state.worldEvent!.territoryIds).toHaveLength(1);
    expect(Object.values(r.state.territories).filter((t) => t.ownerId === "a")).toHaveLength(1);
    const single = base({ eisenfurt: ["a", 3], salzmoor: ["b", 1] });
    const r2 = drawWorldEvent(single, createSeededRng(4));
    expect(r2.state.worldEvent).toEqual(ev("rebellion"));
    expect(r2.state.territories).toEqual(single.territories);
  });
});

describe("cardFlood", () => {
  const turnEnd = (event: WorldEvent | null) => {
    const s = {
      ...withEvent(
        makeState({
          players: ["a", "b"],
          territories: { eisenfurt: ["a", 3], salzmoor: ["b", 1] },
          overrides: { rules: eventRules },
        }),
        event,
        ["fog"],
      ),
      conqueredThisTurn: true,
      conquestsThisTurn: 3,
    };
    const r = applyHostAction(s, { type: "skipTurn", turn: s.turn }, createSeededRng(1));
    if (!r.ok) throw new Error(r.code);
    return r;
  };
  it("draws one card per conquest at the end of the turn", () => {
    const r = turnEnd(ev("cardFlood"));
    expect(r.state.secret.hand["a"]).toHaveLength(3);
    expect(r.events.filter((e) => e.type === "cardDrawn")).toHaveLength(3);
  });
  it("without the event it stays at one card", () => {
    expect(turnEnd(ev("fog")).state.secret.hand["a"]).toHaveLength(1);
    expect(turnEnd(null).state.secret.hand["a"]).toHaveLength(1);
  });
});

describe("fog (view)", () => {
  const s = withEvent(
    {
      ...makeState({
        players: ["a", "b"],
        territories: { eisenfurt: ["a", 6], rabenhain: ["b", 7], grauwacht: [null, 9] },
        fill: "b",
      }),
      lastCombat: {
        seq: 1,
        attackerId: "a",
        defenderId: "b",
        from: "eisenfurt",
        to: "rabenhain",
        rolls: [],
        summary: { rollCount: 1, attackerLosses: 0, defenderLosses: 1, conquered: false },
      },
      pendingOccupation: { from: "eisenfurt", to: "tannenfeld", min: 2 },
    },
    ev("fog"),
    ["fog", "storm"],
  );
  it("foreign and neutral armies and everything derived from them are null; own stay", () => {
    const v = viewFor(s, "a");
    expect(v.territories["eisenfurt"]).toMatchObject({ armies: 6, maxAttackDice: 3, maxMove: 5 });
    for (const id of Object.keys(v.territories).filter((i) => i !== "eisenfurt")) {
      expect(v.territories[id], id).toMatchObject({
        armies: null,
        maxAttackDice: null,
        maxMove: null,
      });
    }
    expect(v.territories["grauwacht"]!.ownerId).toBeNull();
    expect(v.lastCombat).not.toBeNull();
  });
  it("another player does not see the open move-in (its max would give the armies away)", () => {
    expect(viewFor(s, "a").pendingOccupation).not.toBeNull();
    expect(viewFor(s, "b").pendingOccupation).toBeNull();
  });
  it("leak test: no foreign army count anywhere in the serialized view", () => {
    const wire = JSON.stringify(viewFor(s, "b"));
    const view = JSON.parse(wire) as ReturnType<typeof viewFor>;
    for (const [id, t] of Object.entries(view.territories)) {
      if (t.ownerId !== "b")
        expect([id, t.armies, t.maxAttackDice, t.maxMove]).toEqual([id, null, null, null]);
    }
    expect(wire).not.toContain('"max"');
    expect(wire).not.toContain("eventDeck");
  });
  it("without fog everything is visible, and the event is public with the deck size only", () => {
    const calm = withEvent(s, ev("goldRush", { continentId: "nordreich" }), ["fog", "storm"]);
    const v = viewFor(calm, "b");
    expect(v.territories["eisenfurt"]!.armies).toBe(6);
    expect(v.worldEvent).toEqual(ev("goldRush", { continentId: "nordreich" }));
    expect(v.worldEventsLeft).toBe(2);
  });
});

describe("start of the game", () => {
  const make = (worldEvents: unknown, seed = 1) =>
    createGame({
      map: testland,
      rules: { ...testlandRules, worldEvents: worldEvents as boolean },
      playerIds: ["a", "b", "c"],
      rng: createSeededRng(seed),
    });

  it("draws the event of round 1 before the first reinforcements; six or seven cards remain", () => {
    const r = make(true);
    if (!r.ok) throw new Error(r.code);
    expect(r.state.worldEvent).not.toBeNull();
    // 7 cards, or 6 when a storm was skipped (testland has no sea routes)
    expect([6, 7]).toContain(r.state.secret.eventDeck.length);
    const types = r.events.map((e) => e.type);
    expect(types).toEqual(["gameStarted", "roundStarted", "worldEventDrawn", "turnStarted"]);
    const turn = r.events.find((e) => e.type === "turnStarted")!;
    expect((turn as { reinforcements: number }).reinforcements).toBe(r.state.reinforcementsLeft);
  });

  it("the deal itself is the same with the option on or off (the deck is shuffled last)", () => {
    const off = make(false, 9);
    const on = make(true, 9);
    if (!off.ok || !on.ok) throw new Error("setup");
    expect(on.state.playerOrder).toEqual(off.state.playerOrder);
    expect(on.state.secret.deck).toEqual(off.state.secret.deck);
    expect(on.state.secret.mission).toEqual(off.state.secret.mission);
  });

  it("off: no event, no deck", () => {
    const r = make(false);
    if (!r.ok) throw new Error(r.code);
    expect(r.state.worldEvent).toBeNull();
    expect(r.state.secret.eventDeck).toEqual([]);
  });

  it.each([[undefined], ["yes"], [1], [null]])("worldEvents %j is INVALID_RULES", (v) => {
    expect(make(v)).toEqual({ ok: false, code: "INVALID_RULES" });
  });
});

describe("random games with world events", () => {
  it.each([2, 3, 4])(
    "%i players on testland: legal moves are always accepted, invariants hold",
    (n) => {
      let events = 0;
      for (let seed = 1; seed <= 25; seed++) {
        const { steps } = playRandomGame({
          seed,
          players: n,
          rules: { ...testlandRules, worldEvents: true, victoryMode: "domination" },
          maxActions: 600,
          hostRate: 0.02,
        });
        for (const step of steps) {
          const s = step.after;
          for (const t of Object.values(s.territories)) expect(t.armies).toBeGreaterThanOrEqual(1);
          expect(s.secret.eventDeck.length).toBeLessThanOrEqual(8);
          if (step.events.some((e) => e.type === "worldEventDrawn")) events++;
        }
      }
      expect(events).toBeGreaterThan(0);
    },
  );
});
