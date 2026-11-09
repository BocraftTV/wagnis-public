// Assignment of the Natural Earth countries to the 42 territories of the world map (plan 006, section 3.3 to 3.6).
// Own choice after the division in docs/weltkarte-entwurf.md and the real geography (decision F1 in plan 006,
// section 10); no other game's division. A cut line splits one country between several territories; its position
// follows landscape and the neighbourhoods of the draft only. Pipeline only: the app never imports from geo/.
import type { Lens } from "./lens.js";
import type { CountryRule, Target } from "./assign.js";
import type { Pt } from "./project.js";

/** Smallest distance between outlines of territories that must not touch (map units). */
export const GAP_MIN = 1;
/** A touch without a land border longer than this is not notched but reported (question F2 in plan 006). */
export const KERBE_MAX = 12;
/** Data budget (plan 006, section 3.4): sum of ring lengths, per territory, per ring, number of rings. */
export const BUDGET = { vertices: 3000, perTerritory: 260, perRing: 40, rings: 70 } as const;
/** Rings (islands) smaller than this (map units squared, after the lens) are dropped unless listed in `KEEP_ISLANDS`. */
export const MIN_ISLAND_AREA = 6;
/** Higher minimum per territory where the source has many small islands (Arctic archipelagos, the Philippines). */
export const ISLAND_MIN_AREA: Readonly<Record<string, number>> = {
  nordwestland: 100,
  hudsonland: 150,
  pazifikkueste: 30,
  westsibirien: 100,
  ostsibirien: 90,
  nordlande: 30,
  adriaraum: 40,
  sundainseln: 30,
};
/** Islands that stay however small: the ring of `id` nearest to the point (degrees). */
export const KEEP_ISLANDS: readonly { id: string; at: Pt }[] = [
  { id: "hudsonland", at: [-56, 48.5] }, // Newfoundland
];

const cut = (from: Pt, to: Pt, left: Target, right: Target): Target => ({
  cut: [from, to],
  left,
  right,
});
const meridian = (lon: number, west: Target, east: Target): Target =>
  cut([lon, 0], [lon, 1], west, east);
/** Parallel: `north` is the side of higher latitudes. */
const parallel = (lat: number, north: Target, south: Target): Target =>
  cut([0, lat], [1, lat], north, south);

/** Russia: Ural line at 60 E, Yenisei-ish line at 95 E (the Altai tip ends at 90.7 E). */
const russia: Target = meridian(60, "osteuropa", meridian(95, "westsibirien", "ostsibirien"));

/** Canada: Pacific coast (British Columbia), north-west (Yukon, west of the Mackenzie) and the rest. */
const canada: Target = parallel(
  60,
  cut([-120, 60], [-129, 72], "nordwestland", "hudsonland"),
  meridian(-120, "pazifikkueste", cut([-114.1, 49], [-120, 53.8], "pazifikkueste", "hudsonland")),
);

/** USA: west of the Rocky Mountains, the Mississippi side, and the east including the south-east. */
const usa: Target = cut(
  [-113, 49],
  [-107, 31.5],
  cut([-87.5, 45.5], [-93.5, 29.5], "atlantikkueste", "praerieland"),
  "pazifikkueste",
);

/** China: Hochasien in the west, the Inner Mongolia band in the north, the rest is the core land. */
const china: Target = cut(
  [96.5, 45],
  [98.05, 28.25],
  cut([100, 39.5], [118, 42], cut([118, 42], [124, 53], "mongolei", "kernland"), "kernland"),
  // West of the line the strip south of 27.2 N (Dehong, Yunnan) belongs to the core land, not to Hochasien.
  parallel(27.2, "hochasien", "kernland"),
);

/** Brazil: the Amazon basin and the west against the east coast, the north-east and the south. */
const brazil: Target = parallel(
  -26,
  cut([-46, -1], [-54, -26], "nordostkueste", "amazonien"),
  "nordostkueste",
);

const west = (lonMin: number, latMin: number, lonMax: number, latMax: number) =>
  [lonMin, latMin, lonMax, latMax] as const;

export const COUNTRIES: Readonly<Record<string, CountryRule | string | null>> = {
  // Nordamerika
  CAN: {
    all: canada,
    rings: [
      { in: west(-135, 47, -122, 56), to: "pazifikkueste" },
      { in: west(-127, 70, -113, 75), to: "nordwestland" },
    ],
  },
  USA: {
    all: usa,
    rings: [
      { in: west(-161, 18, -154, 23), to: null },
      { in: west(-175, 62, -168, 65), to: null },
      { in: west(-170, 50, -128, 72), to: "nordwestland" },
    ],
  },
  GRL: "groenland",
  // Karibischer Bogen
  MEX: "mexiko",
  BLZ: "landenge",
  GTM: "landenge",
  SLV: "landenge",
  HND: "landenge",
  NIC: "landenge",
  CRI: "landenge",
  PAN: "landenge",
  CUB: "antillen",
  JAM: "antillen",
  HTI: "antillen",
  DOM: "antillen",
  PRI: "antillen",
  BHS: "antillen",
  TTO: "antillen",
  COL: "orinokoland",
  VEN: "orinokoland",
  GUY: "orinokoland",
  SUR: "orinokoland",
  // Suedamerika
  BRA: { all: brazil },
  ECU: "hochanden",
  PER: "hochanden",
  BOL: "hochanden",
  CHL: "suedkegel",
  ARG: "suedkegel",
  URY: "suedkegel",
  PRY: "suedkegel",
  FLK: null,
  // Europa
  GBR: "nebelinseln",
  IRL: "nebelinseln",
  ISL: "nebelinseln",
  NOR: { all: "nordlande", rings: [{ in: west(5, 74, 35, 82), to: null }] },
  SWE: "nordlande",
  FIN: "nordlande",
  DNK: "nordlande",
  ESP: "atlantikmark",
  PRT: "atlantikmark",
  FRA: { all: "atlantikmark", rings: [{ in: west(-60, 0, -45, 8), to: "orinokoland" }] },
  DEU: "mittelland",
  NLD: "mittelland",
  BEL: "mittelland",
  LUX: "mittelland",
  CHE: "mittelland",
  AUT: "mittelland",
  POL: "mittelland",
  CZE: "mittelland",
  SVK: "mittelland",
  HUN: "mittelland",
  ITA: "adriaraum",
  SVN: "adriaraum",
  HRV: "adriaraum",
  BIH: "adriaraum",
  SRB: "adriaraum",
  MNE: "adriaraum",
  MKD: "adriaraum",
  ALB: "adriaraum",
  GRC: "adriaraum",
  ROU: "adriaraum",
  BGR: "adriaraum",
  KOS: "adriaraum",
  UKR: "osteuropa",
  BLR: "osteuropa",
  LTU: "osteuropa",
  LVA: "osteuropa",
  EST: "osteuropa",
  MDA: "osteuropa",
  RUS: {
    all: russia,
    shift360: true,
    rings: [{ in: west(45, 70, 70, 78), to: null }],
  },
  // Afrika
  MAR: "atlasland",
  SAH: "atlasland",
  DZA: "atlasland",
  TUN: "atlasland",
  EGY: "nilland",
  LBY: "nilland",
  SDN: "nilland",
  SEN: "sahelguertel",
  GMB: "sahelguertel",
  GNB: "sahelguertel",
  GIN: "sahelguertel",
  SLE: "sahelguertel",
  LBR: "sahelguertel",
  CIV: "sahelguertel",
  GHA: "sahelguertel",
  TGO: "sahelguertel",
  BEN: "sahelguertel",
  NGA: "sahelguertel",
  MLI: "sahelguertel",
  NER: "sahelguertel",
  TCD: "sahelguertel",
  BFA: "sahelguertel",
  MRT: "sahelguertel",
  CMR: "kongobecken",
  GNQ: "kongobecken",
  GAB: "kongobecken",
  COG: "kongobecken",
  COD: "kongobecken",
  CAF: "kongobecken",
  AGO: {
    all: parallel(-12, "kongobecken", "suedspitze"),
    rings: [{ in: west(11, -6, 14, -4), to: "kongobecken" }],
  },
  ETH: "ostafrika",
  SOM: "ostafrika",
  SOL: "ostafrika",
  KEN: "ostafrika",
  UGA: "ostafrika",
  TZA: "ostafrika",
  SDS: "ostafrika",
  ERI: "ostafrika",
  DJI: "ostafrika",
  RWA: "ostafrika",
  BDI: "ostafrika",
  ZAF: "suedspitze",
  LSO: null, // enclave inside South Africa, the same territory: the hole of South Africa is skipped (assign.ts)
  SWZ: "suedspitze",
  NAM: "suedspitze",
  BWA: "suedspitze",
  ZMB: "suedspitze",
  ZWE: "suedspitze",
  MOZ: "suedspitze",
  MWI: "suedspitze",
  MDG: "suedspitze",
  // Vorderasien
  TUR: "anatolien",
  GEO: "anatolien",
  ARM: "anatolien",
  AZE: "anatolien",
  SYR: "zweistromland",
  IRQ: "zweistromland",
  LBN: "zweistromland",
  ISR: "zweistromland",
  PSX: "zweistromland",
  JOR: "zweistromland",
  SAU: "wuestenhalbinsel",
  YEM: "wuestenhalbinsel",
  OMN: "wuestenhalbinsel",
  ARE: "wuestenhalbinsel",
  QAT: "wuestenhalbinsel",
  KWT: "wuestenhalbinsel",
  IRN: "iranhochland",
  AFG: "iranhochland",
  // Asien
  KAZ: "turan",
  UZB: "turan",
  TKM: "turan",
  KGZ: "turan",
  TJK: "turan",
  MNG: "mongolei",
  CHN: { all: china },
  NPL: "hochasien",
  BTN: "hochasien",
  PRK: "kernland",
  KOR: "kernland",
  TWN: "kernland",
  IND: "subkontinent",
  PAK: "subkontinent",
  BGD: "subkontinent",
  LKA: "subkontinent",
  MMR: "hinterindien",
  THA: "hinterindien",
  LAO: "hinterindien",
  KHM: "hinterindien",
  VNM: "hinterindien",
  JPN: "japan",
  // Ozeanien
  MYS: { all: "sundainseln", rings: [{ in: west(99, 0, 105, 8), to: "hinterindien" }] },
  IDN: { all: "sundainseln", rings: [{ in: west(133, -11, 142, 1), to: "neuguinea" }] },
  BRN: "sundainseln",
  TLS: "sundainseln",
  PHL: "sundainseln",
  PNG: "neuguinea",
  SLB: "neuguinea",
  VUT: "neuguinea",
  NCL: "neuguinea",
  FJI: { all: "neuguinea", shift360: true },
  AUS: "suedland",
  NZL: "suedland",
  // Dropped by decision F1 (no territory): Antarctica and its lands, Cyprus.
  ATA: null,
  ATF: null,
  CYP: null,
  CYN: null,
};

/**
 * Hand-made island band for the Lesser Antilles (the 1:110 source has none, plan 006, section 3.8, step 2): three
 * stylised islands in degrees, deliberately larger than the real ones so that they stay visible.
 */
export const EXTRA_RINGS: Readonly<Record<string, readonly (readonly Pt[])[]>> = {
  antillen: [
    [
      [-61.9, 16.25],
      [-61.5, 16.55],
      [-61.1, 16.3],
      [-61.2, 15.95],
      [-61.65, 15.9],
    ],
    [
      [-61.45, 14.8],
      [-61.0, 14.95],
      [-60.65, 14.6],
      [-60.85, 14.35],
      [-61.3, 14.4],
    ],
    [
      [-60.55, 13.3],
      [-60.1, 13.5],
      [-59.7, 13.25],
      [-59.9, 12.95],
      [-60.35, 12.9],
    ],
  ],
};

/**
 * Lenses (plan 006, section 3.4; centre and radius in map units): Europe with the Levant (factor 1.9, below the fold
 * limit of 2.25), the Caribbean, South-East Asia and Japan. They make the small territories larger than their counter.
 */
export const LENSES: readonly Lens[] = [
  { center: [545, 145], radius: 170, factor: 1.9 },
  { center: [265, 250], radius: 90, factor: 1.5 },
  { center: [805, 305], radius: 110, factor: 1.5 },
  { center: [855, 180], radius: 55, factor: 1.5 },
];
