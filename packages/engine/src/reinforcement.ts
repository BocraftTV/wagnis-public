import type { MapDefinition } from "./map/types.js";
import { MOBILIZE_BONUS } from "./world-events.js";
import type { PlayerId, RuleConfig, TerritoryId, TerritoryState, WorldEvent } from "./types.js";

/**
 * max(min, floor(owned / divisor)) plus the bonus of every continent held completely. The event of the round
 * (plan 014 B) changes it: goldRush doubles the bonus of its continent, mobilize adds 3.
 */
export function calculateReinforcements(
  map: MapDefinition,
  rules: RuleConfig,
  territories: Record<TerritoryId, TerritoryState>,
  playerId: PlayerId,
  event: WorldEvent | null = null,
): number {
  const owned = map.territories.filter((t) => territories[t.id]?.ownerId === playerId);
  const base = Math.max(rules.minReinforcement, Math.floor(owned.length / rules.territoryDivisor));
  let bonus = 0;
  for (const continent of map.continents) {
    const members = map.territories.filter((t) => t.continentId === continent.id);
    if (members.length > 0 && members.every((t) => territories[t.id]?.ownerId === playerId)) {
      bonus +=
        event?.kind === "goldRush" && event.continentId === continent.id
          ? 2 * continent.bonus
          : continent.bonus;
    }
  }
  return base + bonus + (event?.kind === "mobilize" ? MOBILIZE_BONUS : 0);
}
