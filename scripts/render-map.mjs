// Draws the world map without game state as a static SVG file, for looking at the coasts, decoration, counters, labels
// and sea routes in a browser or QuickLook. Not part of build or test; the output is not committed.
// Same data as the app: layout paths from maps/index.ts, decoration from maps/decor.ts, colors from styles/colors.css.
// Usage: node scripts/render-map.mjs [--out FILE] [--scale PX_PER_UNIT] [--hits] [--labels] [--crop X,Y,W,H]
//   --scale   screen px per map unit; counters and labels keep their screen size (default: fit in 744 px width)
//   --hits    draw the effective tap circles at that scale
//   --labels  draw territory names (they show from zoom 1.6 in the app)
//   --crop    X,Y,W,H in map units: only this part of the map (a zoomed-in view)
//   --rings   draw a selection ring on three territories (chosen, attack, move)
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
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
const { mapData } = await load("apps/client/src/maps/index.ts");
const { PATTERNS, ROSE, WAVE_TILE, FRAME_UNIT, frame, gridPath } = await load(
  "apps/client/src/maps/decor.ts",
);
const { effectiveHit } = await load("apps/client/src/lib/hit.ts");
const {
  labelLines,
  LABEL_FONT_PX,
  LABEL_LINE_PX,
  continentLabelLines,
  continentLabelWidth,
  BADGE_PX,
  BADGE_GAP_PX,
  CONTINENT_LINE_PX,
} = await load("apps/client/src/lib/label.ts");
const { segmentsPath } = await load("apps/client/src/lib/borders.ts");
const { fitScale } = await load("apps/client/src/lib/viewport.ts");

const { map, layout } = mapData("welt");
const { viewBox } = layout;
const scale = Number(option("scale", fitScale({ width: 744, height: 900 }, viewBox, 8)));
const crop = option("crop", "").split(",").map(Number);
const view =
  crop.length === 4 && crop.every(Number.isFinite) ? crop : [0, 0, viewBox.width, viewBox.height];
const out = option("out", path(".render-tmp/welt-map.svg"));
const u = 1 / scale; // one screen px in map units
const px = (n) => (n * u).toFixed(3);
const num = (n) => String(Math.round(n * 100) / 100);

const css =
  readFileSync(path("apps/client/src/styles/colors.css"), "utf8") +
  readFileSync(path("apps/client/src/styles/app.css"), "utf8").match(/:root \{[^}]*\}/)[0];
const FONT_SERIF = `"Iowan Old Style", "Palatino", "Palatino Linotype", Georgia, serif`;
const FONT_SANS = `-apple-system, system-ui, sans-serif`;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const v = (name) => `var(--${name})`;

// A sample owner for every territory: the six seat colors and neutral in turn.
const OWNERS = [
  "player-0",
  "player-1",
  "player-2",
  "player-3",
  "player-4",
  "player-5",
  "player-neutral",
];
const owner = Object.fromEntries(
  map.territories.map((t, i) => [t.id, v(OWNERS[i % OWNERS.length])]),
);

const defs = [];
defs.push(
  `<linearGradient id="sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" style="stop-color:${v("map-sea-0")}"/><stop offset="1" style="stop-color:${v("map-sea-1")}"/></linearGradient>`,
  `<linearGradient id="light" gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="${viewBox.width}" y2="${viewBox.height}"><stop offset="0" style="stop-color:${v("map-light")};stop-opacity:.18"/><stop offset="1" style="stop-color:${v("map-shade")};stop-opacity:.14"/></linearGradient>`,
  `<pattern id="waves" width="${WAVE_TILE.width}" height="${WAVE_TILE.height}" patternUnits="userSpaceOnUse"><path d="${WAVE_TILE.d}" fill="none" stroke-width="1.1" stroke-linecap="round" style="stroke:${v("map-wave")}"/></pattern>`,
);
for (const [kind, t] of Object.entries(PATTERNS)) {
  const body =
    t.mode === "stroke"
      ? `<path d="${t.d}" fill="none" stroke-width="0.9" stroke-linecap="round" stroke-linejoin="round" style="stroke:${v("map-pattern")}"/>`
      : `<path d="${t.d}" style="fill:${v("map-pattern")}"/>`;
  defs.push(
    `<pattern id="pat-${kind}" width="${t.size}" height="${t.size}" patternUnits="userSpaceOnUse">${body}</pattern>`,
  );
}

const parts = [];
// 1 sea, decoration, frame
parts.push(`<rect width="${viewBox.width}" height="${viewBox.height}" fill="url(#sea)"/>`);
parts.push(
  `<rect width="${viewBox.width}" height="${viewBox.height}" fill="url(#waves)" opacity=".35"/>`,
);
parts.push(
  `<path d="${gridPath()}" fill="none" stroke-width="${px(1)}" opacity=".3" style="stroke:${v("map-grid")}"/>`,
);
const r = ROSE;
parts.push(
  `<circle cx="${r.center.x}" cy="${r.center.y}" r="${num(r.rings[0])}" fill="none" stroke-width="${px(1)}" style="stroke:${v("map-frame")}"/>`,
  `<circle cx="${r.center.x}" cy="${r.center.y}" r="${num(r.rings[1])}" fill="none" stroke-width="${px(1)}" style="stroke:${v("map-frame")}"/>`,
  `<path d="${r.dark}" style="fill:${v("map-rose-dark")}"/>`,
  `<path d="${r.light}" stroke-width="${px(0.8)}" stroke-linejoin="round" style="fill:${v("map-rose-light")};stroke:${v("map-rose-dark")}"/>`,
  `<text x="${r.north.x}" y="${r.north.y}" text-anchor="middle" dominant-baseline="central" font-family='${FONT_SERIF}' font-size="14" font-weight="700" style="fill:${v("map-frame")}">N</text>`,
);
const fr = frame(FRAME_UNIT, viewBox.width, viewBox.height);
parts.push(
  `<rect x="${fr.outer[0]}" y="${fr.outer[1]}" width="${fr.outer[2]}" height="${fr.outer[3]}" fill="none" stroke-width="${px(2)}" style="stroke:${v("map-frame")}"/>`,
  `<rect x="${fr.inner[0]}" y="${fr.inner[1]}" width="${fr.inner[2]}" height="${fr.inner[3]}" fill="none" stroke-width="${px(1)}" style="stroke:${v("map-frame")}"/>`,
  `<path d="${fr.corners}" style="fill:${v("map-frame")}"/>`,
);
// 2 coast halo
parts.push(
  `<path d="${layout.allPath}" fill="none" stroke-width="${px(8)}" stroke-linejoin="round" stroke-opacity=".25" style="stroke:${v("map-halo")}"/>`,
  `<path d="${layout.allPath}" fill="none" stroke-width="${px(4)}" stroke-linejoin="round" stroke-opacity=".45" style="stroke:${v("map-halo")}"/>`,
);
// 3 land
for (const t of map.territories)
  parts.push(`<path d="${layout.paths[t.id]}" style="fill:${owner[t.id]}"/>`);
// 4 terrain, light, continent tone
for (const [kind, d] of Object.entries(layout.terrainPaths))
  parts.push(`<path d="${d}" fill="url(#pat-${kind})" opacity=".3"/>`);
parts.push(`<path d="${layout.allPath}" fill="url(#light)"/>`);
for (const [cid, d] of Object.entries(layout.continentPaths))
  parts.push(`<path d="${d}" opacity=".12" style="fill:${v(`continent-${cid}`)}"/>`);
// 5 lines
const borders = segmentsPath(layout.continentBorders);
const stroke = (d, w, color, extra = "") =>
  `<path d="${d}" fill="none" stroke-width="${px(w)}" stroke-linecap="round" stroke-linejoin="round" ${extra} style="stroke:${v(color)}"/>`;
parts.push(stroke(layout.allPath, 2.5, "map-light", 'stroke-opacity=".3"'));
parts.push(stroke(layout.allPath, 1, "map-border"));
parts.push(stroke(borders, 3, "map-continent-border"));
parts.push(stroke(borders, 1, "map-light", 'stroke-opacity=".7"'));
parts.push(stroke(layout.coastPath, 1.2, "map-continent-border"));
// sea routes: paper underlay, then the dash-dot line
const anchor = (id) => layout.territories[id].anchor;
const routeD = layout.links
  .flatMap((l) => {
    const a = anchor(l.a);
    const b = anchor(l.b);
    const lines = l.wrap
      ? [
          [a, l.wrap.a],
          [l.wrap.b, b],
        ]
      : [[a, ...(l.via ?? []), b]];
    return lines.map((line) => "M" + line.map((p) => `${p.x} ${p.y}`).join("L"));
  })
  .join("");
parts.push(stroke(routeD, 3.6, "map-paper", 'stroke-opacity=".55"'));
parts.push(
  stroke(routeD, 1.6, "map-sea-route", `stroke-dasharray="${[8, 5, 1.5, 5].map(px).join(" ")}"`),
);
if (flag("hits")) {
  for (const t of map.territories) {
    const l = layout.territories[t.id];
    const c = effectiveHit(l.anchor, l.hit, scale);
    parts.push(
      `<circle cx="${c.cx}" cy="${c.cy}" r="${c.r}" fill="none" stroke="#c0392b" stroke-width="${px(1)}" stroke-dasharray="${px(3)} ${px(3)}"/>`,
    );
  }
}
if (flag("rings")) {
  const ring = (id, color) => {
    const { x, y } = anchor(id);
    return `<g transform="translate(${x} ${y}) scale(${u})"><circle r="22" fill="none" stroke-width="6" style="stroke:${v("map-ring-under")}"/><circle r="22" fill="none" stroke-width="3" style="stroke:${v(color)}"/></g>`;
  };
  parts.push(ring("mittelland", "accent"), ring("osteuropa", "danger"), ring("atlantikmark", "ok"));
}

const halo = (w) => `stroke-width="${w}" stroke-linejoin="round" paint-order="stroke"`;
// continent names with the bonus badge
for (const [id, p] of Object.entries(layout.continentLabels)) {
  const c = map.continents.find((x) => x.id === id);
  const lines = continentLabelLines(c.name);
  const width = continentLabelWidth(lines);
  const text = lines
    .map(
      (s, i) =>
        `<tspan x="${-(BADGE_PX + BADGE_GAP_PX) / 2}" y="${(i - (lines.length - 1) / 2) * CONTINENT_LINE_PX}">${esc(s.toUpperCase())}</tspan>`,
    )
    .join("");
  parts.push(
    `<g transform="translate(${p.x} ${p.y}) scale(${u})"><text x="${-(BADGE_PX + BADGE_GAP_PX) / 2}" text-anchor="middle" dominant-baseline="central" font-family='${FONT_SERIF}' font-size="12" font-weight="700" letter-spacing="1.7" ${halo(3.5)} style="fill:${v("map-ink")};stroke:${v("map-label-halo")}">${text}</text>` +
      `<g transform="translate(${num(width / 2 + BADGE_GAP_PX / 2)} 0)"><circle r="9" stroke-width="1" style="fill:${v("map-counter-field")};stroke:${v("map-ink")}"/><text text-anchor="middle" dominant-baseline="central" font-family='${FONT_SANS}' font-size="10" font-weight="700" style="fill:${v("map-counter-ink")}">+${c.bonus}</text></g></g>`,
  );
}
for (const t of map.territories) {
  const l = layout.territories[t.id];
  const { x, y } = l.anchor;
  if (flag("labels")) {
    const anchorAttr = { start: "start", middle: "middle", end: "end" }[l.label.align];
    if (l.label.leader) {
      parts.push(
        `<line x1="${x}" y1="${y}" x2="${x + l.label.dx / scale}" y2="${y + l.label.dy / scale}" stroke-width="${px(1)}" style="stroke:${v("map-ink")}"/>`,
      );
    }
    const tspans = labelLines(t.name)
      .map((s, i) => `<tspan x="0" dy="${i === 0 ? 0 : LABEL_LINE_PX}">${esc(s)}</tspan>`)
      .join("");
    parts.push(
      `<g transform="translate(${x} ${y}) scale(${u})"><text transform="translate(${l.label.dx} ${l.label.dy + LABEL_FONT_PX - 1})" text-anchor="${anchorAttr}" font-family='${FONT_SERIF}' font-size="${LABEL_FONT_PX}" ${halo(3.5)} style="fill:${v("map-ink")};stroke:${v("map-label-halo")}">${tspans}</text></g>`,
    );
  }
  parts.push(
    `<g transform="translate(${x} ${y}) scale(${u})"><circle r="16" style="fill:${v("map-ink")}"/><circle r="15" style="fill:${owner[t.id]}"/><circle r="12" style="fill:${v("map-ink")}"/><circle r="11" style="fill:${v("map-counter-field")}"/><text text-anchor="middle" dominant-baseline="central" font-family='${FONT_SANS}' font-size="16" font-weight="700" style="fill:${v("map-counter-ink")}">24</text></g>`,
  );
}

const w = (view[2] * scale).toFixed(1);
const h = (view[3] * scale).toFixed(1);
const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="${view.join(" ")}">\n<style>${css}</style>\n<defs>${defs.join("")}</defs>\n${parts.join("\n")}\n</svg>\n`;
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, svg);
console.log(`${out}  (${w} x ${h} px, scale ${scale.toFixed(3)})`);
