import { getMap } from "@wagnis/engine/map-data";
import type { MapDefinition } from "@wagnis/engine/map-data";
import {
  coastSegments,
  continentBorders,
  linesPath,
  routeLines,
  segmentsPath,
} from "../lib/borders.js";
import type { Segment } from "../lib/borders.js";
import { shapeArea, shapePath, type Shape } from "../lib/geometry.js";
import type { HitSpec } from "../lib/hit.js";
import type { LabelSpec } from "../lib/label.js";
import { stackOrder } from "../lib/layers.js";
import type { Point, Size } from "../lib/viewport.js";
import type { Terrain } from "./decor.js";
import { testlandLayout } from "./testland.layout.js";
import { weltLayout } from "./welt.layout.js";
import type { SeaRoute } from "./welt.layout.js";
import { weltShapes } from "./welt.shapes.js";

export interface RenderTerritory {
  /** Center of the army counter. */
  anchor: Point;
  hit: HitSpec;
  label: LabelSpec;
}

/** A line between two anchors (a sea route, or on testland every border). */
export interface MapLink extends SeaRoute {
  dashed: boolean;
}

/** Everything the map component draws, whatever the map: outlines, anchors, tap circles, labels and lines. */
export interface RenderLayout {
  viewBox: Size;
  /** Territory names show from this zoom (relative to the fit scale) upwards. */
  labelZoom: number;
  territories: Record<string, RenderTerritory>;
  /** Outline rings per territory, main part first. */
  shapes: Record<string, Shape>;
  /** One SVG path per territory (all rings as sub-paths), built once at load. */
  paths: Record<string, string>;
  /** Atlas decoration of the world map (waves, projected grid, compass rose, tints, terrain patterns). */
  atlas: boolean;
  /** Static layers, built once at load (map units): all outlines, the coast, one path per continent and terrain. */
  allPath: string;
  coastPath: string;
  /** Sea routes and (testland) borders as path data between the anchors, dashed and solid kinds apart. */
  routeDashed: string;
  routeSolid: string;
  continentPaths: Record<string, string>;
  terrainPaths: Partial<Record<Terrain, string>>;
  /** Territory ids bottom to top: large areas first. */
  stack: string[];
  continentLabels: Record<string, Point>;
  links: MapLink[];
  continentBorders: Segment[];
}

export interface MapData {
  map: MapDefinition;
  layout: RenderLayout;
}

/** testland has no outlines: each territory is drawn as a round disc, borders as lines between the anchors. */
const TESTLAND_DISC = 40;
const TESTLAND_HIT = 44;

function disc(c: Point): Point[] {
  return Array.from({ length: 24 }, (_, i) => {
    const a = (i / 24) * 2 * Math.PI;
    return { x: c.x + TESTLAND_DISC * Math.cos(a), y: c.y + TESTLAND_DISC * Math.sin(a) };
  });
}

function build(
  map: MapDefinition,
  shapes: Record<string, Shape>,
  rest: Omit<
    RenderLayout,
    | "shapes"
    | "paths"
    | "stack"
    | "continentBorders"
    | "allPath"
    | "coastPath"
    | "routeDashed"
    | "routeSolid"
    | "continentPaths"
    | "terrainPaths"
  >,
  terrain: Record<string, Terrain> = {},
): RenderLayout {
  const continentOf = Object.fromEntries(map.territories.map((t) => [t.id, t.continentId]));
  const areas = Object.fromEntries(Object.entries(shapes).map(([id, r]) => [id, shapeArea(r)]));
  const paths = Object.fromEntries(
    Object.entries(shapes).map(([id, shape]) => [id, shapePath(shape)]),
  );
  const joined = (pick: (id: string) => boolean): string =>
    map.territories
      .filter((t) => pick(t.id))
      .map((t) => paths[t.id]!)
      .join("");
  const terrainPaths: Partial<Record<Terrain, string>> = {};
  for (const kind of new Set(Object.values(terrain))) {
    terrainPaths[kind] = joined((id) => terrain[id] === kind);
  }
  const routePath = (dashed: boolean): string =>
    linesPath(
      rest.links
        .filter((l) => l.dashed === dashed)
        .flatMap((l) =>
          routeLines(l, rest.territories[l.a]!.anchor, rest.territories[l.b]!.anchor),
        ),
    );
  return {
    ...rest,
    shapes,
    paths,
    routeDashed: routePath(true),
    routeSolid: routePath(false),
    allPath: joined(() => true),
    coastPath: segmentsPath(coastSegments(shapes)),
    continentPaths: Object.fromEntries(
      map.continents.map((c) => [c.id, joined((id) => continentOf[id] === c.id)]),
    ),
    terrainPaths,
    stack: stackOrder(areas),
    continentBorders: continentBorders(shapes, continentOf),
  };
}

function testlandData(map: MapDefinition): MapData {
  const territories: Record<string, RenderTerritory> = {};
  const shapes: Record<string, Shape> = {};
  for (const [id, p] of Object.entries(testlandLayout.positions)) {
    territories[id] = {
      anchor: p,
      hit: { r: TESTLAND_HIT },
      label: { dx: 0, dy: 24, align: "middle" },
    };
    shapes[id] = [disc(p)];
  }
  const links: MapLink[] = [];
  for (const t of map.territories) {
    for (const n of t.neighbors) if (t.id < n) links.push({ a: t.id, b: n, dashed: false });
  }
  return {
    map,
    layout: build(map, shapes, {
      viewBox: testlandLayout.viewBox,
      labelZoom: 0,
      atlas: false,
      territories,
      continentLabels: testlandLayout.continentLabels,
      links,
    }),
  };
}

function weltData(map: MapDefinition): MapData {
  return {
    map,
    layout: build(
      map,
      weltShapes,
      {
        viewBox: weltLayout.viewBox,
        labelZoom: weltLayout.labelZoom,
        atlas: true,
        territories: weltLayout.territories,
        continentLabels: weltLayout.continentLabels,
        links: weltLayout.seaRoutes.map((r) => ({ ...r, dashed: true })),
      },
      weltLayout.terrain,
    ),
  };
}

const builders: Record<string, (map: MapDefinition) => MapData> = {
  testland: testlandData,
  welt: weltData,
};

const cache = new Map<string, MapData>();

/** Chooses map data and layout by the mapId from the view. */
export function mapData(mapId: string): MapData | undefined {
  const cached = cache.get(mapId);
  if (cached) return cached;
  const map = getMap(mapId);
  const build = Object.hasOwn(builders, mapId) ? builders[mapId] : undefined;
  if (!map || !build) return undefined;
  const data = build(map);
  cache.set(mapId, data);
  return data;
}
