import type { MapDefinition } from "../map/types.js";

/** Small invented map used for development and tests. */
export const testland: MapDefinition = {
  id: "testland",
  name: "Testland",
  continents: [
    { id: "nordreich", name: "Nordreich", bonus: 2 },
    { id: "suedmark", name: "Südmark", bonus: 3 },
  ],
  territories: [
    {
      id: "eisenfurt",
      name: "Eisenfurt",
      continentId: "nordreich",
      neighbors: ["rabenhain", "grauwacht"],
    },
    {
      id: "rabenhain",
      name: "Rabenhain",
      continentId: "nordreich",
      neighbors: ["eisenfurt", "tannenfeld"],
    },
    {
      id: "grauwacht",
      name: "Grauwacht",
      continentId: "nordreich",
      neighbors: ["eisenfurt", "tannenfeld", "salzmoor"],
    },
    {
      id: "tannenfeld",
      name: "Tannenfeld",
      continentId: "nordreich",
      neighbors: ["rabenhain", "grauwacht"],
    },
    {
      id: "salzmoor",
      name: "Salzmoor",
      continentId: "suedmark",
      neighbors: ["grauwacht", "dornental", "kupferstadt"],
    },
    {
      id: "dornental",
      name: "Dornental",
      continentId: "suedmark",
      neighbors: ["salzmoor", "nebelkueste"],
    },
    {
      id: "kupferstadt",
      name: "Kupferstadt",
      continentId: "suedmark",
      neighbors: ["salzmoor", "nebelkueste"],
    },
    {
      id: "nebelkueste",
      name: "Nebelküste",
      continentId: "suedmark",
      neighbors: ["dornental", "kupferstadt"],
    },
  ],
};
