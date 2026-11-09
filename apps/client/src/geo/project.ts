// Projection of the world map pipeline: equirectangular, vertically stretched, onto the viewBox 1000 x 540.
// Used by the pipeline (scripts and tests); the app imports only this file (for the grid in maps/decor.ts).
export type Pt = readonly [number, number];
export type Ring = readonly Pt[];

export const MAP_WIDTH = 1000;
export const MAP_HEIGHT = 540;
/** Window in degrees: -170..190 east (Chukotka is shifted by 360), 83 N .. 56 S. */
export const LON_LEFT = -170;
export const LON_RIGHT = 190;
export const LAT_TOP = 83;
export const LAT_BOTTOM = -56;

export function project(lon: number, lat: number): Pt {
  const x = ((lon - LON_LEFT) / (LON_RIGHT - LON_LEFT)) * MAP_WIDTH;
  const y = ((LAT_TOP - lat) / (LAT_TOP - LAT_BOTTOM)) * MAP_HEIGHT;
  return [x, y];
}

/** Rounds degrees to the 0.01 degree grid so that borders of neighbouring countries meet in identical nodes. */
export function gridKey(lon: number, lat: number): string {
  return `${Math.round(lon * 100)},${Math.round(lat * 100)}`;
}
