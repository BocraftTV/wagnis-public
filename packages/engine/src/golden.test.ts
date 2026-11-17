// Plan 016, step 0: golden test. Random games over the real engine in every kind of game; a SHA-256 over every step
// (action, state after, events, `viewFor` for every player) and over the answers to random, mostly illegal actions.
// The hashes were made on the code before the refactoring (plan 016) and are checked in: any change in the output,
// in the order of the Rng calls or in the order of the rule checks turns this test red.
// Regenerate only on purpose (a deliberate rule change): `GOLDEN_WRITE=1 npx vitest run src/golden.test.ts`.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyAction,
  applyHostAction,
  createGame,
  createSeededRng,
  testland,
  testlandRules,
  viewFor,
  welt,
  weltRules,
} from "./index.js";
import type {
  Action,
  GameState,
  HostAction,
  MapDefinition,
  PlayerId,
  Rng,
  RuleConfig,
  TeamId,
  TeamMode,
} from "./index.js";
import { playRandomGame } from "./playbot.js";

const FILE = new URL("./golden.hashes.json", import.meta.url);
const WRITE = process.env.GOLDEN_WRITE === "1";
const ids = ["p1", "p2", "p3", "p4", "p5", "p6"];

interface Scenario {
  name: string;
  map: MapDefinition;
  players: number;
  rules: RuleConfig;
  seeds: number[];
  hostRate?: number;
  aggression?: number;
  maxActions?: number;
}

/** Team assignment in seat order: A gets p1, B p2, (C p3,) A the next one, and so on. */
function teamsFor(mode: TeamMode, n: number): Partial<Record<TeamId, PlayerId[]>> | undefined {
  if (mode === null) return undefined;
  const count = mode === "2v2v2" ? 3 : 2;
  const teams: Partial<Record<TeamId, PlayerId[]>> = {};
  const names: TeamId[] = ["A", "B", "C"];
  for (let i = 0; i < n; i++) (teams[names[i % count]!] ??= []).push(ids[i]!);
  return teams;
}

function scenarios(): Scenario[] {
  const list: Scenario[] = [];
  const seeds = [1, 2, 3];
  for (const [mapName, map, base] of [
    ["testland", testland, testlandRules],
    ["welt", welt, weltRules],
  ] as const) {
    for (let n = 2; n <= 6; n++) {
      for (const victoryMode of ["missions", "domination"] as const) {
        list.push({
          name: `${mapName} ${n}p ${victoryMode}`,
          map,
          players: n,
          rules: { ...base, victoryMode },
          seeds,
        });
      }
      list.push({
        name: `${mapName} ${n}p two fortify moves, host`,
        map,
        players: n,
        rules: { ...base, fortifyMoves: 2 },
        seeds,
        hostRate: 0.03,
      });
      list.push({
        name: `${mapName} ${n}p adjacent, two moves`,
        map,
        players: n,
        rules: { ...base, fortifyReach: "adjacent", fortifyMoves: 2, victoryMode: "domination" },
        seeds,
      });
      list.push({
        name: `${mapName} ${n}p draft, hold to win`,
        map,
        players: n,
        rules: { ...base, missionDraft: true, holdToWin: true },
        seeds,
        hostRate: 0.02,
      });
      list.push({
        name: `${mapName} ${n}p draft`,
        map,
        players: n,
        rules: { ...base, missionDraft: true },
        seeds,
      });
      list.push({
        name: `${mapName} ${n}p hold to win`,
        map,
        players: n,
        rules: { ...base, holdToWin: true },
        seeds,
      });
      list.push({
        name: `${mapName} ${n}p world events`,
        map,
        players: n,
        rules: { ...base, worldEvents: true },
        seeds,
        hostRate: 0.02,
      });
      list.push({
        name: `${mapName} ${n}p round limit 8, events`,
        map,
        players: n,
        rules: {
          ...base,
          roundLimit: 8,
          worldEvents: n % 2 === 0,
          victoryMode: n % 2 === 0 ? "missions" : "domination",
        },
        seeds,
        aggression: 0.2,
        maxActions: 1500,
      });
    }
    for (const [teams, n] of [
      ["2v2", 4],
      ["3v3", 6],
      ["2v2v2", 6],
    ] as const) {
      for (const victoryMode of ["missions", "domination"] as const) {
        list.push({
          name: `${mapName} teams ${teams} ${victoryMode}`,
          map,
          players: n,
          rules: { ...base, teams, victoryMode },
          seeds,
          hostRate: 0.02,
          maxActions: 800,
        });
      }
      list.push({
        name: `${mapName} teams ${teams} draft, hold, events, two moves`,
        map,
        players: n,
        rules: {
          ...base,
          teams,
          missionDraft: true,
          holdToWin: true,
          worldEvents: true,
          fortifyMoves: 2,
        },
        seeds,
        hostRate: 0.02,
        maxActions: 800,
      });
      list.push({
        name: `${mapName} teams ${teams} round limit 8`,
        map,
        players: n,
        rules: { ...base, teams, roundLimit: 8, worldEvents: true },
        seeds,
        aggression: 0.2,
        maxActions: 1500,
      });
    }
  }
  return list;
}

const json = (value: unknown): string => JSON.stringify(value);

/** What the engine answers, as text: the code of a rejection, a hash of an accepted outcome, or a thrown error. */
function outcome(
  run: () => { ok: true; state: GameState; events: unknown[] } | { ok: false; code: string },
): string {
  try {
    const r = run();
    if (!r.ok) return r.code;
    return (
      "ok:" +
      createHash("sha256").update(json(r.state)).update(json(r.events)).digest("hex").slice(0, 16)
    );
  } catch (e) {
    return "throw:" + (e instanceof Error ? e.message : String(e));
  }
}

/** A random, mostly illegal action: unknown ids, wrong counts, wrong phases, other players. */
function fuzzAction(r: Rng, map: MapDefinition, state: GameState): Action {
  const territoryIds = map.territories.map((t) => t.id);
  const t = (): string =>
    r.int(12) === 0 ? "nirgendwo" : territoryIds[r.int(territoryIds.length)]!;
  const count = (): number => [-1, 0, 1, 2, 3, 5, 50, 1.5][r.int(8)]!;
  const cards = Object.values(state.secret.hand).flat();
  switch (r.int(9)) {
    case 0:
      return { type: "placeArmies", territoryId: t(), count: count() };
    case 1:
      return { type: "attack", from: t(), to: t(), dice: [0, 1, 2, 3, 4][r.int(5)]! };
    case 2:
      return { type: "blitz", from: t(), to: t() };
    case 3:
      return { type: "occupy", count: count() };
    case 4:
      return { type: "fortify", from: t(), to: t(), count: count() };
    case 5: {
      const pick = [0, 1, 2].map(() =>
        cards.length > 0 && r.int(4) > 0 ? cards[r.int(cards.length)]! : "karte-x",
      );
      return r.int(2) === 0
        ? { type: "tradeCards", cardIds: pick }
        : { type: "tradeCards", cardIds: pick, bonusTerritoryId: t() };
    }
    case 6:
      return { type: "chooseMission", index: (r.int(3) === 0 ? 2 : r.int(2)) as 0 | 1 };
    case 7:
      return { type: "endPhase" };
    default:
      return { type: "unbekannt" } as unknown as Action;
  }
}

function fuzzHost(r: Rng, state: GameState): HostAction {
  return r.int(2) === 0
    ? { type: "skipTurn", turn: state.turn + [-1, 0, 0, 1][r.int(4)]! }
    : { type: "removePlayer", playerId: r.int(5) === 0 ? "p9" : ids[r.int(ids.length)]! };
}

function gameHash(s: Scenario, seed: number): string {
  const teams = teamsFor(s.rules.teams, s.players);
  const { start, steps } = playRandomGame({
    seed,
    players: s.players,
    rules: s.rules,
    map: s.map,
    extra: teams ? { teams } : {},
    hostRate: s.hostRate ?? 0,
    aggression: s.aggression ?? 0.9,
    maxActions: s.maxActions ?? 400,
  });
  const players = start.playerOrder;
  const hash = createHash("sha256");
  const viewsOf = (state: GameState): string => json(players.map((p) => viewFor(state, p)));
  hash.update(json(start)).update(viewsOf(start));
  steps.forEach((step, i) => {
    hash.update(json([step.playerId, step.host ?? false, step.action]));
    hash.update(json(step.after)).update(json(step.events)).update(viewsOf(step.after));
    // Random actions on the state before the step, with their own Rng: the codes must come in the same order.
    const fuzz = createSeededRng(seed * 100_003 + i);
    const answers: string[] = [];
    for (let k = 0; k < 6; k++) {
      const playerId = fuzz.int(8) === 0 ? "p9" : ids[fuzz.int(s.players)]!;
      const action = fuzzAction(fuzz, s.map, step.before);
      const rng = createSeededRng(seed + i * 31 + k);
      answers.push(outcome(() => applyAction(step.before, playerId, action, rng)));
    }
    const host = fuzzHost(fuzz, step.before);
    answers.push(outcome(() => applyHostAction(step.before, host, createSeededRng(seed + i))));
    hash.update(json(answers));
  });
  return `${steps.length}:${hash.digest("hex")}`;
}

/** `createGame` with broken input, several faults at once: the first failing check decides the code. */
function setupHashes(): Record<string, string> {
  const out: Record<string, string> = {};
  const r = createSeededRng(4242);
  for (let i = 0; i < 1500; i++) {
    const map = r.int(2) === 0 ? testland : welt;
    const base = map === testland ? testlandRules : weltRules;
    const n = [1, 2, 3, 4, 5, 6, 7][r.int(7)]!;
    const playerIds = ids.concat(["p7"]).slice(0, n);
    if (r.int(10) === 0 && n > 1) playerIds[1] = playerIds[0]!;
    const rules = { ...base } as Record<string, unknown>;
    const faults: [string, unknown][] = [
      ["startArmies", { 2: 1, 3: 1, 4: 1, 5: 1, 6: 1 }],
      ["startArmies", {}],
      ["initialPlacement", "manual"],
      ["fortifyMoves", 3],
      ["missionDraft", "ja"],
      ["holdToWin", 1],
      ["worldEvents", null],
      ["roundLimit", 10],
      ["teams", "4v4"],
      ["teams", ["2v2", "3v3", "2v2v2"][r.int(3)]],
      ["cards", { ...base.cards, mustTradeAt: 4 }],
      ["missionDraft", true],
      ["victoryMode", "domination"],
    ];
    for (const [key, value] of faults) if (r.int(5) === 0) rules[key] = value;
    const teamMode = rules.teams as TeamMode;
    let teams: Partial<Record<TeamId, PlayerId[]>> | undefined;
    if (r.int(3) > 0) {
      const sizes = teamMode === "2v2" ? 4 : 6;
      teams = teamsFor(
        typeof teamMode === "string" && ["2v2", "3v3", "2v2v2"].includes(teamMode)
          ? teamMode
          : "2v2",
        r.int(3) === 0 ? n : sizes,
      );
      if (teams && r.int(4) === 0) teams.C = ["p1"];
    }
    const missions =
      r.int(6) === 0
        ? { missions: [], fallback: { type: "conquerTerritoryCount", count: 3 } }
        : undefined;
    const label = `setup ${i}`;
    out[label] = outcome(
      () =>
        createGame({
          map,
          rules: rules as unknown as RuleConfig,
          playerIds,
          rng: createSeededRng(i),
          missions: missions as never,
          teams,
        }) as never,
    );
  }
  return out;
}

describe("golden: same output as before the refactoring (plan 016)", () => {
  const expected: Record<string, string> = existsSync(FILE)
    ? (JSON.parse(readFileSync(FILE, "utf8")) as Record<string, string>)
    : {};
  const actual: Record<string, string> = {};

  for (const s of scenarios()) {
    it(s.name, () => {
      for (const seed of s.seeds) {
        const key = `${s.name} #${seed}`;
        actual[key] = gameHash(s, seed);
        if (!WRITE) expect(actual[key], key).toBe(expected[key]);
      }
    });
  }

  it("createGame with broken input", () => {
    const got = setupHashes();
    const key = "setup";
    actual[key] = createHash("sha256").update(json(got)).digest("hex");
    if (!WRITE) expect(actual[key]).toBe(expected[key]);
  });

  it("writes the hashes on request", () => {
    if (WRITE) writeFileSync(FILE, JSON.stringify(actual, null, 2) + "\n");
    expect(Object.keys(actual).length).toBeGreaterThan(100);
  });
});
