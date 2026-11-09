import type { MissionSet } from "../types.js";

/** Missions of the world map (docs/weltkarte-entwurf.md 6.1). Data only; the texts are made by the client. */
export const worldMissions: MissionSet = {
  missions: [
    {
      type: "conquerContinents",
      continentIds: ["asien", "europa"],
      extraContinents: 0,
    },
    {
      type: "conquerContinents",
      continentIds: ["asien", "afrika"],
      extraContinents: 0,
    },
    {
      type: "conquerContinents",
      continentIds: ["asien", "suedamerika", "ozeanien"],
      extraContinents: 0,
    },
    {
      type: "conquerContinents",
      continentIds: ["asien"],
      extraContinents: 2,
    },
    {
      type: "conquerContinents",
      continentIds: ["europa", "nordamerika", "ozeanien"],
      extraContinents: 0,
    },
    {
      type: "conquerContinents",
      continentIds: ["nordamerika", "afrika", "karibischer-bogen"],
      extraContinents: 0,
    },
    {
      type: "conquerContinents",
      continentIds: ["europa", "afrika"],
      extraContinents: 1,
    },
    {
      type: "conquerContinents",
      continentIds: ["afrika", "suedamerika", "vorderasien", "ozeanien"],
      extraContinents: 0,
    },
    {
      type: "conquerContinents",
      continentIds: ["nordamerika", "suedamerika", "karibischer-bogen"],
      extraContinents: 1,
    },
    {
      type: "conquerContinents",
      continentIds: ["europa", "suedamerika", "vorderasien"],
      extraContinents: 1,
    },
    {
      type: "conquerContinents",
      continentIds: ["karibischer-bogen", "vorderasien", "ozeanien", "suedamerika"],
      extraContinents: 0,
    },
    {
      type: "conquerContinents",
      continentIds: [],
      extraContinents: 4,
    },
    {
      type: "holdTerritories",
      count: 18,
      minArmies: 1,
    },
    {
      type: "holdTerritories",
      count: 15,
      minArmies: 2,
    },
    {
      type: "holdTerritories",
      count: 12,
      minArmies: 4,
    },
  ],
  fallback: {
    type: "holdTerritories",
    count: 16,
    minArmies: 2,
  },
};
