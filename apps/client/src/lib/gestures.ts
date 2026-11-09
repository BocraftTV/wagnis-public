// Pointer gestures on the map as a small state machine without DOM access: one finger taps or pans, two fingers
// pinch. The component feeds in pointer positions and applies the viewports that come out.
import { isTap, pan, pinch, TAP_THRESHOLDS } from "./viewport.js";
import type { Point, PointerSample, TapThresholds, Viewport } from "./viewport.js";

export interface MoveResult {
  viewport: Viewport;
  /** The pointer is part of a drag or pinch: the component captures it now. */
  dragging: boolean;
}

export interface UpResult {
  /** A short press that did not move: a tap. */
  tap: boolean;
}

interface Finger {
  start: PointerSample;
  cur: Point;
}

const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);

export class GestureTracker {
  /** True after a drag, a pinch or a press that is no tap: the click that follows must not select a territory. */
  suppressClick = false;

  private fingers = new Map<number, Finger>();
  private mode: "idle" | "press" | "pan" | "pinch" = "idle";
  private startViewport: Viewport = { scale: 1, tx: 0, ty: 0 };
  private startPair: [Point, Point] | null = null;
  private readonly limit: (v: Viewport) => Viewport;
  private readonly thresholds: TapThresholds;

  constructor(limit: (v: Viewport) => Viewport, thresholds: TapThresholds = TAP_THRESHOLDS) {
    this.limit = limit;
    this.thresholds = thresholds;
  }

  down(id: number, sample: PointerSample, viewport: Viewport): void {
    if (this.fingers.size === 0) this.suppressClick = false;
    if (this.fingers.size >= 2) return;
    this.fingers.set(id, { start: sample, cur: { x: sample.x, y: sample.y } });
    this.startViewport = viewport;
    if (this.fingers.size === 1) {
      this.mode = "press";
    } else {
      this.mode = "pinch";
      this.suppressClick = true;
      this.startPair = this.pair();
    }
  }

  move(id: number, p: Point): MoveResult | null {
    const f = this.fingers.get(id);
    if (!f) return null;
    f.cur = { x: p.x, y: p.y };
    if (this.mode === "pinch" && this.startPair) {
      const now = this.pair();
      return {
        viewport: this.limit(pinch(this.startViewport, this.startPair, now)),
        dragging: true,
      };
    }
    if (this.mode === "press" && dist(f.start, f.cur) > this.thresholds.distance) {
      this.mode = "pan";
      this.suppressClick = true;
    }
    if (this.mode === "pan") {
      return {
        viewport: this.limit(pan(this.startViewport, f.cur.x - f.start.x, f.cur.y - f.start.y)),
        dragging: true,
      };
    }
    return null;
  }

  /** `viewport` is the current one: a finger left over after a pinch continues as a pan from there. */
  up(id: number, sample: PointerSample, viewport: Viewport): UpResult {
    const f = this.fingers.get(id);
    if (!f) return { tap: false };
    this.fingers.delete(id);
    if (this.mode === "pinch") {
      const rest = [...this.fingers.values()][0];
      if (rest) {
        this.mode = "pan";
        this.startViewport = viewport;
        rest.start = { x: rest.cur.x, y: rest.cur.y, t: sample.t };
      } else this.mode = "idle";
      return { tap: false };
    }
    const tap = this.mode === "press" && isTap(f.start, sample, this.thresholds);
    if (!tap) this.suppressClick = true;
    this.mode = "idle";
    return { tap };
  }

  private pair(): [Point, Point] {
    const [a, b] = [...this.fingers.values()];
    return [a!.cur, b!.cur];
  }
}

export const DOUBLE_TAP = { distance: 30, duration: 300 } as const;

/** Two taps on the open sea close together in time and place. */
export function isDoubleTap(prev: PointerSample | null, cur: PointerSample): boolean {
  return (
    prev !== null && cur.t - prev.t <= DOUBLE_TAP.duration && dist(prev, cur) <= DOUBLE_TAP.distance
  );
}

/** Zoom factor for a mouse wheel or trackpad pinch (browsers report a pinch as a wheel with ctrlKey). */
export function wheelFactor(deltaY: number, ctrlKey: boolean): number {
  return Math.exp(-deltaY * (ctrlKey ? 0.01 : 0.002));
}

export type KeyAction =
  { kind: "zoom"; factor: number } | { kind: "pan"; dx: number; dy: number } | { kind: "fit" };

const KEY_STEP = 80;

export function keyAction(key: string): KeyAction | null {
  switch (key) {
    case "+":
    case "=":
      return { kind: "zoom", factor: 1.5 };
    case "-":
    case "_":
      return { kind: "zoom", factor: 1 / 1.5 };
    case "0":
      return { kind: "fit" };
    case "ArrowLeft":
      return { kind: "pan", dx: KEY_STEP, dy: 0 };
    case "ArrowRight":
      return { kind: "pan", dx: -KEY_STEP, dy: 0 };
    case "ArrowUp":
      return { kind: "pan", dx: 0, dy: KEY_STEP };
    case "ArrowDown":
      return { kind: "pan", dx: 0, dy: -KEY_STEP };
    default:
      return null;
  }
}
