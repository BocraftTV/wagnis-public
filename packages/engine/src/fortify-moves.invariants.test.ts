import { describe, expect, it } from "vitest";
import { cardCatalog, testland, testlandRules } from "./index.js";
import type { GameState, RuleConfig } from "./index.js";
import { playRandomGame } from "./playbot.js";
import { totalArmies } from "./testkit.js";

// Plan 011, section 7: random games with both settings and both reaches. Only the active player moves; at most
// `fortifyMoves` accepted fortify actions per turn; the counter is 0 outside the fortify phase.

const cardTotal = (s: GameState): number =>
  Object.values(s.secret.hand).reduce((n, h) => n + h.length, 0) +
  s.secret.deck.length +
  s.secret.discard.length;

describe.each(
  ([1, 2] as const).flatMap((m) =>
    (["connected", "adjacent"] as const).flatMap((r) => [2, 3, 5].map((n) => [m, r, n] as const)),
  ),
)("random games with fortifyMoves %i, fortifyReach %s, %i players", (moves, reach, n) => {
  it("keeps the move counter, the armies and the cards consistent", () => {
    const rules: RuleConfig = { ...testlandRules, fortifyMoves: moves, fortifyReach: reach };
    const total = cardCatalog(testland, rules).length;
    let finished = 0;
    let turnsWithTwo = 0;
    let continuedAfterFirst = 0;
    for (let seed = 1; seed <= 40; seed++) {
      const { start, steps } = playRandomGame({ seed, players: n, rules });
      const perTurn = new Map<number, number>();
      for (const s of [start, ...steps.map((x) => x.after)]) {
        expect(s.rules.fortifyMoves, `seed ${seed}: setting changed`).toBe(moves);
        if (s.phase !== "fortify")
          expect(s.fortifyMovesDone, `seed ${seed}: outside fortify`).toBe(0);
        else if (s.winnerId === null) {
          expect(s.fortifyMovesDone, `seed ${seed}: in fortify`).toBeLessThanOrEqual(moves - 1);
        }
        expect(cardTotal(s)).toBe(total);
      }
      for (const step of steps) {
        if (step.action.type !== "fortify") continue;
        expect(totalArmies(step.after), `seed ${seed}: armies`).toBe(totalArmies(step.before));
        const turn = step.before.turn;
        perTurn.set(turn, (perTurn.get(turn) ?? 0) + 1);
        // the counter goes up by one with every accepted move
        expect(step.after.fortifyMovesDone === step.before.fortifyMovesDone + 1).toBe(
          step.after.turn === step.before.turn,
        );
        if (step.after.turn === step.before.turn && step.after.winnerId === null) {
          continuedAfterFirst++;
          expect(step.after.activePlayerId).toBe(step.before.activePlayerId);
          expect(step.after.phase).toBe("fortify");
        }
      }
      for (const [turn, count] of perTurn) {
        expect(count, `seed ${seed} turn ${turn}`).toBeLessThanOrEqual(moves);
        if (count === 2) turnsWithTwo++;
      }
      if (steps.at(-1)?.after.winnerId != null) finished++;
    }
    expect(finished, "finished games").toBeGreaterThan(0);
    if (moves === 1) {
      expect(turnsWithTwo).toBe(0);
      expect(continuedAfterFirst).toBe(0);
    } else {
      expect(turnsWithTwo, "turns with two moves").toBeGreaterThan(0);
      expect(continuedAfterFirst, "turns that went on after the first move").toBeGreaterThan(0);
    }
  });
});
