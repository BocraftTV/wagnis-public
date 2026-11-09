import type { ContinentDef, MapDefinition } from "./map/types.js";
import { MOBILIZE_BONUS } from "./world-events.js";
import type { PlayerId, RuleConfig, TerritoryId, TerritoryState, WorldEvent } from "./types.js";

/**
 * The continents whose territories all belong to one of `owners` (the player alone, or the whole team in a team game,
 * rules.md 13.2 and plan 015). In map order.
 */
export function heldContinents(
  map: MapDefinition,
  territories: Record<TerritoryId, TerritoryState>,
  owners: readonly PlayerId[],
): ContinentDef[] {
  return map.continents.filter((continent) => {
    const members = map.territories.filter((t) => t.continentId === continent.id);
    return (
      members.length > 0 &&
      members.every((t) => {
        const owner = territories[t.id]?.ownerId;
        return owner !== null && owner !== undefined && owners.includes(owner);
      })
    );
  });
}

/**
 * max(min, floor(owned / divisor)) plus the bonus of every continent held completely. The event of the round
 * (plan 014 B) changes it: goldRush doubles the bonus of its continent, mobilize adds 3. In a team game
 * `bonusOwners` are all members of the player's team: a continent the team holds completely gives every member its
 * full bonus, whoever holds how much of it (plan 015). The base still counts the player's own territories only.
 */
export function calculateReinforcements(
  map: MapDefinition,
  rules: RuleConfig,
  territories: Record<TerritoryId, TerritoryState>,
  playerId: PlayerId,
  event: WorldEvent | null = null,
  bonusOwners: readonly PlayerId[] = [playerId],
): number {
  const owned = map.territories.filter((t) => territories[t.id]?.ownerId === playerId);
  const base = Math.max(rules.minReinforcement, Math.floor(owned.length / rules.territoryDivisor));
  let bonus = 0;
  for (const continent of heldContinents(map, territories, bonusOwners)) {
    bonus +=
      event?.kind === "goldRush" && event.continentId === continent.id
        ? 2 * continent.bonus
        : continent.bonus;
  }
  return base + bonus + (event?.kind === "mobilize" ? MOBILIZE_BONUS : 0);
}
