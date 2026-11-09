import { describe, expect, it } from "vitest";
import {
  clamp,
  counterScale,
  doubleTap,
  fitScale,
  fitViewport,
  isTap,
  labelVisible,
  pan,
  pinch,
  refit,
  relativeZoom,
  toMap,
  toScreen,
  zoomAt,
  type Size,
  type Viewport,
  type ViewportLimits,
} from "./viewport.js";

const viewBox: Size = { width: 1000, height: 540 };
const limits: ViewportLimits = { inset: 8, maxZoom: 4 };
const portrait: Size = { width: 744, height: 900 };
const landscape: Size = { width: 1133, height: 700 };

function near(a: number, b: number, digits = 6): void {
  expect(a).toBeCloseTo(b, digits);
}

describe("fitScale / fitViewport", () => {
  it("fits by width in portrait", () => {
    near(fitScale(portrait, viewBox, 8), (744 - 16) / 1000);
  });

  it("fits by height when the container is wider than the map", () => {
    const wide: Size = { width: 1600, height: 700 };
    near(fitScale(wide, viewBox, 8), (700 - 16) / 540);
    near(fitScale(landscape, viewBox, 8), (1133 - 16) / 1000);
  });

  it("centers the map at the fit scale", () => {
    const vp = fitViewport(portrait, viewBox, 8);
    near(vp.tx, 8);
    near(vp.ty, (900 - 540 * vp.scale) / 2);
    const lt = fitViewport(landscape, viewBox, 8);
    near(lt.tx, 8);
    near(lt.ty, (700 - 540 * lt.scale) / 2);
  });
});

describe("clamp", () => {
  const fit = fitScale(portrait, viewBox, 8);

  it("raises the scale to the fit scale and lowers it to fit * maxZoom", () => {
    expect(clamp({ scale: fit / 2, tx: 0, ty: 0 }, portrait, viewBox, limits).scale).toBe(fit);
    near(clamp({ scale: fit * 9, tx: 0, ty: 0 }, portrait, viewBox, limits).scale, fit * 4);
  });

  it("centers an axis on which the map is smaller than the container", () => {
    const c = clamp({ scale: fit, tx: 300, ty: -300 }, portrait, viewBox, limits);
    near(c.tx, 8);
    near(c.ty, (900 - 540 * fit) / 2);
  });

  it("never lets the map leave the container when zoomed in", () => {
    const scale = fit * 3;
    const far = clamp({ scale, tx: 500, ty: 500 }, portrait, viewBox, limits);
    near(far.tx, limits.inset);
    near(far.ty, limits.inset);
    const away = clamp({ scale, tx: -99999, ty: -99999 }, portrait, viewBox, limits);
    near(away.tx, 744 - limits.inset - 1000 * scale);
    near(away.ty, 900 - limits.inset - 540 * scale);
  });

  it("leaves a valid viewport unchanged", () => {
    const scale = fit * 3;
    const vp: Viewport = { scale, tx: -200, ty: -10 };
    expect(clamp(vp, portrait, viewBox, limits)).toEqual(vp);
  });
});

describe("zoomAt", () => {
  it("keeps the focal point fixed on screen", () => {
    const vp: Viewport = { scale: 0.7, tx: 12, ty: 40 };
    const focal = { x: 400, y: 300 };
    const before = toMap(vp, focal);
    const zoomed = zoomAt(vp, focal, 2.5);
    near(zoomed.scale, 1.75);
    const after = toScreen(zoomed, before);
    near(after.x, focal.x);
    near(after.y, focal.y);
  });
});

describe("pan", () => {
  it("moves the translation only", () => {
    expect(pan({ scale: 2, tx: 5, ty: 6 }, 10, -4)).toEqual({ scale: 2, tx: 15, ty: 2 });
  });
});

describe("pinch", () => {
  const start: Viewport = { scale: 1, tx: 0, ty: 0 };

  it("doubles the scale when the fingers spread to twice the distance", () => {
    const v = pinch(
      start,
      [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ],
      [
        { x: 50, y: 100 },
        { x: 250, y: 100 },
      ],
    );
    near(v.scale, 2);
    // The map point that was under the start midpoint (150,100) is under the current midpoint (150,100).
    const m = toScreen(v, { x: 150, y: 100 });
    near(m.x, 150);
    near(m.y, 100);
  });

  it("pans along when the midpoint moves", () => {
    const v = pinch(
      start,
      [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ],
      [
        { x: 130, y: 120 },
        { x: 230, y: 120 },
      ],
    );
    near(v.scale, 1);
    near(v.tx, 30);
    near(v.ty, 20);
  });

  it("keeps the scale when the start fingers coincide", () => {
    const v = pinch(
      start,
      [
        { x: 100, y: 100 },
        { x: 100, y: 100 },
      ],
      [
        { x: 90, y: 100 },
        { x: 200, y: 100 },
      ],
    );
    near(v.scale, 1);
  });
});

describe("isTap", () => {
  const down = { x: 100, y: 100, t: 1000 };

  it("is a tap at exactly 10 px and 350 ms", () => {
    expect(isTap(down, { x: 106, y: 108, t: 1350 })).toBe(true);
  });

  it("is not a tap beyond 10 px", () => {
    expect(isTap(down, { x: 111, y: 100, t: 1100 })).toBe(false);
  });

  it("is not a tap beyond 350 ms", () => {
    expect(isTap(down, { x: 100, y: 100, t: 1351 })).toBe(false);
  });

  it("accepts custom thresholds", () => {
    expect(isTap(down, { x: 130, y: 100, t: 1100 }, { distance: 30, duration: 200 })).toBe(true);
  });
});

describe("doubleTap", () => {
  it("zooms to 2x around the point, then to the maximum, then back to the fit view", () => {
    const fitVp = fitViewport(portrait, viewBox, limits.inset);
    const focal = { x: 300, y: 400 };
    const mapPoint = toMap(fitVp, focal);

    const first = doubleTap(fitVp, focal, portrait, viewBox, limits);
    near(relativeZoom(first, fitVp.scale), 2);
    // The map point under the finger stays under it where clamping allows (no clamp at the edge here).
    const back = toScreen(first, mapPoint);
    near(back.x, focal.x, 3);

    const second = doubleTap(first, focal, portrait, viewBox, limits);
    near(relativeZoom(second, fitVp.scale), 4);

    const third = doubleTap(second, focal, portrait, viewBox, limits);
    expect(third).toEqual(fitVp);
  });
});

describe("toMap / toScreen", () => {
  it("are inverse", () => {
    const vp: Viewport = { scale: 1.37, tx: -41, ty: 18 };
    const p = { x: 321.5, y: 88.25 };
    const r = toMap(vp, toScreen(vp, p));
    near(r.x, p.x);
    near(r.y, p.y);
  });
});

describe("refit", () => {
  it("keeps the fit view a fit view when the device rotates", () => {
    const fitVp = fitViewport(portrait, viewBox, limits.inset);
    expect(refit(fitVp, portrait, landscape, viewBox, limits)).toEqual(
      fitViewport(landscape, viewBox, limits.inset),
    );
  });

  it("keeps the center map point and the relative zoom", () => {
    const fit = fitScale(portrait, viewBox, limits.inset);
    const old = clamp({ scale: fit * 2.5, tx: -300, ty: -200 }, portrait, viewBox, limits);
    const center = toMap(old, { x: portrait.width / 2, y: portrait.height / 2 });
    const next = refit(old, portrait, landscape, viewBox, limits);
    near(relativeZoom(next, fitScale(landscape, viewBox, limits.inset)), 2.5);
    const c = toScreen(next, center);
    near(c.x, landscape.width / 2, 3);
    near(c.y, landscape.height / 2, 3);
  });

  it("clamps the result", () => {
    const old: Viewport = { scale: fitScale(portrait, viewBox, 8) * 4, tx: -2000, ty: -1000 };
    const next = refit(old, portrait, landscape, viewBox, limits);
    expect(next).toEqual(clamp(next, landscape, viewBox, limits));
  });
});

describe("counterScale / labelVisible", () => {
  it("counterScale cancels the scale", () => {
    near(counterScale({ scale: 0.5, tx: 0, ty: 0 }) * 0.5, 1);
    near(counterScale({ scale: 3, tx: 9, ty: 9 }), 1 / 3);
  });

  it("labelVisible switches at the threshold", () => {
    const fit = 0.7;
    expect(labelVisible({ scale: fit * 1.59, tx: 0, ty: 0 }, fit, 1.6)).toBe(false);
    expect(labelVisible({ scale: fit * 1.6, tx: 0, ty: 0 }, fit, 1.6)).toBe(true);
    expect(labelVisible({ scale: fit * 4, tx: 0, ty: 0 }, fit, 1.6)).toBe(true);
  });
});
