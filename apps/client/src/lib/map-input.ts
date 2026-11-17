// Pointer, wheel, key and click handling of the map, attached to its stage element. The gestures themselves are worked
// out in gestures.ts and viewport.ts; this only reads the DOM events and passes the results on.
import { GestureTracker, isDoubleTap, keyAction, wheelFactor } from "./gestures.js";
import type { Point, PointerSample, Viewport } from "./viewport.js";

export interface MapInputHandlers {
  /** The viewport as it will be after the pending frame. */
  current(): Viewport;
  /** Shows a viewport (bundled per animation frame by the caller). */
  show(next: Viewport): void;
  /** Keeps a viewport inside the map. */
  limit(next: Viewport): Viewport;
  zoomBy(factor: number, focal?: Point): void;
  fit(): void;
  /** The viewport after a double tap on open sea at `sample`. */
  doubleTap(current: Viewport, sample: PointerSample): Viewport;
  /** A tap on a territory (any element with `data-tid`). */
  tapped(id: string): void;
}

const SAFARI_GESTURES = ["gesturestart", "gesturechange", "gestureend"];

/**
 * Pointer events for touch, pen and mouse. The map has `touch-action: none`, so Safari neither scrolls nor zooms
 * the page there; pointer capture starts only once a drag begins, so taps stay ordinary clicks. Returns the function
 * that removes every listener again.
 */
export function attachMapInput(el: HTMLElement, h: MapInputHandlers): () => void {
  const tracker = new GestureTracker((v) => h.limit(v));
  let lastSeaTap: PointerSample | null = null;
  const local = (e: PointerEvent | WheelEvent): Point => {
    const r = el.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const sample = (e: PointerEvent): PointerSample => ({ ...local(e), t: e.timeStamp });
  const captured = new Set<number>();
  const down = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    tracker.down(e.pointerId, sample(e), h.current());
  };
  const move = (e: PointerEvent) => {
    const r = tracker.move(e.pointerId, local(e));
    if (!r) return;
    if (!captured.has(e.pointerId)) {
      captured.add(e.pointerId);
      try {
        el.setPointerCapture(e.pointerId);
      } catch {
        // The pointer is gone already; the drag ends with its up event.
      }
    }
    h.show(r.viewport);
  };
  const up = (e: PointerEvent) => {
    captured.delete(e.pointerId);
    const smp = sample(e);
    const { tap } = tracker.up(e.pointerId, smp, h.current());
    // A tap on open sea (no territory under it) is half of a double tap.
    if (!tap || (e.target as Element).closest("[data-tid]")) return;
    if (isDoubleTap(lastSeaTap, smp)) {
      lastSeaTap = null;
      h.show(h.doubleTap(h.current(), smp));
    } else lastSeaTap = smp;
  };
  const cancel = (e: PointerEvent) => {
    captured.delete(e.pointerId);
    tracker.up(e.pointerId, { ...sample(e), t: Number.POSITIVE_INFINITY }, h.current());
  };
  const wheel = (e: WheelEvent) => {
    e.preventDefault();
    h.zoomBy(wheelFactor(e.deltaY, e.ctrlKey), local(e));
  };
  // Safari's own pinch events: without this the page itself zooms.
  const stop = (e: Event) => e.preventDefault();
  const key = (e: KeyboardEvent) => {
    if (e.target !== el) return;
    const a = keyAction(e.key);
    if (!a) return;
    e.preventDefault();
    if (a.kind === "zoom") h.zoomBy(a.factor);
    else if (a.kind === "fit") h.fit();
    else {
      const cur = h.current();
      h.show(h.limit({ ...cur, tx: cur.tx + a.dx, ty: cur.ty + a.dy }));
    }
  };
  const click = (e: MouseEvent) => {
    if (tracker.suppressClick) return;
    const id = (e.target as Element).closest("[data-tid]")?.getAttribute("data-tid");
    if (id) h.tapped(id);
  };
  el.addEventListener("pointerdown", down);
  el.addEventListener("pointermove", move);
  el.addEventListener("pointerup", up);
  el.addEventListener("pointercancel", cancel);
  el.addEventListener("wheel", wheel, { passive: false });
  el.addEventListener("keydown", key);
  el.addEventListener("click", click);
  for (const t of SAFARI_GESTURES) el.addEventListener(t, stop, { passive: false });
  return () => {
    el.removeEventListener("pointerdown", down);
    el.removeEventListener("pointermove", move);
    el.removeEventListener("pointerup", up);
    el.removeEventListener("pointercancel", cancel);
    el.removeEventListener("wheel", wheel);
    el.removeEventListener("keydown", key);
    el.removeEventListener("click", click);
    for (const t of SAFARI_GESTURES) el.removeEventListener(t, stop);
  };
}
