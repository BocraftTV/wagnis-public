/// <reference types="node" />
// Reads colors.css (only here, never in the app) and checks the color rules of plan 006: the continent tint and the
// lighting must not make the owner colors hard to tell apart.
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("./colors.css", import.meta.url), "utf8");

/** Value of a `--name: #rrggbb;` declaration. */
export function cssColor(name: string): string {
  const m = css.match(new RegExp(`--${name}:\\s*(#[0-9a-fA-F]{6})\\s*;`));
  if (!m) throw new Error(`colors.css has no hex color --${name}`);
  return m[1]!;
}

type Rgb = [number, number, number];
const rgb = (hex: string): Rgb => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as Rgb;

/** Alpha compositing in sRGB, as SVG does for `opacity`. */
function over(top: Rgb, alpha: number, base: Rgb): Rgb {
  return base.map((b, i) => top[i]! * alpha + b * (1 - alpha)) as Rgb;
}

function lab(c: Rgb): [number, number, number] {
  const lin = c.map((v) => {
    const s = v / 255;
    return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  const [r, g, b] = lin as Rgb;
  const x = (0.4124564 * r + 0.3575761 * g + 0.1804375 * b) / 0.95047;
  const y = 0.2126729 * r + 0.7151522 * g + 0.072175 * b;
  const z = (0.0193339 * r + 0.119192 * g + 0.9503041 * b) / 1.08883;
  const fn = (t: number) => (t > 216 / 24389 ? Math.cbrt(t) : ((24389 / 27) * t + 16) / 116);
  const [fx, fy, fz] = [fn(x), fn(y), fn(z)] as Rgb;
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export const deltaE = (a: Rgb, b: Rgb): number => {
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return Math.hypot(l1 - l2, a1 - a2, b1 - b2);
};

const owners = [0, 1, 2, 3, 4, 5].map((i) => `player-${i}`).concat("player-neutral");
const continents = [
  "nordamerika",
  "karibischer-bogen",
  "suedamerika",
  "europa",
  "afrika",
  "vorderasien",
  "asien",
  "ozeanien",
];

describe("owner colors under tint and lighting", () => {
  // Land color as drawn: owner, then lighting (bright or dark end of the gradient), then the continent tint.
  const drawn = (owner: string, continent: string, end: "light" | "shade" | "none"): Rgb => {
    let c = rgb(cssColor(owner));
    if (end === "light") c = over(rgb(cssColor("map-light")), 0.18, c);
    if (end === "shade") c = over(rgb(cssColor("map-shade")), 0.14, c);
    return over(rgb(cssColor(`continent-${continent}`)), 0.12, c);
  };

  for (const continent of continents) {
    it(`keeps all seven owner colors at least ΔE 20 apart on the ${continent} tint`, () => {
      for (let i = 0; i < owners.length; i++) {
        for (let j = i + 1; j < owners.length; j++) {
          const d = deltaE(
            drawn(owners[i]!, continent, "none"),
            drawn(owners[j]!, continent, "none"),
          );
          expect(d, `${owners[i]} / ${owners[j]}`).toBeGreaterThanOrEqual(20);
        }
      }
    });
  }
});

/** WCAG relative luminance and contrast ratio. */
function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((v) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
}

describe("contrast (plan 006, 5.5)", () => {
  const c = cssColor;

  it("reads text at least 7:1 against its halo or field", () => {
    expect(contrast(c("map-ink"), c("map-label-halo"))).toBeGreaterThanOrEqual(7);
    expect(contrast(c("map-counter-ink"), c("map-counter-field"))).toBeGreaterThanOrEqual(7);
    expect(contrast(c("map-ink"), c("map-counter-field"))).toBeGreaterThanOrEqual(7);
  });

  it("separates the coin ring from the ink lines around it for every owner (at least 3:1)", () => {
    for (const o of owners) {
      expect(contrast(c("map-ink"), c(o)), o).toBeGreaterThanOrEqual(3);
    }
  });

  it("keeps the coin field apart from the owner ring on the ink side (field against ink line)", () => {
    expect(contrast(c("map-counter-field"), c("map-ink"))).toBeGreaterThanOrEqual(7);
  });

  it("keeps the sea route line at least 3:1 against both ends of the sea gradient", () => {
    expect(contrast(c("map-sea-route"), c("map-sea-0"))).toBeGreaterThanOrEqual(3);
    expect(contrast(c("map-sea-route"), c("map-sea-1"))).toBeGreaterThanOrEqual(3);
  });

  it("keeps continent borders and the coast contour at least 3:1 against the sea and the paper", () => {
    for (const bg of ["map-sea-0", "map-sea-1", "map-paper"]) {
      expect(contrast(c("map-continent-border"), c(bg)), bg).toBeGreaterThanOrEqual(3);
      expect(contrast(c("map-border"), c(bg)), bg).toBeGreaterThanOrEqual(3);
    }
  });
});

describe("QR code colors (plan 008, 2.4)", () => {
  it("keeps at least 15:1 between dark and light modules", () => {
    expect(contrast(cssColor("qr-dark"), cssColor("qr-light"))).toBeGreaterThanOrEqual(15);
  });
});
