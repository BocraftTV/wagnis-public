// HTTP checks against the running server: client, SPA fallback, headers, PWA files.
import { check } from "./lib.mjs";

/** The client, the SPA fallback, 404 for missing assets, X-Robots-Tag, the PWA manifest and icons. */
export async function httpSection(base) {
  const index = await fetch(base + "/");
  check(
    index.ok && (await index.text()).includes("<title>Wagnis</title>"),
    "GET / serves the client",
  );
  check(index.headers.get("x-robots-tag") === "noindex", "X-Robots-Tag: noindex");
  const spa = await fetch(base + "/r/K7M2XQ");
  check(spa.ok && (await spa.text()).includes('id="app"'), "SPA fallback for /r/K7M2XQ");
  check(
    (await fetch(base + "/assets/missing.js")).status === 404,
    "missing asset is 404, not index.html",
  );

  // PWA (plan 010): manifest and icons are reachable, the page links them, and there is no service worker.
  const manifestRes = await fetch(base + "/manifest.webmanifest");
  const manifest = manifestRes.ok ? await manifestRes.json() : { icons: [] };
  const iconRes = await Promise.all(manifest.icons.map((i) => fetch(base + i.src)));
  const indexHtml = await (await fetch(base + "/")).text();
  check(
    manifest.name === "Wagnis" &&
      manifest.icons.length > 0 &&
      iconRes.every((r) => r.ok && r.headers.get("content-type") === "image/png") &&
      indexHtml.includes('rel="manifest" href="/manifest.webmanifest"') &&
      (await fetch(base + "/icons/apple-touch-icon.png")).ok &&
      (await fetch(base + "/sw.js")).status === 404,
    "PWA: manifest and icons reachable, page links them, no service worker",
  );
}
