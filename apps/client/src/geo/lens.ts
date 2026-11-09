// Magnifying lens: a smooth, invertible radial stretch around a centre. Every territory passes through the same
// mapping, so shared borders stay identical. r' = r * (1 + (f - 1) * (1 - (r/R)^2)^2) for r < R, identity outside.
import type { Pt } from "./project.js";

export interface Lens {
  center: Pt;
  /** Radius of influence in map units. */
  radius: number;
  /** Maximum stretch at the centre; must stay below 2.25 so that the mapping has no fold. */
  factor: number;
}

export function applyLens(p: Pt, lens: Lens): Pt {
  const dx = p[0] - lens.center[0];
  const dy = p[1] - lens.center[1];
  const r = Math.hypot(dx, dy);
  if (r >= lens.radius || r === 0) return p;
  const t = r / lens.radius;
  const k = 1 + (lens.factor - 1) * (1 - t * t) ** 2;
  return [lens.center[0] + dx * k, lens.center[1] + dy * k];
}

export function applyLenses(p: Pt, lenses: readonly Lens[]): Pt {
  let q = p;
  for (const lens of lenses) q = applyLens(q, lens);
  return q;
}

/** Smallest value of dr'/dr and r'/r over the lens (both must be positive: no fold, no mirroring). */
export function lensMinDerivative(lens: Lens): number {
  let min = Infinity;
  for (let i = 0; i <= 1000; i++) {
    const t = i / 1000;
    const radial = 1 + (lens.factor - 1) * (1 - t * t) * (1 - 5 * t * t);
    const tangential = 1 + (lens.factor - 1) * (1 - t * t) ** 2;
    min = Math.min(min, radial, tangential);
  }
  return min;
}
