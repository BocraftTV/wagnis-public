// Builds the outlines of the world map (apps/client/src/maps/welt.shapes.ts) from the Natural Earth data (plan 006).
// Needs the raw data: node scripts/fetch-natural-earth.mjs (it stays in .geo-tmp/, never committed).
//
//   node scripts/build-world-shapes.mjs                 build and print the report, write nothing
//   node scripts/build-world-shapes.mjs --write         ... and write welt.shapes.ts
//   node scripts/build-world-shapes.mjs --check         check the committed outlines (no raw data needed)
//   options: --eps 0.8 (simplification tolerance in map units)
//
// The pipeline functions live in apps/client/src/geo/ (tested); the assignment of countries to territories in
// geo/welt.regions.ts. Exit code 1 when the checks find a problem.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { register } from "tsx/esm/api";

const root = new URL("../", import.meta.url);
const path = (rel) => fileURLToPath(new URL(rel, root));
const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const option = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback;
};

register();
const load = (rel) => import(pathToFileURL(path(rel)).href);
const { getMap } = await load("packages/engine/src/map-data.ts");
const reg = await load("apps/client/src/geo/welt.regions.ts");
const { buildWorld } = await load("apps/client/src/geo/world.ts");
const { verifyWorld } = await load("apps/client/src/geo/check.ts");
const { shapesModule } = await load("apps/client/src/geo/emit.ts");
const { suggestAnchors } = await load("apps/client/src/geo/anchors.ts");
const { weltLayout } = await load("apps/client/src/maps/welt.layout.ts");
const { weltShapes } = await load("apps/client/src/maps/welt.shapes.ts");
const { fitScale } = await load("apps/client/src/lib/viewport.ts");

const map = getMap("welt");
const ids = map.territories.map((t) => t.id);
const pairKey = (a, b) => (a < b ? `${a}|${b}` : `${b}|${a}`);
const sea = new Set(weltLayout.seaRoutes.map((r) => pairKey(r.a, r.b)));
const landPairs = new Set();
for (const t of map.territories)
  for (const n of t.neighbors) if (!sea.has(pairKey(t.id, n))) landPairs.add(pairKey(t.id, n));

/** The committed outlines as tuples, whether the file holds one ring per territory or a list of rings. */
function committed() {
  const out = {};
  for (const [id, shape] of Object.entries(weltShapes)) {
    const rings = shape.length > 0 && "x" in shape[0] ? [shape] : shape;
    out[id] = rings.map((ring) => ring.map((p) => [p.x, p.y]));
  }
  return out;
}

const checks = () => ({
  landPairs,
  touchExceptions: new Set(Object.keys(weltLayout.touchExceptions ?? {})),
  gap: reg.GAP_MIN,
  budget: reg.BUDGET,
});

if (flag("check")) {
  const problems = verifyWorld(committed(), checks());
  console.log(problems.length ? problems.join("\n") : "welt.shapes.ts: all checks passed");
  process.exit(problems.length ? 1 : 0);
}

const rawFile = path(".geo-tmp/ne_110m_admin_0_countries.geojson");
if (!existsSync(rawFile)) {
  console.error("raw data missing: run node scripts/fetch-natural-earth.mjs first");
  process.exit(1);
}
const eps = Number(option("eps", "0.8"));
const features = JSON.parse(readFileSync(rawFile, "utf8")).features;
const res = buildWorld(features, {
  territories: ids,
  landPairs,
  countries: reg.COUNTRIES,
  lenses: reg.LENSES,
  epsilon: eps,
  gap: reg.GAP_MIN,
  kerbeMax: reg.KERBE_MAX,
  islandMinArea: (id) => reg.ISLAND_MIN_AREA[id] ?? reg.MIN_ISLAND_AREA,
  keepIslands: reg.KEEP_ISLANDS,
  extraRings: reg.EXTRA_RINGS,
});

// ---------- report ----------
const say = (s = "") => console.log(s);
say(`# Report (epsilon ${eps})`);
if (res.unassigned.length)
  say(`UNASSIGNED countries (no row in COUNTRIES): ${res.unassigned.join(", ")}`);
let total = 0;
let islands = 0;
say("\nvertices per territory (main part + islands):");
for (const id of ids) {
  const rings = res.rings[id];
  const v = rings.reduce((s, r) => s + r.length, 0);
  total += v;
  islands += rings.length - 1;
  say(
    `  ${id.padEnd(17)} ${String(v).padStart(4)}  rings ${rings.length}  (${rings.map((r) => r.length).join(", ")})`,
  );
}
say(`total: ${total} vertices, ${islands} island rings, ${ids.length} main parts`);
say(`dropped island rings (below the minimum area): ${res.droppedIslands.length}`);
say(`notches (Kerben): ${res.notches.length}`);
for (const n of res.notches)
  say(`  ${n.pair}  runs ${n.runs}  contact length ${n.length.toFixed(2)}`);
say(
  `touches longer than ${reg.KERBE_MAX} without a land border (question to Jakob): ${res.longTouches.length}`,
);
for (const t of res.longTouches) say(`  ${t.pair}  ${t.length.toFixed(1)}`);
say(
  `pairs that stay closer than ${reg.GAP_MIN}: ${res.tooClose.length ? res.tooClose.join(", ") : "none"}`,
);

const problems = verifyWorld(res.rings, checks());
say(`\nchecks: ${problems.length ? "\n  " + problems.join("\n  ") : "all passed"}`);

// anchor proposals (an aid; the anchors in welt.layout.ts are set by hand)
const fit = fitScale({ width: 744, height: 900 }, weltLayout.viewBox, 8);
const wanted = (32 + 2) / fit;
const sug = suggestAnchors(res.rings, { minDistance: wanted + 0.8, clearance: 8, step: 2 });
say(
  `\nanchor proposal (counter 32 px + 2 px at the fit scale ${fit.toFixed(3)} px/unit = ${wanted.toFixed(1)} units):`,
);
for (const id of ids)
  say(`  ${id}: [${sug.anchors[id].map((v) => Math.round(v * 10) / 10).join(", ")}]`);
say(
  `pairs below the wanted distance: ${sug.tight.length ? sug.tight.map((t) => `${t.a}|${t.b} ${t.d.toFixed(1)}`).join(", ") : "none"}`,
);

if (flag("write")) {
  const source = "Source: Natural Earth 1:110m admin 0 (Public Domain), see maps/README.md.";
  writeFileSync(path("apps/client/src/maps/welt.shapes.ts"), shapesModule(res.rings, source));
  say("\nwrote welt.shapes.ts");
}
process.exit(problems.length ? 1 : 0);
