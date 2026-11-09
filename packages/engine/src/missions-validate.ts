import type { MapDefinition } from "./map/types.js";
import type { Mission, MissionSet } from "./types.js";

export type MissionsValidation = { ok: true } | { ok: false; errors: string[] };

const isCount = (n: unknown, min: number): n is number =>
  Number.isInteger(n) && (n as number) >= min;

/** Problems of one map mission (never `eliminatePlayer`; those come from the players). */
function checkMission(map: MapDefinition, m: Mission, label: string, errors: string[]): void {
  if (m.type === "holdTerritories") {
    if (!isCount(m.count, 1) || m.count > map.territories.length)
      errors.push(`${label}: bad count`);
    if (!isCount(m.minArmies, 1)) errors.push(`${label}: bad minArmies`);
  } else if (m.type === "conquerContinents") {
    const known = new Set(map.continents.map((c) => c.id));
    const ids = new Set(m.continentIds);
    if (ids.size !== m.continentIds.length) errors.push(`${label}: duplicate continent`);
    if (m.continentIds.some((id) => !known.has(id))) errors.push(`${label}: unknown continent`);
    if (!isCount(m.extraContinents, 0)) errors.push(`${label}: bad extraContinents`);
    else if (m.continentIds.length + m.extraContinents < 1) errors.push(`${label}: no continent`);
    else if (m.continentIds.length + m.extraContinents > map.continents.length) {
      errors.push(`${label}: more continents than the map has`);
    }
  } else if (m.type === "connectedRealm" || m.type === "blitzkrieg") {
    if (!isCount(m.count, 1) || m.count > map.territories.length)
      errors.push(`${label}: bad count`);
  } else {
    errors.push(`${label}: eliminatePlayer is not allowed in the map list`);
  }
}

/** Checks a map's mission list (rules.md 4); `createGame` answers a failure with `INVALID_MISSIONS`. */
export function validateMissions(map: MapDefinition, set: MissionSet): MissionsValidation {
  const errors: string[] = [];
  if (set.missions.length < 2) errors.push("fewer than 2 missions");
  set.missions.forEach((m, i) => checkMission(map, m, `mission ${i}`, errors));
  const seen = new Set<string>();
  for (const m of set.missions) {
    const key = JSON.stringify(m);
    if (seen.has(key)) errors.push("duplicate mission");
    seen.add(key);
  }
  if (set.fallback?.type !== "holdTerritories") errors.push("fallback must be holdTerritories");
  else checkMission(map, set.fallback, "fallback", errors);
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}
