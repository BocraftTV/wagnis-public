// Build and the checks of the client bundle.
import { spawnSync } from "node:child_process";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { root, check } from "./lib.mjs";

async function bundleChecks(bundle, assetsDir) {
  const { worldMissions } = await import(
    new URL("../../packages/engine/dist/maps/index.js", import.meta.url).href
  );
  const flat = bundle.replace(/["'`\s]/g, "");
  const sequences = worldMissions.missions
    .filter((m) => m.type === "conquerContinents" && m.continentIds.length >= 2)
    .map((m) => m.continentIds.join(","));
  const found = sequences.filter((q) => flat.includes(q));
  check(
    sequences.length >= 8 && found.length === 0,
    `client bundle holds no world mission list (${sequences.length} sequences searched, ${found.length} found)`,
  );

  const allowedHosts = new Set(["www.w3.org", "svelte.dev", "json-schema.org"]);
  const urls = [...bundle.matchAll(/https?:\/\/([A-Za-z0-9.-]+)/g)].map((m) => m[1]);
  const foreign = [...new Set(urls.filter((h) => !allowedHosts.has(h)))];
  const others = readdirSync(assetsDir)
    .filter((f) => !f.endsWith(".js"))
    .map((f) => readFileSync(join(assetsDir, f), "utf8"))
    .concat(readFileSync(join(root, "apps/client/dist/index.html"), "utf8"))
    .join("\n");
  const plain = /https?:\/\/|@import|\/\/fonts\./.test(others);
  check(
    foreign.length === 0 && !plain,
    `client bundle makes no external request (${foreign.join(", ") || "no foreign host"}; HTML/CSS ${plain ? "have URLs" : "have no URLs"})`,
  );
  // The atlas look is drawn without webfonts, imports or SVG filters (plan 006, 6.2); the script bundle may name
  // http(s) only for the namespaces above.
  const inJs = ["fonts.", "@import", "feGaussianBlur", "feDropShadow"].filter((n) =>
    bundle.includes(n),
  );
  check(
    inJs.length === 0,
    `client bundle has no font service, @import or SVG filter (${inJs.join(", ") || "none found"})`,
  );
  const assets = readdirSync(assetsDir).map((f) => readFileSync(join(assetsDir, f)));
  const raw = assets.reduce((n, b) => n + b.length, 0);
  const zipped = assets.reduce((n, b) => n + gzipSync(b).length, 0);
  console.log(
    `info client assets: ${(raw / 1024).toFixed(1)} KB raw, ${(zipped / 1024).toFixed(1)} KB gzip`,
  );
}

/** Builds everything and checks the client bundle: no engine logic, no rule values, no external requests. */
export async function buildSection() {
  console.log("== build");
  const build = spawnSync("npm", ["run", "build"], { cwd: root, stdio: "pipe", encoding: "utf8" });
  if (build.status !== 0) {
    console.log(build.stdout, build.stderr);
    throw new Error("build failed");
  }
  console.log("ok   npm run build");

  const assetsDir = join(root, "apps/client/dist/assets");
  const bundle = readdirSync(assetsDir)
    .filter((f) => f.endsWith(".js"))
    .map((f) => readFileSync(join(assetsDir, f), "utf8"))
    .join("\n");
  const leaked = [
    "applyAction",
    "applyHostAction",
    "checkLastPlayer",
    "replaceTargetMissions",
    "createGame",
    "viewFor",
    "calculateReinforcements",
    "validateMap",
    "tradeValue",
    "cardCatalog",
    "drawCard",
    "missionSatisfied",
    "checkVictory",
    "migrateState",
    "weltRules",
    "worldMissions",
    "startArmies",
    "minReinforcement",
  ].filter((n) => bundle.includes(n));
  check(
    leaked.length === 0,
    `client bundle contains no engine logic or rule values (${leaked.join(", ") || "none found"})`,
  );
  await bundleChecks(bundle, assetsDir);
}
