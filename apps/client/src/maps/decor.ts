// Decoration geometry of the atlas look as plain data: grid, wave tile, compass rose, frame and pattern tiles.
// Pure functions without colors (colors come from styles/colors.css). Used by the map components (MapBackdrop,
// MapDefs) and by scripts/render-map.mjs, so the static drawing and the app show the same decoration.
import {
  LAT_BOTTOM,
  LAT_TOP,
  LON_LEFT,
  LON_RIGHT,
  MAP_HEIGHT,
  MAP_WIDTH,
  project,
} from "../geo/project.js";

const f = (n: number): string => String(Math.round(n * 100) / 100);

/** One path with a meridian every 30 degrees and a parallel every 20 degrees (straight lines, lens-independent). */
export function gridPath(): string {
  const parts: string[] = [];
  for (let lon = -150; lon <= LON_RIGHT; lon += 30) {
    if (lon <= LON_LEFT) continue;
    parts.push(`M${f(project(lon, 0)[0])} 0V${MAP_HEIGHT}`);
  }
  for (let lat = 60; lat >= LAT_BOTTOM; lat -= 20) {
    if (lat >= LAT_TOP) continue;
    parts.push(`M0 ${f(project(0, lat)[1])}H${MAP_WIDTH}`);
  }
  return parts.join("");
}

/** Grid of the plain look (testland): a line every `step` units. */
export function plainGridPath(width: number, height: number, step = 100): string {
  const parts: string[] = [];
  for (let x = step; x < width; x += step) parts.push(`M${x} 0V${height}`);
  for (let y = step; y < height; y += step) parts.push(`M0 ${y}H${width}`);
  return parts.join("");
}

/** Wave tile 48 x 24: three wavy lines, seamless horizontally. Stroke only. */
export const WAVE_TILE = {
  width: 48,
  height: 24,
  d: "M0 5q6-4 12 0t12 0t12 0t12 0M0 13q6-4 12 0t12 0t12 0t12 0M0 21q6-4 12 0t12 0t12 0t12 0",
} as const;

export interface Rose {
  center: { x: number; y: number };
  radius: number;
  /** Lit and shaded halves of the eight spikes (fill). */
  light: string;
  dark: string;
  /** Radii of the two thin rings (stroke). */
  rings: [number, number];
  /** Position of the "N" mark. */
  north: { x: number; y: number };
}

/** Compass rose with 8 spikes (4 long, 4 short), each split into a lit and a shaded half. */
export function compassRose(cx: number, cy: number, r: number): Rose {
  const light: string[] = [];
  const dark: string[] = [];
  for (let i = 0; i < 8; i++) {
    const long = i % 2 === 0;
    const len = long ? r : r * 0.62;
    const half = long ? 0.16 : 0.13;
    const a = (i * Math.PI) / 4 - Math.PI / 2;
    const tip = [cx + Math.cos(a) * len, cy + Math.sin(a) * len];
    const l = [
      cx + Math.cos(a - Math.PI / 2) * r * half,
      cy + Math.sin(a - Math.PI / 2) * r * half,
    ];
    const rr = [
      cx + Math.cos(a + Math.PI / 2) * r * half,
      cy + Math.sin(a + Math.PI / 2) * r * half,
    ];
    light.push(`M${f(cx)} ${f(cy)}L${f(l[0]!)} ${f(l[1]!)}L${f(tip[0]!)} ${f(tip[1]!)}Z`);
    dark.push(`M${f(cx)} ${f(cy)}L${f(rr[0]!)} ${f(rr[1]!)}L${f(tip[0]!)} ${f(tip[1]!)}Z`);
  }
  return {
    center: { x: cx, y: cy },
    radius: r,
    light: light.join(""),
    dark: dark.join(""),
    rings: [r * 0.72, r * 0.8],
    north: { x: cx, y: cy - r - 9 },
  };
}

/** Centre and radius of the compass rose in the open South Pacific (checked against the territories in tests). */
export const ROSE = compassRose(110, 440, 60);

export interface Frame {
  /** Rectangles as [x, y, width, height]. */
  outer: [number, number, number, number];
  inner: [number, number, number, number];
  /** Small diamonds in the four corners (fill). */
  corners: string;
}

/** Map units per screen px at the smallest iPad's fit view (portrait): the frame spacing is fixed in map units. */
export const FRAME_UNIT = 1 / 0.728;

/** Double neatline at the edge of the map; `unit` is one screen px in map units (line spacing and corner marks). */
export function frame(unit: number, width = MAP_WIDTH, height = MAP_HEIGHT): Frame {
  const gap = 4 * unit;
  const d = 5 * unit;
  const corner = (x: number, y: number): string =>
    `M${f(x - d)} ${f(y)}L${f(x)} ${f(y - d)}L${f(x + d)} ${f(y)}L${f(x)} ${f(y + d)}Z`;
  const o = unit; // outer line is 2 px wide and sits half inside the map
  return {
    outer: [o, o, width - 2 * o, height - 2 * o],
    inner: [o + gap, o + gap, width - 2 * (o + gap), height - 2 * (o + gap)],
    corners: [
      corner(o + gap, o + gap),
      corner(width - o - gap, o + gap),
      corner(o + gap, height - o - gap),
      corner(width - o - gap, height - o - gap),
    ].join(""),
  };
}

export interface PatternTile {
  size: number;
  d: string;
  mode: "stroke" | "fill";
}

const dot = (x: number, y: number, r: number): string =>
  `M${f(x - r)} ${f(y)}a${r} ${r} 0 1 0 ${f(2 * r)} 0a${r} ${r} 0 1 0 ${f(-2 * r)} 0Z`;

/** Terrain patterns: tiles of at most 14 units with at most 12 elements. They carry no information. */
export type Terrain = "mountain" | "desert" | "forest";

export const PATTERNS: Record<Terrain, PatternTile> = {
  mountain: { size: 12, mode: "stroke", d: "M1 10L4 5L7 10M6 6L9 2L11 6" },
  desert: { size: 10, mode: "fill", d: dot(2, 2, 0.7) + dot(7, 5, 0.7) + dot(3, 8, 0.7) },
  forest: { size: 14, mode: "fill", d: "M4 7L1.5 11H6.5ZM11 3L8.5 7H13.5ZM10 13L8 10H12Z" },
};
