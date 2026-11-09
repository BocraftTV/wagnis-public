import { getMap } from "./maps/index.js";
import { isEliminated } from "./players.js";
import { heldContinents } from "./reinforcement.js";
import { TEAM_IDS, teamMembers } from "./teams.js";
import type { GameState, ScoreEntry, TeamScore } from "./types.js";

/**
 * The score of the round limit (rules.md 11.2): one point per own territory plus the bonus of every continent held
 * completely (as in 5.1); in a team game every continent the team holds completely counts for each member (plan 015,
 * as for the reinforcements). Players still in the game only; the neutral owner never counts. In seat order.
 */
export function scoreboard(state: GameState): ScoreEntry[] {
  const map = getMap(state.mapId);
  if (!map) return [];
  return state.playerOrder
    .filter((p) => !isEliminated(state, p))
    .map((playerId): ScoreEntry => {
      const owned = map.territories.filter((t) => state.territories[t.id]?.ownerId === playerId);
      const continentBonus = heldContinents(
        map,
        state.territories,
        teamMembers(state, playerId),
      ).reduce((sum, c) => sum + c.bonus, 0);
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
export function scoreWinners(
  scores: { playerId: string; points: number; armies: number }[],
): string[] {
  const best = [...scores].sort((a, b) => b.points - a.points || b.armies - a.armies)[0];
  if (!best) return [];
  return scores
    .filter((s) => s.points === best.points && s.armies === best.armies)
    .map((s) => s.playerId);
}

/**
 * The team game's score (rules.md 13.3, question 52): the territories and armies of the members who are still in,
 * plus the bonus of every continent the team holds completely, once per team (question 74). Empty without teams.
 */
export function teamScoreboard(state: GameState): TeamScore[] {
  if (!state.teams) return [];
  const map = getMap(state.mapId);
  if (!map) return [];
  const rows = scoreboard(state);
  return TEAM_IDS.filter((id) => state.teams![id] !== undefined).map((teamId) => {
    const playerIds = [...(state.teams![teamId] ?? [])];
    const mine = rows.filter((r) => playerIds.includes(r.playerId));
    const bonus = heldContinents(map, state.territories, playerIds).reduce(
      (sum, c) => sum + c.bonus,
      0,
    );
    return {
      teamId,
      playerIds,
      points: mine.reduce((n, r) => n + r.territories, 0) + bonus,
      armies: mine.reduce((n, r) => n + r.armies, 0),
    };
  });
}
