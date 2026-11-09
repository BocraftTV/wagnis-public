import type { ContinentId, TerritoryId } from "../types.js";

export interface TerritoryDef {
  id: TerritoryId;
  name: string;
  continentId: ContinentId;
  neighbors: TerritoryId[];
}

export interface ContinentDef {
  id: ContinentId;
  name: string;
  bonus: number;
}

export interface MapDefinition {
  id: string;
  name: string;
  territories: TerritoryDef[];
  continents: ContinentDef[];
  /** Neighbour pairs that are sea routes (a subset of the neighbours; plan 014 B, rules.md 2.1, 12). Empty on a map without. */
  seaRoutes: [TerritoryId, TerritoryId][];
}
