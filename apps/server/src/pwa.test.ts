import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { mkdirSync, writeFileSync } from "node:fs";
import { makeTmpDir, removeDir, startServer } from "./test-helpers.js";
import type { TestServer } from "./test-helpers.js";

// Plan 010: manifest and icons come out of the static directory with the right type and `no-cache`; there is no
// service worker and a missing file is a 404, never index.html.

let dir: string;
let srv: TestServer | undefined;

beforeEach(async () => {
  dir = makeTmpDir();
  const dist = `${dir}/dist`;
  mkdirSync(`${dist}/icons`, { recursive: true });
  writeFileSync(`${dist}/index.html`, '<!doctype html><div id="app"></div>');
  writeFileSync(`${dist}/manifest.webmanifest`, '{"name":"Wagnis"}');
  writeFileSync(`${dist}/icons/icon-192.png`, Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  srv = await startServer(`${dir}/db.sqlite`, { clientDist: dist });
});
afterEach(async () => {
  await srv?.close();
  srv = undefined;
  removeDir(dir);
});

describe("PWA files", () => {
  it("serves the manifest as application/manifest+json, no-cache, noindex", async () => {
    const res = await fetch(`${srv!.base}/manifest.webmanifest`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toMatch(/^application\/manifest\+json/);
    expect(res.headers.get("cache-control")).toBe("no-cache");
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
  });

  it("serves icons as image/png with no-cache", async () => {
    const res = await fetch(`${srv!.base}/icons/icon-192.png`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("cache-control")).toBe("no-cache");
  });

  it("answers a missing icon and /sw.js with a JSON 404, not index.html", async () => {
    for (const path of ["/icons/missing.png", "/sw.js"]) {
      const res = await fetch(`${srv!.base}${path}`);
      expect(res.status).toBe(404);
      expect(res.headers.get("content-type")).toMatch(/json/);
    }
  });
});
