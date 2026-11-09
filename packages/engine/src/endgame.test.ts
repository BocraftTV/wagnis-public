import { describe, expect, it } from "vitest";
import {
  applyAction,
  cardCatalog,
  createDiceRng,
  createGame,
  createSeededRng,
  findSuggestedSets,
  isEliminated,
  mustTrade,
  testland,
  testlandRules,
} from "./index.js";
import type { Action, GameState } from "./index.js";
import { makeState, totalArmies } from "./testkit.js";

const strike = (from: string, to: string): Action => ({ type: "attack", from, to, dice: 1 });

function ok(state: GameState, player: string, action: Action, faces: number[] = []): GameState {
  const r = applyAction(state, player, action, createDiceRng(faces));
  if (!r.ok) throw new Error(`unexpected ${r.code}`);
  return r.state;
}

function events(state: GameState, player: string, action: Action, faces: number[]) {
  const r = applyAction(state, player, action, createDiceRng(faces));
  if (!r.ok) throw new Error(`unexpected ${r.code}`);
  return r.events;
}

describe("elimination", () => {
  // b owns only rabenhain; a and c hold the rest.
  const three = () =>
    makeState({
      players: ["a", "b", "c"],
      fill: "c",
      territories: { eisenfurt: ["a", 4], rabenhain: ["b", 1] },
    });

  it("derives elimination from the territories", () => {
    const s = three();
    expect(isEliminated(s, "b")).toBe(false);
    expect(isEliminated(ok(s, "a", strike("eisenfurt", "rabenhain"), [6, 1]), "b")).toBe(true);
  });

  it("emits playerEliminated for the previous owner, but no gameWon while others remain", () => {
    const ev = events(three(), "a", strike("eisenfurt", "rabenhain"), [6, 1]).map((e) => e.type);
    expect(ev).toEqual(["attackRolled", "territoryConquered", "armiesMoved", "playerEliminated"]);
    const after = ok(three(), "a", strike("eisenfurt", "rabenhain"), [6, 1]);
    expect(after.winnerId).toBeNull();
  });

  it("skips the eliminated player at the turn change", () => {
    let s = ok(three(), "a", strike("eisenfurt", "rabenhain"), [6, 1]);
    s = ok(s, "a", { type: "occupy", count: 1 });
    s = ok(s, "a", { type: "endPhase" }); // attack -> fortify
    s = ok(s, "a", { type: "endPhase" }); // next turn
    expect(s.activePlayerId).toBe("c");
    expect(s.turn).toBe(2);
    expect(s.phase).toBe("reinforce");
  });

  it("wraps around the order past an eliminated last seat", () => {
    const s = makeState({
      players: ["a", "b", "c"],
      fill: "b",
      territories: { eisenfurt: ["c", 4], rabenhain: ["a", 1] },
      active: "c",
    });
    let t = ok(s, "c", strike("eisenfurt", "rabenhain"), [6, 1]); // a eliminated
    t = ok(t, "c", { type: "occupy", count: 1 });
    t = ok(t, "c", { type: "endPhase" });
    t = ok(t, "c", { type: "endPhase" });
    expect(t.activePlayerId).toBe("b");
    t = ok({ ...t, phase: "fortify" }, "b", { type: "endPhase" });
    expect(t.activePlayerId).toBe("c"); // a is skipped again
  });
});

describe("game end", () => {
  // a holds all but rabenhain, which b defends with a single army.
  const finalBlow = () =>
    makeState({
      fill: "a",
      territories: { eisenfurt: ["a", 5], rabenhain: ["b", 1] },
    });

  it("sets winnerId when one player holds every territory and emits gameWon", () => {
    const s = finalBlow();
    const ev = events(s, "a", strike("eisenfurt", "rabenhain"), [6, 1]);
    expect(ev.map((e) => e.type)).toEqual([
      "attackRolled",
      "territoryConquered",
      "armiesMoved",
      "playerEliminated",
      "gameWon",
    ]);
    expect(ev.at(-1)).toEqual({ type: "gameWon", playerId: "a", reason: "lastPlayer" });
    const after = ok(s, "a", strike("eisenfurt", "rabenhain"), [6, 1]);
    expect(after.winnerId).toBe("a");
    expect(after.pendingOccupation).toBeNull();
    expect(after.lastCombat!.summary.conquered).toBe(true);
  });

  it("answers GAME_OVER to every action afterwards, state unchanged", () => {
    const over = ok(finalBlow(), "a", strike("eisenfurt", "rabenhain"), [6, 1]);
    const copy = structuredClone(over);
    const actions: Action[] = [
      strike("eisenfurt", "rabenhain"),
      { type: "blitz", from: "eisenfurt", to: "rabenhain" },
      { type: "occupy", count: 1 },
      { type: "endPhase" },
      { type: "placeArmies", territoryId: "eisenfurt", count: 1 },
    ];
    for (const phase of ["reinforce", "attack", "fortify"] as const) {
      for (const a of actions) {
        const r = applyAction({ ...over, phase }, "a", a, createDiceRng([]));
        expect(r, `${phase} ${a.type}`).toEqual({ ok: false, code: "GAME_OVER" });
      }
    }
    expect(over).toEqual(copy);
    expect(over.lastCombat).not.toBeNull(); // stays after the end
  });

  it("a blitz can win the game and eliminate a player", () => {
    // 4 vs 1: one roll with 3 dice conquers the last territory.
    const r = applyAction(
      finalBlow(),
      "a",
      { type: "blitz", from: "eisenfurt", to: "rabenhain" },
      createDiceRng([6, 5, 4, 1]),
    );
    if (!r.ok) throw new Error(r.code);
    expect(r.state.winnerId).toBe("a");
    expect(r.events.map((e) => e.type)).toEqual([
      "attackRolled",
      "territoryConquered",
      "armiesMoved",
      "playerEliminated",
      "gameWon",
    ]);
    expect(r.state.pendingOccupation).toBeNull();
  });

  it("does not end the game while another player still holds a territory", () => {
    const s = makeState({
      fill: "a",
      territories: { eisenfurt: ["a", 5], rabenhain: ["b", 1], tannenfeld: ["b", 1] },
    });
    expect(ok(s, "a", strike("eisenfurt", "rabenhain"), [6, 1]).winnerId).toBeNull();
  });
});

describe("turn state", () => {
  const afterConquest = () => {
    const s = makeState({
      players: ["a", "b", "c"],
      fill: "c",
      territories: { eisenfurt: ["a", 4], rabenhain: ["b", 1], tannenfeld: ["b", 1] },
    });
    return ok(ok(s, "a", strike("eisenfurt", "rabenhain"), [6, 1]), "a", {
      type: "occupy",
      count: 1,
    });
  };

  it("sets conqueredThisTurn on conquest and resets it at the next turn start", () => {
    const s = afterConquest();
    expect(s.conqueredThisTurn).toBe(true);
    const fortify = ok(s, "a", { type: "endPhase" });
    expect(fortify.conqueredThisTurn).toBe(true); // still this turn
    const next = ok(fortify, "a", { type: "endPhase" });
    expect(next.conqueredThisTurn).toBe(false);
  });

  it("answers a non-active player NOT_YOUR_TURN even after the end", () => {
    const over = ok(
      makeState({ fill: "a", territories: { eisenfurt: ["a", 5], rabenhain: ["b", 1] } }),
      "a",
      strike("eisenfurt", "rabenhain"),
      [6, 1],
    );
    expect(applyAction(over, "b", { type: "endPhase" }, createDiceRng([]))).toEqual({
      ok: false,
      code: "NOT_YOUR_TURN",
    });
  });

  it("clears lastCombat at the turn change but keeps combatSeq", () => {
    const s = afterConquest();
    expect(s.lastCombat!.seq).toBe(1);
    const next = ok(ok(s, "a", { type: "endPhase" }), "a", { type: "endPhase" });
    expect(next.lastCombat).toBeNull();
    expect(next.combatSeq).toBe(1);
  });
});

describe("invariants over random games", () => {
  it("every territory keeps at least 1 army and armies are only lost", () => {
    let combats = 0;
    let conquests = 0;
    let endings = 0;
    let fortified = 0;
    let trades = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const players = ["a", "b", "c", "d"].slice(0, 2 + (seed % 3));
      const g = createGame({
        map: testland,
        rules: testlandRules,
        playerIds: players,
        rng: createSeededRng(seed),
      });
      if (!g.ok) throw new Error(g.code);
      let state = g.state;
      const rng = createSeededRng(seed * 101);
      let total = totalArmies(state);
      let lastSeq = 0;
      const catalog = new Map(cardCatalog(testland, testlandRules).map((c) => [c.id, c]));
      const allCards = [...catalog.keys()].sort();
      for (let step = 0; step < 3000 && state.winnerId === null; step++) {
        const me = state.activePlayerId;
        const own = Object.keys(state.territories).filter(
          (t) => state.territories[t]!.ownerId === me,
        );
        const hand = state.secret.hand[me] ?? [];
        const tradeOptions = findSuggestedSets(state, me, catalog);
        const pick = <T>(xs: T[]): T => xs[rng.int(xs.length)]!;
        let action: Action;
        if (state.pendingOccupation) {
          const p = state.pendingOccupation;
          action = { type: "occupy", count: p.min + rng.int(state.territories[p.from]!.armies) };
        } else if (
          state.phase === "reinforce" &&
          (hand.length >= state.rules.cards.mustTradeAt ||
            (tradeOptions.length > 0 && rng.int(3) === 0))
        ) {
          // Trade when forced (otherwise the mandatory trade would block the bot) or at random.
          const o = pick(tradeOptions);
          action =
            o.bonusTerritoryId !== null && rng.int(2) === 0
              ? { type: "tradeCards", cardIds: o.cardIds, bonusTerritoryId: o.bonusTerritoryId }
              : { type: "tradeCards", cardIds: o.cardIds };
        } else if (state.phase === "reinforce") {
          action =
            state.reinforcementsLeft > 0
              ? { type: "placeArmies", territoryId: pick(own), count: state.reinforcementsLeft }
              : { type: "endPhase" };
        } else if (state.phase === "attack" && rng.int(8) > 0) {
          // Mostly legal attacks, from a territory with a hostile neighbour; sometimes junk.
          const options = own.flatMap((from) =>
            (testland.territories.find((t) => t.id === from)?.neighbors ?? [])
              .filter((to) => state.territories[to]!.ownerId !== me)
              .map((to) => ({ from, to })),
          );
          const { from, to } =
            options.length > 0 && rng.int(10) > 0
              ? pick(options)
              : { from: pick(own), to: pick(Object.keys(state.territories)) };
          action =
            rng.int(2) === 0
              ? { type: "blitz", from, to }
              : { type: "attack", from, to, dice: 1 + rng.int(3) };
        } else if (state.phase === "fortify" && rng.int(2) === 0) {
          // Mostly meant moves between own territories, some of them illegal on purpose.
          const from = pick(own);
          action = {
            type: "fortify",
            from,
            to: pick(own),
            count: 1 + rng.int(state.territories[from]!.armies),
          };
        } else {
          action = { type: "endPhase" };
        }
        // The mandatory trade can never be left with endPhase.
        if (mustTrade(state, me)) {
          expect(applyAction(state, me, { type: "endPhase" }, rng)).toEqual({
            ok: false,
            code: "MUST_TRADE",
          });
        }
        const r = applyAction(state, me, action, rng);
        if (!r.ok) continue; // random attempts may be illegal; the state must then stay as it was
        state = r.state;
        if (action.type === "attack" || action.type === "blitz") combats++;
        if (r.events.some((e) => e.type === "territoryConquered")) conquests++;
        for (const t of Object.values(state.territories))
          expect(t.armies).toBeGreaterThanOrEqual(1);
        const now = totalArmies(state);
        const placed = action.type === "placeArmies" ? action.count : 0;
        // A card trade adds at most the territory bonus straight onto the map.
        const bonus = action.type === "tradeCards" ? testlandRules.cards.territoryBonus : 0;
        expect(now).toBeLessThanOrEqual(total + placed + bonus);
        if (action.type === "fortify") expect(now).toBe(total);
        // Cards: each one in exactly one place, always; at most 1 draw per action (so per turn).
        const everywhere = [
          ...Object.values(state.secret.hand).flat(),
          ...state.secret.deck,
          ...state.secret.discard,
        ].sort();
        expect(everywhere).toEqual(allCards);
        expect(r.events.filter((e) => e.type === "cardDrawn").length).toBeLessThanOrEqual(1);
        // Only the trade event may carry card ids; draws and takeovers stay anonymous.
        for (const e of r.events) {
          if (e.type !== "cardsTraded") expect(JSON.stringify(e)).not.toContain("card-");
        }
        if (action.type === "fortify") fortified++;
        if (action.type === "tradeCards") trades++;
        total = now;
        const seq = state.lastCombat?.seq ?? lastSeq;
        expect(seq).toBeGreaterThanOrEqual(lastSeq);
        lastSeq = seq;
        expect(state.combatSeq).toBeGreaterThanOrEqual(lastSeq);
        if (state.pendingOccupation) {
          const p = state.pendingOccupation;
          expect(state.territories[p.to]!.ownerId).toBe(me);
          expect(state.territories[p.from]!.armies).toBeGreaterThan(1);
        }
        expect(isEliminated(state, state.activePlayerId)).toBe(false);
      }
      if (state.winnerId !== null) endings++;
    }
    // The random play must actually reach combats, conquests and finished games.
    expect(combats).toBeGreaterThan(100);
    expect(conquests).toBeGreaterThan(20);
    expect(endings).toBeGreaterThan(0);
    expect(fortified).toBeGreaterThan(5);
    expect(trades).toBeGreaterThan(5);
  });
});
