import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSeededRng } from "@wagnis/engine";
import type { GameState, Rng } from "@wagnis/engine";
import { hashToken } from "./crypto.js";
import { loadState } from "./state.js";
import { Store } from "./store.js";
import { type Identity, TestClient, makeTmpDir, removeDir, startServer } from "./test-helpers.js";

// Real rows of the server before plan 014 (apps/server/fixtures/README.md), read here and never changed.
interface Fixture {
  schemaMetaVersion: number;
  rooms: {
    label: string;
    room: Record<string, unknown> & {
      id: string;
      status: string;
      map_id: string;
      state_json: unknown;
    };
    players: (Record<string, unknown> & { id: string; name: string; seat: number })[];
  }[];
}
const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/phase9-rooms.json", import.meta.url), "utf8"),
) as Fixture;

const noRng: Rng = {
  int: () => {
    throw new Error("rng used");
  },
};

let dir: string;
let dbPath: string;
beforeEach(() => {
  dir = makeTmpDir();
  dbPath = `${dir}/db.sqlite`;
});
afterEach(() => removeDir(dir));

const rawRow = (id: string): string => {
  const db = new Database(dbPath, { readonly: true });
  try {
    return (
      db.prepare("SELECT state_json FROM rooms WHERE id = ?").get(id) as { state_json: string }
    ).state_json;
  } finally {
    db.close();
  }
};

/** A room with the fixture's stored state text, exactly as the server saved it. */
function seed(label: string): { roomId: string; stored: string } {
  const f = fixture.rooms.find((r) => r.label === label)!;
  const stored = JSON.stringify(f.room.state_json);
  const store = new Store(dbPath);
  const [host, ...rest] = f.players;
  store.createRoom(
    f.room.id,
    f.room.map_id as "welt" | "testland",
    { id: host!.id, name: host!.name, tokenHash: hashToken(`t-${host!.id}`) },
    Date.now(),
  );
  for (const p of rest) {
    store.addPlayer(
      f.room.id,
      { id: p.id, name: p.name, tokenHash: hashToken(`t-${p.id}`) },
      Date.now(),
    );
  }
  store.close();
  const db = new Database(dbPath);
  db.prepare("UPDATE rooms SET status = ?, state_json = ? WHERE id = ?").run(
    f.room.status,
    stored,
    f.room.id,
  );
  db.close();
  return { roomId: f.room.id, stored };
}

const withState = fixture.rooms.filter((r) => r.label !== "lobby").map((r) => r.label);

describe("loadState with the Phase-8 fixture (plan 014 A)", () => {
  it.each(withState)(
    "%s: version 7 loads as 8 with no round limit, round from the turn and winnerIds, is written back once, a second load writes nothing",
    (label) => {
      const { roomId, stored } = seed(label);
      expect((JSON.parse(stored) as { stateVersion: number }).stateVersion).toBe(7);
      const store = new Store(dbPath);
      const first = loadState(store, store.getRoom(roomId)!, noRng);
      expect(first.ok).toBe(true);
      if (!first.ok || !first.state) throw new Error("not loaded");
      expect(first.state.stateVersion).toBe(8);
      expect(first.state.rules.roundLimit).toBeNull();
      expect(first.state.round).toBe(
        Math.max(1, Math.ceil(first.state.turn / first.state.playerOrder.length)),
      );
      expect(first.state.winnerIds).toEqual(
        first.state.winnerId === null ? [] : [first.state.winnerId],
      );
      const written = rawRow(roomId);
      expect(written).not.toBe(stored);
      expect((JSON.parse(written) as GameState).stateVersion).toBe(8);
      expect(JSON.parse(written)).toEqual(JSON.parse(JSON.stringify(first.state)));
      const second = loadState(store, store.getRoom(roomId)!, noRng);
      expect(second.ok && second.state).toEqual(first.state);
      expect(rawRow(roomId)).toBe(written);
      store.close();
    },
  );

  it("the room in the fortify phase is stored in that phase", () => {
    const { roomId } = seed("playing-2p-neutral-fortify");
    const store = new Store(dbPath);
    const loaded = loadState(store, store.getRoom(roomId)!, noRng);
    if (!loaded.ok || !loaded.state) throw new Error("not loaded");
    expect(loaded.state.phase).toBe("fortify");
    expect(loaded.state.rules.roundLimit).toBeNull();
    store.close();
  });

  it("the lobby room has no state to load", () => {
    const f = fixture.rooms.find((r) => r.label === "lobby")!;
    const store = new Store(dbPath);
    store.createRoom(
      f.room.id,
      "testland",
      { id: f.players[0]!.id, name: "Anna", tokenHash: hashToken("x") },
      1,
    );
    expect(loadState(store, store.getRoom(f.room.id)!, noRng)).toEqual({ ok: true, state: null });
    store.close();
  });
});

describe("old database before plan 014 (fixture from the real server, plan 013 step 4)", () => {
  const read = (name: string) =>
    readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
  const tokenOf = (label: string, seat: unknown) => `fixture-token-${label}-${String(seat)}`;
  // The idle cleanup at the start must see the rows as fresh: clock just after the newest row
  const fixtureNow = Math.max(...fixture.rooms.map((r) => r.room["updated_at"] as number)) + 1000;
  const servers: { close: () => Promise<void> }[] = [];
  const clients: TestClient[] = [];
  afterEach(async () => {
    clients.splice(0).forEach((c) => c.close());
    for (const s of servers.splice(0)) await s.close();
  });

  /** The database the old server left behind: old CREATE statements, rows exactly as stored. */
  function seedOld(): void {
    const db = new Database(dbPath);
    db.exec(read("phase9-schema.sql"));
    db.prepare("INSERT INTO schema_meta (version) VALUES (?)").run(fixture.schemaMetaVersion);
    for (const { label, room, players } of fixture.rooms) {
      db.prepare(
        "INSERT INTO rooms (id, status, state_json, map_id, version, created_at, updated_at, victory_mode, game_no, last_activity_at, fortify_moves, mission_draft, hold_to_win) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      ).run(
        room.id,
        room.status,
        room.state_json === null ? null : JSON.stringify(room.state_json),
        room.map_id,
        room["version"],
        room["created_at"],
        room["updated_at"],
        room["victory_mode"],
        room["game_no"],
        room["last_activity_at"],
        room["fortify_moves"],
        room["mission_draft"],
        room["hold_to_win"],
      );
      for (const p of players) {
        db.prepare(
          "INSERT INTO players (id, room_id, name, token_hash, seat, is_host, removed) VALUES (?, ?, ?, ?, ?, ?, ?)",
        ).run(
          p.id,
          room.id,
          p.name,
          hashToken(tokenOf(label, p.seat)),
          p.seat,
          p["is_host"],
          p["removed"],
        );
      }
    }
    db.close();
  }
  const identities = (label: string): Identity[] => {
    const f = fixture.rooms.find((r) => r.label === label)!;
    return f.players.map((p) => ({
      roomId: f.room.id,
      playerId: p.id,
      token: tokenOf(label, p.seat),
    }));
  };
  const dumpAll = (): string => {
    const db = new Database(dbPath, { readonly: true });
    try {
      return JSON.stringify({
        rooms: db.prepare("SELECT * FROM rooms ORDER BY id").all(),
        players: db.prepare("SELECT * FROM players ORDER BY id").all(),
        meta: db.prepare("SELECT version FROM schema_meta").all(),
      });
    } finally {
      db.close();
    }
  };
  const boot = async () => {
    const srv = await startServer(dbPath, { rng: createSeededRng(7), now: () => fixtureNow });
    servers.push(srv);
    return srv;
  };
  const connect = async (srv: Awaited<ReturnType<typeof boot>>, id: Identity) => {
    const c = await TestClient.connect(srv, id);
    clients.push(c);
    await c.latestView();
    return c;
  };

  it("is the old format: no round_limit column, schema version 5", () => {
    seedOld();
    const db = new Database(dbPath, { readonly: true });
    const room = (db.prepare("PRAGMA table_info(rooms)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    db.close();
    expect(room).not.toContain("round_limit");
    expect(room).toContain("mission_draft");
    expect(room).toContain("hold_to_win");
    expect(room).toContain("victory_mode");
    expect(fixture.schemaMetaVersion).toBe(5);
  });

  it("opening it adds round_limit = NULL to every row, schema version 6, and a second open changes nothing", async () => {
    seedOld();
    const old = new Map(fixture.rooms.map((r) => [r.room.id, r.room]));
    await (await boot()).close();
    servers.pop();
    const db = new Database(dbPath, { readonly: true });
    const rooms = db.prepare("SELECT * FROM rooms").all() as Record<string, unknown>[];
    expect(db.prepare("SELECT version FROM schema_meta").all()).toEqual([{ version: 6 }]);
    db.close();
    expect(rooms).toHaveLength(5);
    for (const r of rooms) {
      const before = old.get(r["id"] as string)!;
      expect(r["round_limit"]).toBeNull();
      expect(r["mission_draft"]).toBe(before["mission_draft"]);
      expect(r["hold_to_win"]).toBe(before["hold_to_win"]);
      expect(r["fortify_moves"]).toBe(before["fortify_moves"]);
      expect(r["victory_mode"]).toBe(before["victory_mode"]);
      expect(r["map_id"]).toBe(before.map_id);
      expect(r["status"]).toBe(before.status);
      expect(r["version"]).toBe(before["version"]);
      // the stored state is not rewritten by opening the database
      expect(r["state_json"]).toBe(
        before.state_json === null ? null : JSON.stringify(before.state_json),
      );
    }
    const first = dumpAll();
    await (await boot()).close();
    servers.pop();
    expect(dumpAll()).toBe(first);
  });

  it("the room in the fortify phase loads as version 8, is written back once and plays on", async () => {
    seedOld();
    const ids = identities("playing-2p-neutral-fortify");
    const roomId = ids[0]!.roomId;
    const srv = await boot();
    const cs: TestClient[] = [];
    for (const id of ids) cs.push(await connect(srv, id));
    const first = cs[0]!.views().at(-1)!;
    expect(first.roundLimit).toBeNull();
    expect(first.game!.roundLimit).toBeNull();
    expect(first.game!.round).toBeGreaterThanOrEqual(1);
    expect(first.game!.winnerIds).toEqual([]);
    expect((JSON.parse(rawRow(roomId)) as GameState).stateVersion).toBe(8);
    const activeIdx = ids.findIndex((i) => i.playerId === first.game!.activePlayerId);
    cs[activeIdx]!.send({ type: "action", action: { type: "endPhase" } });
    const after = await cs[1 - activeIdx]!.nextView((v) => v.version > first.version);
    expect(after.game!.activePlayerId).not.toBe(first.game!.activePlayerId);
    expect(after.game!.phase).toBe("reinforce");
    expect(after.game!.conquestsThisTurn).toBe(0);
    expect(after.game!.round).toBeGreaterThanOrEqual(first.game!.round);
  });

  it("the old lobby room shows no round limit, takes one and starts with it", async () => {
    seedOld();
    const ids = identities("lobby");
    const srv = await boot();
    const a = await connect(srv, ids[0]!);
    const b = await connect(srv, ids[1]!);
    const v = await a.latestView();
    expect([v.mapId, v.victoryMode, v.fortifyMoves, v.roundLimit]).toEqual([
      "testland",
      "domination",
      2,
      null,
    ]);
    a.send({ type: "settings", roundLimit: 8 });
    const changed = await b.nextView((x) => x.roundLimit === 8);
    expect(changed.version).toBe(v.version + 1);
    a.send({ type: "start" });
    await b.nextView((x) => x.status === "playing");
    const state = JSON.parse(rawRow(ids[0]!.roomId)) as GameState;
    expect(state.rules.roundLimit).toBe(8);
    expect(state.round).toBe(1);
    expect(state.stateVersion).toBe(8);
  });

  it("the finished room stays finished and shows both options off", async () => {
    seedOld();
    const srv = await boot();
    const done = identities("finished");
    const host = await connect(srv, done[0]!);
    const view = await host.latestView();
    expect([view.status, view.roundLimit]).toEqual(["finished", null]);
    expect(view.game!.winnerIds).toEqual([view.game!.winnerId]);
    expect(view.game!.scores).toBeNull();
  });
});
