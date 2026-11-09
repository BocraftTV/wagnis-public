import { describe, expect, it } from "vitest";
import { clamp, fitViewport } from "./viewport.js";
import { GestureTracker, isDoubleTap, keyAction, wheelFactor } from "./gestures.js";

const container = { width: 744, height: 496 };
const viewBox = { width: 1000, height: 540 };
const fit = fitViewport(container, viewBox, 8);
const limit = (v: typeof fit) => clamp(v, container, viewBox);
// A zoomed viewport, so panning has room.
const zoomed = limit({ scale: fit.scale * 3, tx: -300, ty: -200 });
const at = (x: number, y: number, t: number) => ({ x, y, t });

describe("GestureTracker", () => {
  it("treats a short press that stays put as a tap", () => {
    const g = new GestureTracker(limit);
    g.down(1, at(100, 100, 0), zoomed);
    expect(g.move(1, { x: 105, y: 104 })).toBeNull();
    expect(g.up(1, at(105, 104, 200), zoomed)).toEqual({ tap: true });
    expect(g.suppressClick).toBe(false);
  });

  it("does not treat a slow press as a tap and suppresses the click", () => {
    const g = new GestureTracker(limit);
    g.down(1, at(100, 100, 0), zoomed);
    expect(g.up(1, at(100, 100, 351), zoomed)).toEqual({ tap: false });
    expect(g.suppressClick).toBe(true);
  });

  it("pans after more than 10 px and suppresses the click", () => {
    const g = new GestureTracker(limit);
    g.down(1, at(100, 100, 0), zoomed);
    expect(g.move(1, { x: 110, y: 100 })).toBeNull();
    const r = g.move(1, { x: 130, y: 100 });
    expect(r?.dragging).toBe(true);
    expect(r?.viewport.tx).toBeCloseTo(zoomed.tx + 30, 6);
    expect(g.up(1, at(130, 100, 100), zoomed).tap).toBe(false);
    expect(g.suppressClick).toBe(true);
  });

  it("keeps a pan inside the map", () => {
    const g = new GestureTracker(limit);
    g.down(1, at(100, 100, 0), zoomed);
    const r = g.move(1, { x: 5000, y: 100 })!;
    expect(r.viewport.tx).toBeLessThanOrEqual(8);
  });

  it("zooms with two fingers moving apart, around their midpoint", () => {
    const g = new GestureTracker(limit);
    g.down(1, at(300, 250, 0), fit);
    g.down(2, at(400, 250, 5), fit);
    const r = g.move(2, { x: 500, y: 250 })!;
    expect(r.dragging).toBe(true);
    expect(r.viewport.scale).toBeCloseTo(fit.scale * 2, 6);
    expect(g.suppressClick).toBe(true);
    // The map point under the start midpoint (350, 250) stays under the new midpoint (400, 250).
    const m = (350 - fit.tx) / fit.scale;
    expect(m * r.viewport.scale + r.viewport.tx).toBeCloseTo(400, 6);
  });

  it("continues as a pan with the finger left after a pinch, without a tap", () => {
    const g = new GestureTracker(limit);
    g.down(1, at(300, 250, 0), zoomed);
    g.down(2, at(400, 250, 5), zoomed);
    expect(g.up(2, at(400, 250, 100), zoomed).tap).toBe(false);
    const r = g.move(1, { x: 340, y: 250 })!;
    expect(r.viewport.tx).toBeCloseTo(zoomed.tx + 40, 6);
    expect(g.up(1, at(340, 250, 200), zoomed).tap).toBe(false);
    expect(g.suppressClick).toBe(true);
  });

  it("starts clean after all fingers are up", () => {
    const g = new GestureTracker(limit);
    g.down(1, at(0, 0, 0), zoomed);
    g.move(1, { x: 50, y: 0 });
    g.up(1, at(50, 0, 50), zoomed);
    g.down(2, at(10, 10, 1000), zoomed);
    expect(g.suppressClick).toBe(false);
    expect(g.up(2, at(10, 10, 1100), zoomed).tap).toBe(true);
  });

  it("ignores a third finger and unknown pointers", () => {
    const g = new GestureTracker(limit);
    g.down(1, at(0, 0, 0), fit);
    g.down(2, at(100, 0, 0), fit);
    g.down(3, at(50, 50, 0), fit);
    expect(g.move(3, { x: 60, y: 60 })).toBeNull();
    expect(g.up(9, at(0, 0, 1), fit)).toEqual({ tap: false });
  });
});

describe("double tap, wheel, keys", () => {
  it("recognises two close taps within 300 ms and 30 px", () => {
    expect(isDoubleTap(at(10, 10, 0), at(20, 20, 300))).toBe(true);
    expect(isDoubleTap(at(10, 10, 0), at(20, 20, 301))).toBe(false);
    expect(isDoubleTap(at(10, 10, 0), at(60, 10, 100))).toBe(false);
    expect(isDoubleTap(null, at(0, 0, 0))).toBe(false);
  });

  it("zooms in on scrolling up and out on scrolling down, faster for a trackpad pinch", () => {
    expect(wheelFactor(-100, false)).toBeGreaterThan(1);
    expect(wheelFactor(100, false)).toBeLessThan(1);
    expect(wheelFactor(-10, true)).toBeGreaterThan(wheelFactor(-10, false));
    expect(wheelFactor(0, false)).toBe(1);
  });

  it("maps keys to zoom, fit and pan", () => {
    expect(keyAction("+")).toEqual({ kind: "zoom", factor: 1.5 });
    expect(keyAction("-")).toMatchObject({ kind: "zoom" });
    expect(keyAction("0")).toEqual({ kind: "fit" });
    expect(keyAction("ArrowLeft")).toMatchObject({ kind: "pan", dx: 80 });
    expect(keyAction("a")).toBeNull();
  });
});
