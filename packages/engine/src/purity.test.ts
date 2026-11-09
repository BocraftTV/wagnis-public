import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory()
      ? sourceFiles(join(dir, e.name))
      : e.name.endsWith(".ts") && !e.name.endsWith(".test.ts")
        ? [join(dir, e.name)]
        : [],
  );
}

describe("engine purity", () => {
  const files = sourceFiles(new URL(".", import.meta.url).pathname);
  const forbidden = [
    /Math\.random/,
    /\bDate\b/,
    /\bprocess\b/,
    /from\s+["']node:/,
    /\bfetch\(/,
    /\bsetTimeout\b/,
    /\bsetInterval\b/,
    /\bconsole\b/,
    /\brequire\(/,
    /\bimport\(/,
    /from\s+["'](fs|path|crypto|os|child_process)["']/,
  ];
  it("finds source files", () => expect(files.length).toBeGreaterThan(5));
  it.each(forbidden.map((re) => [String(re), re] as const))(
    "no %s in engine sources",
    (_name, re) => {
      for (const f of files) expect(readFileSync(f, "utf8"), f).not.toMatch(re);
    },
  );
  it("has no runtime dependencies", () => {
    const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    expect(pkg.dependencies ?? {}).toEqual({});
  });
});
