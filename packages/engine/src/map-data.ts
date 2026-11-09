// Pure data entry point: map definitions only, no rule logic, no missions, no rule values. The client imports this.
export type { MapDefinition, TerritoryDef, ContinentDef } from "./map/types.js";
export { getMap, testland, welt } from "./maps/maps.js";
