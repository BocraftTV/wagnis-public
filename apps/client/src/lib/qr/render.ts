import type { Matrix } from "./matrix.js";

/** Quiet zone around the symbol, in modules (the standard asks for 4). */
export const QUIET_ZONE = 4;

/** Edge length in modules including the quiet zone. */
export function symbolModules(matrix: Matrix, quiet: number = QUIET_ZONE): number {
  return matrix.length + 2 * quiet;
}

/** One SVG path for all dark modules: each horizontal run of dark modules becomes `M x y h n v1 h-n z`. */
export function matrixPath(matrix: Matrix, quiet: number = QUIET_ZONE): string {
  const parts: string[] = [];
  matrix.forEach((row, y) => {
    let x = 0;
    while (x < row.length) {
      if (!row[x]) {
        x++;
        continue;
      }
      let end = x;
      while (end < row.length && row[end]) end++;
      parts.push(`M${x + quiet} ${y + quiet}h${end - x}v1h-${end - x}z`);
      x = end;
    }
  });
  return parts.join("");
}

/** Whole pixels per module so that the symbol, quiet zone included, fits into `available`; at least 1. */
export function moduleSize(available: number, modules: number): number {
  return Math.max(1, Math.floor(available / modules));
}
