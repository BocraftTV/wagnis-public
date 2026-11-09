import { getMap } from "./maps/index.js";
import { isEliminated } from "./players.js";
import type { GameState, ScoreEntry } from "./types.js";

/**
 * The score of the round limit (rules.md 11.2): one point per own territory plus the bonus of every continent held
 * completely (as in 5.1). Players still in the game only; the neutral owner never counts. In seat order.
 */
export function scoreboard(state: GameState): ScoreEntry[] {
  const map = getMap(state.mapId);
  if (!map) return [];
  return state.playerOrder
    .filter((p) => !isEliminated(state, p))
    .map((playerId): ScoreEntry => {
      const owned = map.territories.filter((t) => state.territories[t.id]?.ownerId === playerId);
      let continentBonus = 0;
      for (const continent of map.continents) {
        const members = map.territories.filter((t) => t.continentId === continent.id);
        if (
          members.length > 0 &&
          members.every((t) => state.territories[t.id]?.ownerId === playerId)
        )
          continentBonus += continent.bonus;
      }
      const armies = owned.reduce((sum, t) => sum + (state.territories[t.id]?.armies ?? 0), 0);
      return {
        playerId,
        territories: owned.length,
        continentBonus,
        points: owned.length + continentBonus,
        armies,
      };
    });
}

/** Winners of the score: most points, then most armies; all who are level on both win together (question 52). */
export function scoreWinners(scores: ScoreEntry[]): string[] {
  const best = [...scores].sort((a, b) => b.points - a.points || b.armies - a.armies)[0];
  if (!best) return [];
  return scores
    .filter((s) => s.points === best.points && s.armies === best.armies)
    .map((s) => s.playerId);
}
