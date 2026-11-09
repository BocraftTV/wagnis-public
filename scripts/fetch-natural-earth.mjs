// Downloads the Natural Earth country outlines (Public Domain) once into .geo-tmp/ for scripts/build-world-shapes.mjs.
// The raw data is never committed. The file is only parsed as JSON, never executed.
// Usage: node scripts/fetch-natural-earth.mjs
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const TAG = "v5.1.2";
const FILES = [
  {
    name: "ne_110m_admin_0_countries.geojson",
    sha256: "6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f",
    maxBytes: 2_000_000,
  },
];
const BASE = `https://raw.githubusercontent.com/nvkelso/natural-earth-vector/${TAG}/geojson/`;
const dir = fileURLToPath(new URL("../.geo-tmp/", import.meta.url));

mkdirSync(dir, { recursive: true });
for (const f of FILES) {
  const target = dir + f.name;
  let bytes;
  if (existsSync(target)) {
    bytes = readFileSync(target);
  } else {
    const res = await fetch(BASE + f.name);
    if (!res.ok) throw new Error(`download failed: ${f.name} (${res.status})`);
    bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > f.maxBytes)
      throw new Error(`${f.name}: unexpectedly large (${bytes.length} bytes)`);
  }
  const sum = createHash("sha256").update(bytes).digest("hex");
  if (sum !== f.sha256) throw new Error(`${f.name}: SHA-256 mismatch (got ${sum}), file not used`);
  const json = JSON.parse(bytes.toString("utf8"));
  if (json.type !== "FeatureCollection" || !Array.isArray(json.features))
    throw new Error(`${f.name}: not a FeatureCollection`);
  writeFileSync(target, bytes);
  console.log(`${f.name}: ${bytes.length} bytes, ${json.features.length} features, SHA-256 ok`);
}
