import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getMap } from "@wagnis/engine";
import type { GameState, Rng } from "@wagnis/engine";
import type { RoomView } from "@wagnis/shared";
import { hashToken } from "./crypto.js";
import { loadState } from "./state.js";
import { Store } from "./store.js";
import {
  CREATE_CODE,
  type Identity,
  TestClient,
  type TestServer,
  makeTmpDir,
  removeDir,
  startServer,
} from "./test-helpers.js";

/** A real Phase-3 state saved by the Phase-3 server (apps/server/fixtures/README.md). */
const fixture = (name: string): string =>
  readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), "utf8");

const noRng: Rng = {
  int: () => {
    throw new Error("rng used");
  },
};

const ROOM = "K7M2XQ";
let dir: string;
let dbPath: string;
let srv: TestServer | undefined;
const clients: TestClient[] = [];
const logLines: string[] = [];

beforeEach(() => {
  dir = makeTmpDir();
  dbPath = `${dir}/db.sqlite`;
  logLines.length = 0;
});
afterEach(async () => {
  clients.splice(0).forEach((c) => c.close());
  await srv?.close();
  srv = undefined;
  removeDir(dir);
});

/** Puts the fixture row into a fresh database exactly as it is, with one seat and token per player id. */
function seedRoom(
  json: string,
  status: "playing" | "finished" = "playing",
): { ids: Identity[]; names: string[] } {
  const order = (JSON.parse(json) as { playerOrder: string[] }).playerOrder;
  const store = new Store(dbPath);
  const ids: Identity[] = order.map((playerId, i) => ({
    roomId: ROOM,
    playerId,
    token: `fixture-token-${i}-${playerId.slice(0, 8)}`,
  }));
  const names = order.map((_, i) => `Spieler${i + 1}`);
  store.createRoom(
    ROOM,
    "testland",
    { id: ids[0]!.playerId, name: names[0]!, tokenHash: hashToken(ids[0]!.token) },
    Date.now(), // the cleanup at the server start deletes rooms idle for 48 hours, so the seed is fresh
  );
  for (let i = 1; i < ids.length; i++) {
    store.addPlayer(
      ROOM,
      { id: ids[i]!.playerId, name: names[i]!, tokenHash: hashToken(ids[i]!.token) },
      Date.now(),
    );
  }
  store.close();
  const db = new Database(dbPath);
  db.prepare("UPDATE rooms SET status = ?, state_json = ? WHERE id = ?").run(status, json, ROOM);
  db.close();
  return { ids, names };
}

const rawRow = (): string => {
  const db = new Database(dbPath, { readonly: true });
  try {
    return (
      db.prepare("SELECT state_json FROM rooms WHERE id = ?").get(ROOM) as { state_json: string }
    ).state_json;
  } finally {
    db.close();
  }
};

/**
 * The whole room row except `last_activity_at`: a connection counts as activity for the cleanup (plan 007, 4.5), so
 * that one bookkeeping column moves when a client says hello; state, status and version must not.
 */
const rowDump = (): string => {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare("SELECT * FROM rooms WHERE id = ?").get(ROOM) as Record<string, unknown>;
    delete row["last_activity_at"];
    return JSON.stringify(row);
  } finally {
    db.close();
  }
};

async function start(): Promise<TestServer> {
  srv = await startServer(dbPath, {
    logger: { level: "info", stream: { write: (line: string) => void logLines.push(line) } },
  });
  return srv;
}

async function connect(id: Identity): Promise<TestClient> {
  const c = await TestClient.connect(srv!, id);
  clients.push(c);
  return c;
}

describe.each(["phase3-3p", "phase3-2p"])("Phase-3 fixture %s (question 19)", (name) => {
  it("is a real Phase-3 row: no stateVersion, no victoryMode, no tokens or create code", () => {
    const text = fixture(name);
    const raw = JSON.parse(text) as Record<string, any>;
    expect(raw["stateVersion"]).toBeUndefined();
    expect(raw["winReason"]).toBeUndefined();
    expect(raw["rules"].victoryMode).toBeUndefined();
    expect(raw["secret"].originalMission).toBeUndefined();
    expect(raw["phase"]).toBe("attack");
    expect(text).not.toMatch(/token|createCode|hash/i);
  });

  it("loads through the real load path as domination, v10, written back once", () => {
    const text = fixture(name);
    const { ids } = seedRoom(text);
    const store = new Store(dbPath);
    const room = store.getRoom(ROOM)!;
    const first = loadState(store, room, noRng);
    expect(first.ok).toBe(true);
    if (!first.ok || !first.state) throw new Error("not loaded");
    const state = first.state;
    expect(state.stateVersion).toBe(10);
    expect(state.removedPlayerIds).toEqual([]);
    expect(state.rules.victoryMode).toBe("domination");
    expect(state.winReason).toBeNull();
    for (const p of state.playerOrder) {
      expect(state.secret.mission[p]).toBeNull();
      expect(state.secret.originalMission[p]).toBeNull();
      expect(state.secret.missionReplaced[p]).toBe(false);
    }
    expect(Object.values(state.territories).every((t) => t.ownerId !== null)).toBe(true);
    expect(Object.values(state.territories).length).toBe(8);
    expect(ids.length).toBe(state.playerOrder.length);

    const written = rawRow();
    expect(JSON.parse(written)).toEqual(JSON.parse(JSON.stringify(state)));
    expect((JSON.parse(written) as GameState).stateVersion).toBe(10);
    // Second load: no further write and no Rng
    const second = loadState(store, store.getRoom(ROOM)!, noRng);
    expect(second.ok && second.state).toEqual(state);
    expect(rawRow()).toBe(written);
    store.close();
  });

  it("then accepts actions over WebSocket: snapshots with rising version, no neutral, no missions, hands hidden", async () => {
    const text = fixture(name);
    const raw = JSON.parse(text) as GameState;
    const { ids } = seedRoom(text);
    await start();
    const cs = await Promise.all(ids.map(connect));
    const byId = new Map(ids.map((id, i) => [id.playerId, cs[i]!]));
    const first = await Promise.all(cs.map((c) => c.latestView((v) => v.game !== null)));
    const version = first[0]!.version;
    expect(first.every((v) => v.game!.winnerId === null && v.game!.phase === "attack")).toBe(true);
    for (const v of first) {
      expect(Object.values(v.game!.territories).every((t) => t.ownerId !== null)).toBe(true);
      expect(v.game!.secret.mission).toBeNull();
    }
    // Hidden hands: no card of another player appears on a connection (counts are public)
    ids.forEach((id, i) => {
      const wire = cs[i]!.raw.join("\n");
      for (const [other, hand] of Object.entries(raw.secret.hand)) {
        if (other === id.playerId) continue;
        for (const card of hand) expect(wire, `${card} of ${other}`).not.toContain(card);
      }
    });

    const active = byId.get(raw.activePlayerId)!;
    const map = getMap("testland")!;
    const view = first[0]!.game!;
    let pick: { from: string; to: string } | undefined;
    for (const [from, t] of Object.entries(view.territories)) {
      if (t.ownerId !== raw.activePlayerId || (t.maxAttackDice ?? 0) < 1) continue;
      const to = map.territories
        .find((x) => x.id === from)!
        .neighbors.find((n) => view.territories[n]!.ownerId !== raw.activePlayerId);
      if (to) pick = { from, to };
    }
    expect(pick, "the fixture offers an attack").toBeDefined();
    const act = (c: TestClient, action: unknown) => c.send({ type: "action", action });
    const last = async (pred: (v: RoomView) => boolean) => active.nextView(pred);

    act(active, { type: "attack", ...pick!, dice: 1 });
    const afterAttack = await last((v) => v.game!.lastCombat !== null && v.version === version + 1);
    expect(afterAttack.game!.lastCombat!.seq).toBe(raw.combatSeq + 1);
    let expected = version + 1;
    if (afterAttack.game!.pendingOccupation) {
      act(active, { type: "occupy", count: afterAttack.game!.pendingOccupation.min });
      expected++;
      await last((v) => v.version === expected);
    }
    act(active, { type: "endPhase" });
    expected++;
    await last((v) => v.version === expected && v.game!.phase === "fortify");
    act(active, { type: "endPhase" });
    expected++;
    const next = await last((v) => v.version === expected && v.game!.phase === "reinforce");
    expect(next.game!.turn).toBe(raw.turn + 1);
    const nextActive = byId.get(next.game!.activePlayerId)!;
    const mine = Object.entries(next.game!.territories).find(
      ([, t]) => t.ownerId === next.game!.activePlayerId,
    )![0];
    act(nextActive, { type: "placeArmies", territoryId: mine, count: 1 });
    expected++;
    const placed = await nextActive.nextView((v) => v.version === expected);
    expect(placed.game!.reinforcementsLeft).toBe(next.game!.reinforcementsLeft - 1);
    for (const c of cs) {
      expect(c.messages.filter((m) => m.type === "error")).toEqual([]);
      for (const v of c.views().filter((x) => x.game)) {
        expect(Object.values(v.game!.territories).every((t) => t.ownerId !== null)).toBe(true);
        expect(v.game!.secret.mission).toBeNull();
      }
    }
  });
});

describe("a stored state with a newer or invalid version (question 19)", () => {
  const withVersion = (value: unknown): string => {
    const raw = JSON.parse(fixture("phase3-3p")) as Record<string, unknown>;
    raw["stateVersion"] = value;
    return JSON.stringify(raw);
  };

  it.each([
    [11, "STATE_VERSION_UNSUPPORTED", 11],
    ["4", "STATE_VERSION_INVALID", null],
    [3.5, "STATE_VERSION_INVALID", 3.5],
  ] as const)(
    "stateVersion %j: loadState rejects with %s, the row stays byte-identical",
    (value, code, found) => {
      seedRoom(withVersion(value));
      const before = rowDump();
      const store = new Store(dbPath);
      const result = loadState(store, store.getRoom(ROOM)!, noRng);
      expect(result).toEqual({ ok: false, code, found });
      store.close();
      expect(rowDump()).toBe(before);
    },
  );

  it("answers hello and actions with STATE_UNSUPPORTED only; the row stays; log and message hold no state data", async () => {
    const json = withVersion(11);
    const raw = JSON.parse(json) as GameState;
    const { ids } = seedRoom(json);
    const before = rowDump();
    await start();
    const c = await connect(ids[0]!);
    await c.waitFor(() => c.messages.find((m) => m.type === "error"));
    c.send({
      type: "action",
      reqId: "r1",
      action: { type: "placeArmies", territoryId: "eisenfurt", count: 1 },
    });
    await c.waitFor(() => (c.raw.length >= 2 ? true : undefined));
    expect(c.raw).toEqual([
      JSON.stringify({ type: "error", code: "STATE_UNSUPPORTED" }),
      JSON.stringify({ type: "error", code: "STATE_UNSUPPORTED", reqId: "r1" }),
    ]);
    expect(c.views()).toEqual([]);
    expect(rowDump()).toBe(before);

    const logs = logLines.join("\n");
    expect(logs).toContain("STATE_VERSION_UNSUPPORTED");
    // Everything the fixture knows must be absent: ids, cards, tokens, the create code
    const secrets = [
      ...raw.playerOrder,
      ...Object.values(raw.secret.hand).flat(),
      ...raw.secret.deck,
      ...ids.map((i) => i.token),
      ...ids.map((i) => hashToken(i.token)),
      CREATE_CODE,
    ];
    for (const s of secrets) {
      expect(logs, s).not.toContain(s);
      expect(c.raw.join("\n"), s).not.toContain(s);
    }
  });
});
