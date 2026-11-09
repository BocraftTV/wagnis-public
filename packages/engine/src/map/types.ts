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
}
