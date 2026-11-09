import type { MissionSet, RuleConfig } from "../types.js";
import { testlandRules } from "../rules/testland.rules.js";
import { weltRules } from "../rules/welt.rules.js";
import { getMap, maps, testland, welt } from "./maps.js";
import { testlandMissions } from "./testland.missions.js";
import { worldMissions } from "./welt.missions.js";

const missionSets: Record<string, MissionSet> = {
  [testland.id]: testlandMissions,
  [welt.id]: worldMissions,
};

export { getMap };

const ruleSets: Record<string, RuleConfig> = {
  [testland.id]: testlandRules,
  [welt.id]: weltRules,
};

/** IDs of all registered maps (each has missions and rules). */
export const mapIds: readonly string[] = Object.keys(maps);

/** Mission list of a map (data only), looked up like `getMap`. */
export function getMissionSet(mapId: string): MissionSet | undefined {
  return Object.hasOwn(missionSets, mapId) ? missionSets[mapId] : undefined;
}

/** Rule values of a map (data only), looked up like `getMap`. */
export function getRules(mapId: string): RuleConfig | undefined {
  return Object.hasOwn(ruleSets, mapId) ? ruleSets[mapId] : undefined;
}

export { testland, testlandMissions, welt, worldMissions };
