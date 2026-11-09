// Layout of the world map: where the army counters, tap areas, labels and sea routes go. Presentation only; rules
// and adjacency live in the engine data. The outlines are in welt.shapes.ts, colors in styles/colors.css.
import type { Terrain } from "./decor.js";
import type { HitSpec } from "../lib/hit.js";
import type { LabelSpec } from "../lib/label.js";
import type { Point, Size } from "../lib/viewport.js";

export interface WorldTerritoryLayout {
  /** Center of the army counter, inside the outline. */
  anchor: Point;
  /** Invisible tap circle around the anchor (cap radius in map units). */
  hit: HitSpec;
  /** Name label, offsets in screen px relative to the anchor. */
  label: LabelSpec;
}

export interface SeaRoute {
  a: string;
  b: string;
  /** Bend points between the two anchors (map units). */
  via?: Point[];
  /** Route over the map edge: one stub from `a` to the point `a`, one from the point `b` to `b`. */
  wrap?: { a: Point; b: Point };
}

export interface WorldLayout {
  viewBox: Size;
  /** Names of territories show from this zoom (relative to the fit scale) upwards. */
  labelZoom: number;
  /** Counters of different territories are at least this far apart (map units): 47 * 0.728 px/unit = 34.2 px, a counter (32 px) plus 2 px at the fit scale in portrait. */
  minAnchorDistance: number;
  territories: Record<string, WorldTerritoryLayout>;
  /** Continent name labels (always visible), centered on the point. */
  continentLabels: Record<string, Point>;
  /** The 16 sea routes, drawn dashed. Presentation list; the engine does not tell land and sea apart. */
  seaRoutes: SeaRoute[];
  /** Terrain pattern over the owner color (decoration only; carries no information). */
  terrain: Record<string, Terrain>;
  /** Territories whose tap circle stays under 44 px at the fit scale, with the reason. */
  hitExceptions: Record<string, string>;
  /** Territory pairs without a land border whose outlines may touch or come closer than the minimum gap, with the reason. */
  touchExceptions: Record<string, string>;
}

const below: LabelSpec = { dx: 0, dy: 20, align: "middle" };

function terr(x: number, y: number, r: number, label: LabelSpec = below): WorldTerritoryLayout {
  return { anchor: { x, y }, hit: { r }, label };
}

export const weltLayout: WorldLayout = {
  viewBox: { width: 1000, height: 540 },
  labelZoom: 1.6,
  minAnchorDistance: 47,
  territories: {
    nordwestland: terr(44, 67, 40),
    hudsonland: terr(175, 96, 40),
    groenland: terr(359, 35, 40),
    pazifikkueste: terr(146, 162, 40),
    praerieland: terr(194, 160, 40, { dx: 0, dy: -34, align: "middle" }),
    atlantikkueste: terr(245, 176, 40),
    mexiko: terr(182, 220, 40),
    landenge: terr(224, 273, 40),
    antillen: terr(260, 239, 40, { dx: 0, dy: -35, align: "middle" }),
    orinokoland: terr(270, 312, 40, { dx: 22, dy: -7, align: "start" }),
    amazonien: terr(312, 346, 40),
    nordostkueste: terr(365, 357, 40, { dx: 0, dy: -34, align: "middle" }),
    hochanden: terr(269, 374, 40),
    suedkegel: terr(295, 430, 40),
    nebelinseln: terr(427, 107, 40),
    nordlande: terr(488, 50, 40),
    atlantikmark: terr(431, 160, 40),
    mittelland: terr(500, 111, 40, { dx: 0, dy: -35, align: "middle" }),
    adriaraum: terr(534, 154, 40),
    osteuropa: terr(601, 84, 40),
    atlasland: terr(449, 224, 40),
    nilland: terr(553, 268, 40),
    sahelguertel: terr(455, 284, 40),
    kongobecken: terr(527, 326, 40),
    ostafrika: terr(576, 313, 40, { dx: 22, dy: -14, align: "start" }),
    suedspitze: terr(540, 400, 40),
    anatolien: terr(568, 197, 40),
    zweistromland: terr(617, 219, 40, { dx: 20, dy: -76, align: "end" }),
    wuestenhalbinsel: terr(611, 273, 40, { dx: 0, dy: -34, align: "middle" }),
    iranhochland: terr(670, 210, 40, { dx: 0, dy: -50, align: "middle" }),
    westsibirien: terr(706, 77, 40),
    ostsibirien: terr(781, 80, 40),
    turan: terr(684, 137, 40),
    mongolei: terr(755, 145, 40, { dx: 0, dy: -35, align: "middle" }),
    hochasien: terr(718, 179, 40),
    kernland: terr(774, 192, 40, { dx: 18, dy: 18, align: "start" }),
    subkontinent: terr(687, 261, 40),
    hinterindien: terr(749, 252, 40, { dx: 0, dy: -34, align: "middle" }),
    japan: terr(859, 183, 40, { dx: 0, dy: -34, align: "middle" }),
    sundainseln: terr(780, 330, 40),
    neuguinea: terr(875, 349, 40),
    suedland: terr(858, 422, 40),
  },
  continentLabels: {
    nordamerika: { x: 176, y: 58 },
    "karibischer-bogen": { x: 152, y: 318 },
    suedamerika: { x: 380, y: 394 },
    europa: { x: 488, y: 14 },
    afrika: { x: 528, y: 362 },
    vorderasien: { x: 684, y: 366 },
    asien: { x: 844, y: 146 },
    ozeanien: { x: 856, y: 386 },
  },
  seaRoutes: [
    { a: "nordwestland", b: "ostsibirien", wrap: { a: { x: 0, y: 58 }, b: { x: 1000, y: 58 } } },
    { a: "hudsonland", b: "groenland" },
    { a: "groenland", b: "nebelinseln" },
    { a: "atlantikkueste", b: "antillen" },
    { a: "antillen", b: "orinokoland" },
    { a: "nordostkueste", b: "sahelguertel" },
    { a: "nebelinseln", b: "nordlande" },
    { a: "nebelinseln", b: "atlantikmark" },
    { a: "atlantikmark", b: "atlasland" },
    { a: "wuestenhalbinsel", b: "ostafrika" },
    { a: "ostsibirien", b: "japan", via: [{ x: 845, y: 135 }] },
    { a: "kernland", b: "japan" },
    { a: "hinterindien", b: "sundainseln" },
    { a: "sundainseln", b: "neuguinea" },
    { a: "neuguinea", b: "suedland" },
    { a: "sundainseln", b: "suedland" },
  ],
  terrain: {
    pazifikkueste: "mountain",
    hochanden: "mountain",
    hochasien: "mountain",
    iranhochland: "mountain",
    atlasland: "desert",
    nilland: "desert",
    wuestenhalbinsel: "desert",
    amazonien: "forest",
    kongobecken: "forest",
    hinterindien: "forest",
    sundainseln: "forest",
  },
  hitExceptions: {},
  touchExceptions: {},
};
