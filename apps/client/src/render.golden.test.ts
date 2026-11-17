/// <reference types="node" />
// Plan 016, step 0: golden test of the client. `Game.svelte` and `Lobby.svelte` are rendered with `svelte/server` for
// the fixed views in `golden/views.json` (made by `scripts/make-golden-views.mjs` from real engine games). The HTML is
// compared without the Svelte scope classes (`svelte-xxxx`), and, apart from it, the compiled CSS of every component
// as a set of rules. The hashes were made on the code before the refactoring and are checked in.
// Effects do not run on the server; the screenshot comparison of plan 016 covers what they show.
// Regenerate only on purpose: `GOLDEN_WRITE=1 npx vitest run src/render.golden.test.ts`.
// `GOLDEN_DUMP=<dir>` writes every rendered page there, to compare two versions by hand.
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { compile } from "svelte/compiler";
import { render } from "svelte/server";
import { describe, expect, it } from "vitest";
import type { RoomView } from "@wagnis/shared";
import { GameConnection } from "./lib/connection.svelte.js";
import Game from "./views/Game.svelte";
import Lobby from "./views/Lobby.svelte";

const FILE = new URL("./golden/render.hashes.json", import.meta.url);
const WRITE = process.env["GOLDEN_WRITE"] === "1";
const DUMP = process.env["GOLDEN_DUMP"];

interface Fixture {
  games: Record<string, { from: string; view: RoomView }>;
  lobbies: Record<string, RoomView>;
}
const fixture = JSON.parse(
  readFileSync(new URL("./golden/views.json", import.meta.url), "utf8"),
) as Fixture;

// The views read the page address (QR code, room link); everything else of the browser only runs in effects.
(globalThis as { location?: unknown }).location = new URL("http://192.168.1.20:5173/r/K7M2XQ");

const conn = (notice: string | null = null): GameConnection => {
  const c = new GameConnection(() => {}, {
    createSocket: () => {
      throw new Error("no socket in the golden test");
    },
    wsUrl: () => "",
    setTimer: () => 0,
    clearTimer: () => {},
  });
  c.notice = notice;
  return c;
};

// Scope classes and the hydration markers (`<!--[-->`, `<!---->`) change with every component boundary, not the page.
const stripScope = (html: string): string =>
  html
    .replace(/\s*\bsvelte-[a-z0-9]+\b/g, "")
    .replace(/ class=""/g, "")
    .replace(/<!--(\[-?\d*|\]|)-->/g, "");
const sha = (text: string): string => createHash("sha256").update(text).digest("hex");

function page(name: string, html: string): string {
  const clean = stripScope(html);
  if (DUMP) {
    mkdirSync(DUMP, { recursive: true });
    writeFileSync(join(DUMP, name.replace(/[^a-z0-9]+/gi, "_") + ".html"), clean);
  }
  return sha(clean);
}

/** Every top-level rule (and every rule inside an at-rule) as `selector{declarations}`, without scope classes. */
function cssRules(css: string): string[] {
  const out: string[] = [];
  const text = css.replace(/\/\*[\s\S]*?\*\//g, "");
  const walk = (src: string, prefix: string) => {
    let i = 0;
    while (i < src.length) {
      const open = src.indexOf("{", i);
      if (open < 0) break;
      const head = src.slice(i, open).trim();
      let depth = 1;
      let j = open + 1;
      while (j < src.length && depth > 0) {
        if (src[j] === "{") depth++;
        else if (src[j] === "}") depth--;
        j++;
      }
      const body = src.slice(open + 1, j - 1);
      if (head.startsWith("@media") || head.startsWith("@supports"))
        walk(body, `${prefix}${head}>`);
      else {
        const decls = body
          .split(";")
          .map((d) => d.trim().replace(/\s+/g, " "))
          .filter(Boolean)
          .join(";");
        const selector = head
          .replace(/:where\(\.svelte-[a-z0-9]+\)/g, "")
          .replace(/\.svelte-[a-z0-9]+/g, "")
          .replace(/\s+/g, " ");
        out.push(`${prefix}${selector}{${decls}}`);
      }
      i = j;
    }
  };
  walk(text, "");
  return out;
}

function componentCss(): string[] {
  const dirs = ["views", "components"].map((d) => new URL(`./${d}/`, import.meta.url).pathname);
  const rules = new Set<string>();
  for (const dir of dirs) {
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".svelte"))) {
      const source = readFileSync(join(dir, file), "utf8");
      const { css } = compile(source, { filename: file, css: "external" });
      for (const rule of cssRules(css?.code ?? "")) rules.add(rule);
    }
  }
  return [...rules].sort();
}

describe("golden: the client renders the same as before the refactoring (plan 016)", () => {
  const expected: Record<string, string> = existsSync(FILE)
    ? (JSON.parse(readFileSync(FILE, "utf8")) as Record<string, string>)
    : {};
  const actual: Record<string, string> = {};
  const check = (key: string, value: string) => {
    actual[key] = value;
    if (!WRITE) expect(value, key).toBe(expected[key]);
  };

  for (const [name, { view }] of Object.entries(fixture.games)) {
    it(`game: ${name}`, () => {
      const r = render(Game, { props: { view, game: view.game!, conn: conn() } });
      check(`game: ${name}`, page(`game ${name}`, r.head + r.body));
    });
  }
  it("game: with a notice", () => {
    const { view } = fixture.games["attack, after a combat"]!;
    const r = render(Game, { props: { view, game: view.game!, conn: conn("Nicht erlaubt.") } });
    check("game: with a notice", page("game notice", r.head + r.body));
  });
  it("game: mission choice with a notice", () => {
    const { view } = fixture.games["mission choice"]!;
    const r = render(Game, { props: { view, game: view.game!, conn: conn("Schon gewählt.") } });
    check("game: mission choice with a notice", page("game choice notice", r.head + r.body));
  });
  for (const [name, view] of Object.entries(fixture.lobbies)) {
    it(`lobby: ${name}`, () => {
      const r = render(Lobby, { props: { view, conn: conn() } });
      check(`lobby: ${name}`, page(`lobby ${name}`, r.head + r.body));
    });
  }
  it("lobby: with a notice", () => {
    const r = render(Lobby, {
      props: { view: fixture.lobbies["host, 3 players, defaults"]!, conn: conn("Fehler.") },
    });
    check("lobby: with a notice", page("lobby notice", r.head + r.body));
  });

  it("css of views and components, as a set of rules", () => {
    const rules = componentCss();
    if (DUMP) writeFileSync(join(DUMP, "css.txt"), rules.join("\n") + "\n");
    expect(rules.length).toBeGreaterThan(100);
    check("css", sha(rules.join("\n")));
  });

  it("writes the hashes on request", () => {
    if (WRITE) writeFileSync(FILE, JSON.stringify(actual, null, 2) + "\n");
    expect(Object.keys(fixture.games).length).toBeGreaterThan(20);
  });
});
