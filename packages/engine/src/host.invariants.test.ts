import { describe, expect, it } from "vitest";
import {
  cardCatalog,
  isEliminated,
  missionSatisfied,
  testland,
  testlandRules,
  viewFor,
  welt,
  weltRules,
} from "./index.js";
import type { GameState, MapDefinition, RuleConfig } from "./index.js";
import { playRandomGame } from "./playbot.js";
import type { Step } from "./playbot.js";

// Plan 007, section 6: invariants over random games with random host actions (fixed seeds, 2 to 6 players, both
// modes). rules.md 1.7: owners, removed players, neutral territories, the active player, the cards, the missions.

const cardTotal = (s: GameState): number =>
  Object.values(s.secret.hand).reduce((n, h) => n + h.length, 0) +
  s.secret.deck.length +
  s.secret.discard.length;

const neutralIds = (s: GameState): string[] =>
  Object.entries(s.territories)
    .filter(([, t]) => t.ownerId === null)
    .map(([id]) => id);

function check(
  label: string,
  map: MapDefinition,
  rules: RuleConfig,
  n: number,
  start: GameState,
  steps: Step[],
): { removals: number; skips: number; finished: boolean } {
  const players = new Set(start.playerOrder);
  const total = cardCatalog(map, rules).length;
  let removals = 0;
  let skips = 0;
  const states = [start, ...steps.map((s) => s.after)];
  for (const s of states) {
    for (const [id, t] of Object.entries(s.territories)) {
      expect(t.ownerId === null || players.has(t.ownerId), `${label} ${id} owner`).toBe(true);
      expect(t.armies).toBeGreaterThanOrEqual(1);
    }
    expect(s.playerOrder).toEqual(start.playerOrder);
    // removed players: listed once, in the order, never anything left of them
    expect(new Set(s.removedPlayerIds).size).toBe(s.removedPlayerIds.length);
    for (const p of s.removedPlayerIds) {
      expect(players.has(p)).toBe(true);
      expect(isEliminated(s, p), `${label} ${p} owns territories`).toBe(true);
      expect(s.secret.hand[p], `${label} ${p} hand`).toEqual([]);
      expect(s.secret.mission[p]).toBeNull();
      expect(s.secret.originalMission[p]).toBeNull();
      expect(s.secret.missionReplaced[p]).toBe(false);
      const v = viewFor(s, p);
      expect(v.secret).toEqual({
        mission: null,
        missionReplaced: false,
        hand: [],
        suggestedSets: [],
        mustTrade: false,
      });
      expect(v.handCounts[p]).toBe(0);
    }
    // everyone sees the same list
    for (const p of players) expect(viewFor(s, p).removedPlayerIds).toEqual(s.removedPlayerIds);
    // the active player is in the game while nobody has won
    if (s.winnerId === null) {
      expect(isEliminated(s, s.activePlayerId), `${label} active eliminated`).toBe(false);
      expect(s.removedPlayerIds.includes(s.activePlayerId)).toBe(false);
    } else {
      expect(isEliminated(s, s.winnerId)).toBe(false);
      expect(s.removedPlayerIds.includes(s.winnerId)).toBe(false);
      expect(s.pendingOccupation).toBeNull();
    }
    expect(cardTotal(s), `${label} cards`).toBe(total);
    expect(s.winReason !== null).toBe(s.winnerId !== null);
  }
  for (const step of steps) {
    const { before, after } = step;
    // neutral territories: they appear at the start (2 players) or through removePlayer; only conquest takes them
    const gained = neutralIds(after).filter((id) => !neutralIds(before).includes(id));
    if (step.host && step.action.type === "removePlayer") {
      removals++;
      const removed = step.action.playerId;
      for (const id of gained) expect(before.territories[id]!.ownerId).toBe(removed);
      expect(gained.length).toBe(
        Object.values(before.territories).filter((t) => t.ownerId === removed).length,
      );
      expect(after.removedPlayerIds).toEqual([...before.removedPlayerIds, removed]);
    } else {
      expect(gained, `${label}: neutral gained outside a removal`).toEqual([]);
    }
    // neutral territories shrink only by conquest: an attack or blitz of the active player
    const lost = neutralIds(before).filter((id) => !neutralIds(after).includes(id));
    if (lost.length > 0) {
      expect(
        !step.host && (step.action.type === "attack" || step.action.type === "blitz"),
        `${label}: neutral lost by ${step.action.type}`,
      ).toBe(true);
      for (const id of lost) expect(after.territories[id]!.ownerId).toBe(step.playerId);
    }
    if (step.host && step.action.type === "skipTurn") skips++;
    // nobody but the active player acts; a host step is no player action
    if (!step.host) expect(step.playerId).toBe(before.activePlayerId);
    // a win appears only by the active player's own action, at the start of a turn, or by the last-player rule
    if (after.winnerId !== null && before.winnerId === null) {
      if (after.winReason === "lastPlayer") {
        expect(
          [...players].filter((p) => !isEliminated(after, p)),
          `${label}: lastPlayer`,
        ).toEqual([after.winnerId]);
      } else if (step.host) {
        // by mission through a host action: only the skipped player at the move-in or the successor at the turn start
        const w = after.winnerId;
        expect(
          w === before.activePlayerId || w === after.activePlayerId,
          `${label}: mission win ${w} after a host action`,
        ).toBe(true);
        if (step.action.type === "removePlayer") {
          expect(w, "mission win by removing a non-active player").toBe(after.activePlayerId);
          expect(after.activePlayerId).not.toBe(before.activePlayerId);
        }
      } else {
        const own = after.winnerId === step.playerId;
        const turnStart =
          (step.action.type === "endPhase" || step.action.type === "fortify") &&
          after.winnerId === after.activePlayerId;
        expect(own || turnStart, `${label}: winner after ${step.action.type}`).toBe(true);
      }
    }
    // after every action of the active player (not a host action) with no open move-in: mission unmet or game over
    if (!step.host && rules.victoryMode === "missions" && after.winnerId === null) {
      if (after.pendingOccupation === null) {
        expect(
          missionSatisfied(after, map, after.activePlayerId),
          `${label}: met mission, no winner`,
        ).toBe(false);
      }
    }
    // events never name a removed player as an actor of a later step
    if (!step.host) expect(before.removedPlayerIds.includes(step.playerId)).toBe(false);
  }
  return { removals, skips, finished: states.at(-1)!.winnerId !== null };
}

describe.each(
  [2, 3, 4, 5, 6].flatMap(
    (n) =>
      [
        [n, "missions"],
        [n, "domination"],
      ] as const,
  ),
)("testland, %i players, %s: random games with random host actions", (n, mode) => {
  it("keeps every invariant of rules.md 1.7 after every action", () => {
    const rules = { ...testlandRules, victoryMode: mode };
    let removals = 0;
    let skips = 0;
    let finished = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { start, steps } = playRandomGame({ seed, players: n, rules, hostRate: 0.08 });
      const r = check(`seed ${seed}`, testland, rules, n, start, steps);
      removals += r.removals;
      skips += r.skips;
      if (r.finished) finished++;
    }
    expect(removals, "removals exercised").toBeGreaterThan(0);
    expect(skips, "skips exercised").toBeGreaterThan(0);
    expect(finished, "finished games").toBeGreaterThan(0);
  });
});

describe.each([2, 3, 6])("welt, %i players: random games with random host actions", (n) => {
  it("keeps every invariant after every action", () => {
    const rules = { ...weltRules, victoryMode: "missions" as const };
    let removals = 0;
    for (let seed = 1; seed <= 5; seed++) {
      const { start, steps } = playRandomGame({
        seed,
        players: n,
        map: welt,
        rules,
        maxActions: 300,
        hostRate: 0.02,
      });
      removals += check(`welt seed ${seed}`, welt, rules, n, start, steps).removals;
    }
    expect(removals).toBeGreaterThan(0);
  });
});

describe("testland, fortifyMoves 2: random games with random host actions", () => {
  it("keeps every invariant of rules.md 1.7 after every action; the counter is 0 after a turn change by the host", () => {
    const rules = { ...testlandRules, fortifyMoves: 2 as const };
    let skipsAfterFirst = 0;
    for (const n of [2, 3, 6]) {
      for (let seed = 1; seed <= 40; seed++) {
        const { start, steps } = playRandomGame({ seed, players: n, rules, hostRate: 0.08 });
        check(`${n} players, seed ${seed}`, testland, rules, n, start, steps);
        for (const step of steps) {
          if (!step.host) continue;
          if (step.after.activePlayerId !== step.before.activePlayerId) {
            expect(step.after.fortifyMovesDone).toBe(0);
          }
          if (step.action.type === "skipTurn" && step.before.fortifyMovesDone === 1) {
            skipsAfterFirst++;
          }
        }
      }
    }
    expect(skipsAfterFirst, "skips after the first move exercised").toBeGreaterThan(0);
  });
});
