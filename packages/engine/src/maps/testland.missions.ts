import type { MissionSet } from "../types.js";

/**
 * Missions of testland (invented; balance does not matter here). Every one needs at least 4 own territories,
 * so none is met at the start, not even for player 1 of a 2-player game with a neutral owner (at most 3
 * territories each). Data only; the texts are made by the client.
 */
export const testlandMissions: MissionSet = {
  missions: [
    { type: "conquerContinents", continentIds: ["nordreich"], extraContinents: 0 },
    { type: "conquerContinents", continentIds: ["suedmark"], extraContinents: 0 },
    { type: "conquerContinents", continentIds: [], extraContinents: 1 },
    { type: "conquerContinents", continentIds: ["nordreich"], extraContinents: 1 },
    { type: "holdTerritories", count: 5, minArmies: 2 },
    { type: "holdTerritories", count: 4, minArmies: 3 },
  ],
  fallback: { type: "holdTerritories", count: 6, minArmies: 2 },
};
