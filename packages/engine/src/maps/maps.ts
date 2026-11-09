import type { MapDefinition } from "../map/types.js";
import { testland } from "./testland.map.js";
import { welt } from "./welt.map.js";

/** Pure map data only (no missions, no rules): this is what the client may import. */
export const maps: Record<string, MapDefinition> = { [testland.id]: testland, [welt.id]: welt };

export function getMap(id: string): MapDefinition | undefined {
  return Object.hasOwn(maps, id) ? maps[id] : undefined;
}

export { testland, welt };
