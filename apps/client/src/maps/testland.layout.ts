// Presentation only: where territories are drawn. Rules and adjacency live in the engine data.
export interface MapLayout {
  viewBox: { width: number; height: number };
  positions: Record<string, { x: number; y: number }>;
  continentLabels: Record<string, { x: number; y: number }>;
}

export const testlandLayout: MapLayout = {
  viewBox: { width: 800, height: 520 },
  positions: {
    eisenfurt: { x: 140, y: 110 },
    grauwacht: { x: 360, y: 110 },
    rabenhain: { x: 140, y: 270 },
    tannenfeld: { x: 360, y: 270 },
    salzmoor: { x: 580, y: 100 },
    dornental: { x: 480, y: 260 },
    kupferstadt: { x: 680, y: 260 },
    nebelkueste: { x: 580, y: 420 },
  },
  continentLabels: {
    nordreich: { x: 250, y: 370 },
    suedmark: { x: 700, y: 440 },
  },
};
