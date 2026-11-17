import { describe, expect, it } from "vitest";
import { attachMapInput } from "./map-input.js";
import type { MapInputHandlers } from "./map-input.js";
import type { Viewport } from "./viewport.js";

// A stage element that records its listeners; the events are plain objects with the fields the handling reads.
function fakeStage() {
  const listeners = new Map<
    string,
    { fn: (e: unknown) => void; options?: AddEventListenerOptions }
  >();
  const captured: number[] = [];
  const fake = {
    getBoundingClientRect: () => ({ left: 100, top: 50 }),
    setPointerCapture: (id: number) => void captured.push(id),
    addEventListener: (type: string, fn: unknown, options?: AddEventListenerOptions) =>
      void listeners.set(type, { fn: fn as (e: unknown) => void, ...(options ? { options } : {}) }),
    removeEventListener: (type: string, fn: unknown) => {
      if (listeners.get(type)?.fn === fn) listeners.delete(type);
    },
  };
  const el = fake as unknown as HTMLElement;
  const fire = (type: string, e: Record<string, unknown>) => {
    let prevented = false;
    listeners.get(type)!.fn({ preventDefault: () => (prevented = true), ...e });
    return prevented;
  };
  return { el, listeners, captured, fire };
}

const target = (tid: string | null) => ({
  closest: (sel: string) =>
    sel === "[data-tid]" && tid
      ? { getAttribute: (a: string) => (a === "data-tid" ? tid : null) }
      : null,
});

function setup() {
  const stage = fakeStage();
  let vp: Viewport = { scale: 1, tx: 0, ty: 0 };
  const calls: string[] = [];
  const shown: Viewport[] = [];
  const h: MapInputHandlers = {
    current: () => vp,
    show: (next) => {
      shown.push(next);
      vp = next;
    },
    limit: (v) => v,
    zoomBy: (factor, focal) =>
      void calls.push(`zoom ${factor.toFixed(3)} ${focal ? `${focal.x},${focal.y}` : "center"}`),
    fit: () => void calls.push("fit"),
    doubleTap: (cur, smp) => ({ scale: cur.scale * 2, tx: smp.x, ty: smp.y }),
    tapped: (id) => void calls.push(`tap ${id}`),
  };
  const detach = attachMapInput(stage.el, h);
  const pointer = (type: string, id: number, x: number, y: number, t: number, extra = {}) =>
    stage.fire(type, {
      pointerId: id,
      pointerType: "touch",
      button: 0,
      clientX: x + 100,
      clientY: y + 50,
      timeStamp: t,
      target: target(null),
      ...extra,
    });
  return { stage, calls, shown, detach, pointer };
}

describe("map input", () => {
  it("registers every listener, the wheel and Safari's gestures as not passive, and removes them again", () => {
    const { stage, detach } = setup();
    expect([...stage.listeners.keys()].sort()).toEqual(
      [
        "click",
        "gesturechange",
        "gestureend",
        "gesturestart",
        "keydown",
        "pointercancel",
        "pointerdown",
        "pointermove",
        "pointerup",
        "wheel",
      ].sort(),
    );
    for (const t of ["wheel", "gesturestart", "gesturechange", "gestureend"])
      expect(stage.listeners.get(t)!.options).toEqual({ passive: false });
    detach();
    expect(stage.listeners.size).toBe(0);
  });

  it("a click on a territory taps it, a click on the sea does not", () => {
    const { stage, calls } = setup();
    stage.fire("click", { target: target("eisenfurt") });
    stage.fire("click", { target: target(null) });
    expect(calls).toEqual(["tap eisenfurt"]);
  });

  it("a drag pans from the start viewport, captures the pointer once, and the click after it does nothing", () => {
    const { stage, shown, pointer, calls } = setup();
    pointer("pointerdown", 1, 10, 10, 0);
    pointer("pointermove", 1, 15, 10, 10); // within the tap distance: no pan yet
    expect(shown).toEqual([]);
    pointer("pointermove", 1, 40, 30, 20);
    pointer("pointermove", 1, 50, 30, 30);
    expect(shown.at(-1)).toEqual({ scale: 1, tx: 40, ty: 20 });
    expect(stage.captured).toEqual([1]);
    pointer("pointerup", 1, 50, 30, 40);
    stage.fire("click", { target: target("eisenfurt") });
    expect(calls).toEqual([]);
  });

  it("ignores a right mouse button", () => {
    const { shown, pointer } = setup();
    pointer("pointerdown", 1, 10, 10, 0, { pointerType: "mouse", button: 2 });
    pointer("pointermove", 1, 80, 80, 10);
    expect(shown).toEqual([]);
  });

  it("two taps on open sea zoom in at the tap; taps on a territory do not count", () => {
    const { shown, pointer } = setup();
    const tap = (x: number, t: number, tid: string | null = null) => {
      pointer("pointerdown", 1, x, 20, t);
      pointer("pointerup", 1, x, 20, t + 50, { target: target(tid) });
    };
    tap(30, 0, "eisenfurt");
    tap(30, 100, "eisenfurt");
    expect(shown).toEqual([]);
    tap(30, 1000);
    tap(32, 1150);
    expect(shown).toEqual([{ scale: 2, tx: 32, ty: 20 }]);
    // the pair is used up: a third tap starts a new pair
    tap(32, 1300);
    expect(shown).toHaveLength(1);
  });

  it("a cancelled pointer ends its gesture without a tap", () => {
    const { shown, pointer } = setup();
    pointer("pointerdown", 1, 30, 20, 0);
    pointer("pointercancel", 1, 30, 20, 10);
    pointer("pointerdown", 2, 30, 20, 20);
    pointer("pointerup", 2, 30, 20, 60);
    expect(shown).toEqual([]);
  });

  it("the wheel zooms at the pointer and stops the page from scrolling", () => {
    const { stage, calls } = setup();
    const prevented = stage.fire("wheel", {
      deltaY: -100,
      ctrlKey: false,
      clientX: 160,
      clientY: 90,
    });
    expect(prevented).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatch(/^zoom \d+\.\d+ 60,40$/);
  });

  it("keys on the map zoom, fit and pan; keys elsewhere are left alone", () => {
    const { stage, calls, shown } = setup();
    expect(stage.fire("keydown", { key: "+", target: stage.el })).toBe(true);
    expect(stage.fire("keydown", { key: "0", target: stage.el })).toBe(true);
    stage.fire("keydown", { key: "ArrowLeft", target: stage.el });
    expect(stage.fire("keydown", { key: "+", target: {} })).toBe(false);
    expect(stage.fire("keydown", { key: "x", target: stage.el })).toBe(false);
    expect(calls[0]).toMatch(/^zoom \d+\.\d+ center$/);
    expect(calls[1]).toBe("fit");
    expect(calls).toHaveLength(2);
    expect(shown).toHaveLength(1);
    expect(shown[0]!.tx).not.toBe(0);
  });

  it("stops Safari's own pinch", () => {
    const { stage } = setup();
    for (const t of ["gesturestart", "gesturechange", "gestureend"])
      expect(stage.fire(t, {})).toBe(true);
  });
});
