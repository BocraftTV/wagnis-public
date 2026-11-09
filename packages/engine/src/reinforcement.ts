import type { MapDefinition } from "./map/types.js";
import type { PlayerId, RuleConfig, TerritoryId, TerritoryState } from "./types.js";

/** max(min, floor(owned / divisor)) plus the bonus of every continent held completely. */
export function calculateReinforcements(
  map: MapDefinition,
  rules: RuleConfig,
  territories: Record<TerritoryId, TerritoryState>,
  playerId: PlayerId,
): number {
  const owned = map.territories.filter((t) => territories[t.id]?.ownerId === playerId);
  const base = Math.max(rules.minReinforcement, Math.floor(owned.length / rules.territoryDivisor));
  let bonus = 0;
  for (const continent of map.continents) {
    const members = map.territories.filter((t) => t.continentId === continent.id);
    if (members.length > 0 && members.every((t) => territories[t.id]?.ownerId === playerId)) {
      bonus += continent.bonus;
    }
  }
  return base + bonus;
}
