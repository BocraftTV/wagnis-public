import { describe, expect, it } from "vitest";
import { cardCatalog, isEliminated, missionSatisfied, testland, testlandRules } from "./index.js";
import type { GameState } from "./index.js";
import { playRandomGame } from "./playbot.js";

const cardTotal = (s: GameState): number =>
  Object.values(s.secret.hand).reduce((n, h) => n + h.length, 0) +
  s.secret.deck.length +
  s.secret.discard.length;

const neutralIds = (s: GameState): string[] =>
  Object.entries(s.territories)
    .filter(([, t]) => t.ownerId === null)
    .map(([id]) => id);

describe.each(
  [2, 3, 4, 5, 6].flatMap(
    (n) =>
      [
        [n, "missions"],
        [n, "domination"],
      ] as const,
  ),
)("random games with %i players, %s: invariants after every action", (n, mode) => {
  it("keeps owners, the turn, the cards and the neutral owner consistent", () => {
    const total = cardCatalog(testland, testlandRules).length;
    let finished = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { start, steps } = playRandomGame({
        seed,
        players: n,
        rules: { ...testlandRules, victoryMode: mode },
      });
      const players = new Set(start.playerOrder);
      expect(players.size).toBe(n);
      const states = [start, ...steps.map((s) => s.after)];
      let neutral = neutralIds(start);
      expect(neutral.length > 0, `seed ${seed}: neutral only with 2 players`).toBe(n === 2);
      for (const s of states) {
        for (const [id, t] of Object.entries(s.territories)) {
          expect(t.ownerId === null || players.has(t.ownerId), `${seed} ${id} owner`).toBe(true);
          expect(t.armies).toBeGreaterThanOrEqual(1);
        }
        // Neutral is no seat: never in the order, never active, never holding cards or a mission
        expect(s.playerOrder).toEqual(start.playerOrder);
        expect(s.playerOrder.includes(null as never)).toBe(false);
        expect(players.has(s.activePlayerId)).toBe(true);
        expect(Object.keys(s.secret.hand).sort()).toEqual([...players].sort());
        expect(Object.keys(s.secret.mission).sort()).toEqual([...players].sort());
        expect(cardTotal(s)).toBe(total);
        // Neutral arises at the start (2 players) or through the host removing a player (plan 007, step 5 adds
        // that to this bot); without host actions, as here, it only shrinks: neutral never gains by conquest
        const now = neutralIds(s);
        expect(
          now.every((id) => neutral.includes(id)),
          `seed ${seed}: neutral gained`,
        ).toBe(true);
        neutral = now;
      }
      if (states.at(-1)!.winnerId !== null) finished++;
      const map = testland;
      for (const s of states) {
        // every player has exactly one mission in "missions", none in "domination"
        for (const p of players) {
          expect(s.secret.mission[p] !== null, `${seed} mission of ${p}`).toBe(mode === "missions");
          expect(s.secret.originalMission[p] !== null).toBe(mode === "missions");
        }
        // winReason goes with winnerId; the winner is still in the game
        expect(s.winReason !== null).toBe(s.winnerId !== null);
        if (s.winnerId !== null) {
          expect(isEliminated(s, s.winnerId)).toBe(false);
          expect(s.pendingOccupation).toBeNull();
        } else if (mode === "missions" && s.pendingOccupation === null) {
          // after every action without an open move-in the active mission is unmet, or the game is over
          expect(
            missionSatisfied(s, map, s.activePlayerId),
            `seed ${seed}: met mission, no winner`,
          ).toBe(false);
        }
      }
      for (const step of steps) {
        const w = step.after.winnerId;
        if (w === null || step.before.winnerId !== null) continue;
        // a winner appears only through the active player's own action or at the start of their turn
        const own = w === step.playerId;
        const turnStart =
          (step.action.type === "endPhase" || step.action.type === "fortify") &&
          w === step.after.activePlayerId;
        expect(own || turnStart, `seed ${seed}: winner ${w} after ${step.action.type}`).toBe(true);
        if (step.action.type === "endPhase" && step.before.phase !== "fortify")
          throw new Error("endPhase won");
        if (step.after.winReason === "mission") expect(mode).toBe("missions");
      }
      // Only the active player acts, and the neutral owner never appears as an actor
      for (const step of steps) {
        expect(step.playerId).toBe(step.before.activePlayerId);
        for (const e of step.events) {
          // every actor in every event is a real player: the neutral owner never acts, starts a turn or changes phase
          if ("playerId" in e) expect(players.has(e.playerId), `${seed} ${e.type}`).toBe(true);
        }
      }
    }
    // the winner and winReason checks above only mean something if games really end
    expect(finished, `${n} players, ${mode}: finished games`).toBeGreaterThan(0);
  });
});
