import { describe, expect, it } from "vitest";
import { cardCatalog, isEliminated, missionSatisfied, welt, weltRules } from "./index.js";
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

// Random games on the world map: fixed seeds and a limited number of actions (the board is large).
describe.each([2, 3, 4, 5, 6])("random games on welt with %i players", (n) => {
  it("keeps owners, the turn, the cards, the neutral owner and the missions consistent", () => {
    const total = cardCatalog(welt, weltRules).length;
    expect(total).toBe(44);
    for (let seed = 1; seed <= 6; seed++) {
      const { start, steps } = playRandomGame({
        seed,
        players: n,
        map: welt,
        rules: weltRules,
        maxActions: 300,
      });
      const players = new Set(start.playerOrder);
      expect(steps.length).toBeGreaterThan(10);
      const states = [start, ...steps.map((s) => s.after)];
      let neutral = neutralIds(start);
      expect(neutral.length > 0, `seed ${seed}: neutral only with 2 players`).toBe(n === 2);
      for (const s of states) {
        expect(Object.keys(s.territories)).toHaveLength(42);
        for (const [id, t] of Object.entries(s.territories)) {
          expect(t.ownerId === null || players.has(t.ownerId), `${seed} ${id} owner`).toBe(true);
          expect(t.armies).toBeGreaterThanOrEqual(1);
        }
        expect(players.has(s.activePlayerId)).toBe(true);
        expect(cardTotal(s)).toBe(total);
        // at most one card per turn: no hand ever holds more than the mandatory-trade limit plus the new card
        for (const h of Object.values(s.secret.hand)) expect(h.length).toBeLessThanOrEqual(9);
        // same rule as in invariants.test.ts: no host actions here, so the neutral set only shrinks
        const now = neutralIds(s);
        expect(now.every((id) => neutral.includes(id))).toBe(true);
        neutral = now;
        for (const p of players) expect(s.secret.mission[p] !== null).toBe(true);
        expect(s.winReason !== null).toBe(s.winnerId !== null);
        if (s.winnerId !== null) expect(isEliminated(s, s.winnerId)).toBe(false);
        else if (s.pendingOccupation === null) {
          expect(
            missionSatisfied(s, welt, s.activePlayerId),
            `seed ${seed}: met mission, no winner`,
          ).toBe(false);
        }
      }
      for (const step of steps) expect(step.playerId).toBe(step.before.activePlayerId);
    }
  });
});
