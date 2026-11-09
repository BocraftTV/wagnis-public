/// <reference types="node" />
// PWA files (plan 010): the icons are PNGs of the stated size and opaque; the script check passes.
import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const publicDir = new URL("../public/", import.meta.url);
const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

function pngSize(file: string): { w: number; h: number; signature: boolean } {
  const buf = readFileSync(new URL(file, publicDir));
  return {
    w: buf.readUInt32BE(16),
    h: buf.readUInt32BE(20),
    signature: SIGNATURE.every((b, i) => buf[i] === b),
  };
}

describe("icons", () => {
  it.each([
    ["icons/apple-touch-icon.png", 180],
    ["icons/icon-192.png", 192],
    ["icons/icon-512.png", 512],
  ])("%s is a %i px square PNG", (file, size) => {
    expect(pngSize(file)).toEqual({ w: size, h: size, signature: true });
  });

  it("make-icons --check passes (colors from colors.css, opaque)", () => {
    const script = new URL("../../../scripts/make-icons.mjs", import.meta.url);
    expect(() =>
      execFileSync(process.execPath, [script.pathname, "--check"], { stdio: "pipe" }),
    ).not.toThrow();
  });
});

const manifest = JSON.parse(readFileSync(new URL("manifest.webmanifest", publicDir), "utf8")) as {
  [key: string]: unknown;
  icons: { src: string; sizes: string; type: string }[];
};
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const appCss = readFileSync(new URL("./styles/app.css", import.meta.url), "utf8");
const bg = appCss.match(/--bg:\s*(#[0-9a-fA-F]{6})/)![1];

describe("manifest", () => {
  it("has the fields an installable app needs", () => {
    expect(manifest["name"]).toBe("Wagnis");
    expect(manifest["short_name"]).toBe("Wagnis");
    expect(manifest["display"]).toBe("standalone");
    expect(manifest["start_url"]).toBe("/");
    expect(manifest["scope"]).toBe("/");
    expect(String(manifest["start_url"]).startsWith(String(manifest["scope"]))).toBe(true);
    expect(manifest.icons.length).toBeGreaterThan(0);
  });

  it("holds paths only, no absolute URL (smoke: no external request)", () => {
    expect(JSON.stringify(manifest)).not.toMatch(/https?:\/\//);
  });

  it("lists icons that exist with the stated size", () => {
    for (const icon of manifest.icons) {
      expect(icon.type).toBe("image/png");
      expect(icon.src.startsWith("/")).toBe(true);
      const { w, h, signature } = pngSize(icon.src.slice(1));
      expect(signature).toBe(true);
      expect(icon.sizes).toBe(`${w}x${h}`);
      expect(w).toBe(h);
    }
  });

  it("uses the surface color --bg for theme and background", () => {
    expect(manifest["theme_color"]).toBe(bg);
    expect(manifest["background_color"]).toBe(bg);
  });
});

describe("index.html", () => {
  it("links manifest and icons and sets the iOS meta tags", () => {
    expect(html).toContain('rel="manifest" href="/manifest.webmanifest"');
    expect(html).toContain('rel="apple-touch-icon"');
    expect(html).toContain('name="apple-mobile-web-app-capable" content="yes"');
    expect(html).toContain(
      'name="apple-mobile-web-app-status-bar-style" content="black-translucent"',
    );
    expect(html).toContain(`name="theme-color" content="${bg}"`);
    expect(html).toContain("viewport-fit=cover");
  });

  it("has no external URL and registers no service worker", () => {
    expect(html).not.toMatch(/https?:\/\//);
    expect(html).not.toContain("serviceWorker");
  });
});
