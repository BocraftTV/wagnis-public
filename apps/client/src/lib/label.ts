// Territory name labels: line breaking and the screen box, shared by the component and the layout tests.
import type { Rect } from "./geometry.js";
import type { Point } from "./viewport.js";

export type LabelAlign = "start" | "middle" | "end";

export interface LabelSpec {
  /** Offset of the text anchor from the territory anchor, in screen px (the label keeps its size at any zoom). */
  dx: number;
  /** Offset of the top edge of the text block, in screen px. */
  dy: number;
  align: LabelAlign;
  /** Draw a thin line from the label to the anchor (for labels outside the territory). */
  leader?: boolean;
}

/** Territory label font size and line height in screen px, and a conservative average character width (serif). */
export const LABEL_FONT_PX = 13;
export const LABEL_LINE_PX = 15;
export const LABEL_CHAR_PX = 7.3;

/**
 * Continent labels: bold capitals, 12 px, letter-spacing 0.14 em, with the bonus badge to the right. The width per
 * character is a cautious upper bound (system serif fonts differ), so tests never rely on the real font.
 */
export const CONTINENT_FONT_PX = 12;
export const CONTINENT_LINE_PX = 14;
export const CONTINENT_CHAR_PX = 10.6;
export const BADGE_PX = 18;
export const BADGE_GAP_PX = 4;
const CONTINENT_BREAK_FROM = 14;

const BREAK_FROM = 12;

/** Names up to 12 characters stay on one line; longer ones break at the space nearest the middle. */
export function labelLines(name: string): string[] {
  if (name.length <= BREAK_FROM) return [name];
  const middle = name.length / 2;
  let best = -1;
  for (let i = 0; i < name.length; i++) {
    if (name[i] === " " && (best < 0 || Math.abs(i - middle) < Math.abs(best - middle))) best = i;
  }
  return best < 0 ? [name] : [name.slice(0, best), name.slice(best + 1)];
}

/** Screen size of a label block (px). */
export function labelSize(name: string): { width: number; height: number } {
  const lines = labelLines(name);
  const longest = Math.max(...lines.map((l) => l.length));
  return { width: longest * LABEL_CHAR_PX, height: lines.length * LABEL_LINE_PX };
}

/** Label box in map units at `scale` (px per map unit). */
export function labelBox(anchor: Point, spec: LabelSpec, name: string, scale: number): Rect {
  const { width, height } = labelSize(name);
  const x = anchor.x + spec.dx / scale;
  const left =
    spec.align === "start" ? x : spec.align === "end" ? x - width / scale : x - width / (2 * scale);
  const top = anchor.y + spec.dy / scale;
  return { left, top, right: left + width / scale, bottom: top + height / scale };
}

/** Continent names up to 14 characters stay on one line; longer ones break at the space nearest the middle. */
export function continentLabelLines(name: string): string[] {
  if (name.length <= CONTINENT_BREAK_FROM) return [name];
  const middle = name.length / 2;
  let best = -1;
  for (let i = 0; i < name.length; i++) {
    if (name[i] === " " && (best < 0 || Math.abs(i - middle) < Math.abs(best - middle))) best = i;
  }
  return best < 0 ? [name] : [name.slice(0, best), name.slice(best + 1)];
}

/** Width of the text block of a continent label (screen px, upper bound), without the badge. */
export function continentLabelWidth(lines: readonly string[]): number {
  return Math.max(...lines.map((l) => l.length)) * CONTINENT_CHAR_PX;
}

/** Screen size of a whole continent label: text block and badge, centered on the label point. */
export function continentLabelSize(name: string): { width: number; height: number } {
  const lines = continentLabelLines(name);
  return {
    width: continentLabelWidth(lines) + BADGE_GAP_PX + BADGE_PX,
    height: Math.max(lines.length * CONTINENT_LINE_PX, BADGE_PX),
  };
}
