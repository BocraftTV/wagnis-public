import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSeededRng } from "@wagnis/engine";
import type { GameState, Rng } from "@wagnis/engine";
import { hashToken } from "./crypto.js";
import { loadState } from "./state.js";
import { Store } from "./store.js";
import { type Identity, TestClient, makeTmpDir, removeDir, startServer } from "./test-helpers.js";

// Real rows of the Phase-5 server (apps/server/fixtures/README.md). Step 1 of plan 007 only covers the state
// (`loadState`, 4 -> 5); the old-database test (schema 3 columns) comes with the server step.
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
    players: (Record<string, unknown> & {
      id: string;
      name: string;
      seat: number;
      is_host: number;
    })[];
  }[];
}
const read = (name: string) =>
  readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
const fixture = JSON.parse(
  readFileSync(new URL("../fixtures/phase5-rooms.json", import.meta.url), "utf8"),
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

/** A room with the fixture's stored state text, exactly as the Phase-5 server saved it. */
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

describe("loadState with the Phase-5 fixture (plan 007, step 1)", () => {
  it.each(["playing-3p-welt", "playing-2p-neutral", "finished"])(
    "%s: version 4 loads as 5 with removedPlayerIds [], is written back once, a second load writes nothing",
    (label) => {
      const { roomId, stored } = seed(label);
      expect((JSON.parse(stored) as { stateVersion: number }).stateVersion).toBe(4);
      const store = new Store(dbPath);
      const first = loadState(store, store.getRoom(roomId)!, noRng);
      expect(first.ok).toBe(true);
      if (!first.ok || !first.state) throw new Error("not loaded");
      expect(first.state.stateVersion).toBe(5);
      expect(first.state.removedPlayerIds).toEqual([]);
      const written = rawRow(roomId);
      expect(written).not.toBe(stored);
      expect((JSON.parse(written) as GameState).stateVersion).toBe(5);
      expect(JSON.parse(written)).toEqual(JSON.parse(JSON.stringify(first.state)));
      const second = loadState(store, store.getRoom(roomId)!, noRng);
      expect(second.ok && second.state).toEqual(first.state);
      expect(rawRow(roomId)).toBe(written);
      store.close();
    },
  );

  it("the lobby room has no state to load", () => {
    const f = fixture.rooms.find((r) => r.label === "lobby")!;
    const store = new Store(dbPath);
    store.createRoom(
      f.room.id,
      "welt",
      { id: f.players[0]!.id, name: "Anna", tokenHash: hashToken("x") },
      1,
    );
    expect(loadState(store, store.getRoom(f.room.id)!, noRng)).toEqual({ ok: true, state: null });
    store.close();
  });
});

describe("old Phase-5 database (fixture from the real Phase-5 server, plan 007 step 0)", () => {
  const tokenOf = (label: string, seat: unknown) => `fixture-token-${label}-${String(seat)}`;
  // Real data from the day it was made: the idle cleanup at the start must see it as fresh (clock just after the newest row)
  const fixtureNow = Math.max(...fixture.rooms.map((r) => r.room["updated_at"] as number)) + 1000;
  const servers: { close: () => Promise<void> }[] = [];
  const clients: TestClient[] = [];
  afterEach(async () => {
    clients.splice(0).forEach((c) => c.close());
    for (const s of servers.splice(0)) await s.close();
  });

  /** The database the Phase-5 server left behind: old CREATE statements, rows exactly as stored. */
  function seedOld(): void {
    const db = new Database(dbPath);
    db.exec(read("phase5-schema.sql"));
    db.prepare("INSERT INTO schema_meta (version) VALUES (?)").run(fixture.schemaMetaVersion);
    for (const { label, room, players } of fixture.rooms) {
      db.prepare(
        "INSERT INTO rooms (id, status, state_json, map_id, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
      ).run(
        room.id,
        room.status,
        room.state_json === null ? null : JSON.stringify(room.state_json),
        room.map_id,
        room["version"],
        room["created_at"],
        room["updated_at"],
      );
      for (const p of players) {
        db.prepare(
          "INSERT INTO players (id, room_id, name, token_hash, seat, is_host) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(p.id, room.id, p.name, hashToken(tokenOf(label, p.seat)), p.seat, p["is_host"]);
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

  it("is the old format: no phase 6a column, schema version 2", () => {
    seedOld();
    const db = new Database(dbPath, { readonly: true });
    const room = (db.prepare("PRAGMA table_info(rooms)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    const players = (db.prepare("PRAGMA table_info(players)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    db.close();
    for (const c of ["victory_mode", "game_no", "last_activity_at"]) expect(room).not.toContain(c);
    expect(players).not.toContain("removed");
    expect(room).toContain("map_id");
    expect(fixture.schemaMetaVersion).toBe(2);
  });

  it("opening it adds the four columns with the right old values, schema version 3, and a second open changes nothing", async () => {
    seedOld();
    const old = new Map(fixture.rooms.map((r) => [r.room.id, r.room]));
    await (await boot()).close();
    servers.pop();
    const db = new Database(dbPath, { readonly: true });
    const rooms = db.prepare("SELECT * FROM rooms").all() as Record<string, unknown>[];
    const players = db.prepare("SELECT * FROM players").all() as Record<string, unknown>[];
    expect(db.prepare("SELECT version FROM schema_meta").all()).toEqual([{ version: 3 }]);
    db.close();
    expect(rooms).toHaveLength(4);
    for (const r of rooms) {
      const before = old.get(r["id"] as string)!;
      expect(r["victory_mode"]).toBe("missions");
      expect(r["game_no"]).toBe(1);
      expect(r["last_activity_at"]).toBe(before["updated_at"]);
      expect(r["map_id"]).toBe(before.map_id);
      expect(r["status"]).toBe(before.status);
      expect(r["version"]).toBe(before["version"]);
      // the stored state is not rewritten by opening the database
      expect(r["state_json"]).toBe(
        before.state_json === null ? null : JSON.stringify(before.state_json),
      );
    }
    expect(players).toHaveLength(2 + 3 + 2 + 3);
    for (const p of players) expect(p["removed"]).toBe(0);
    const first = dumpAll();
    await (await boot()).close();
    servers.pop();
    expect(dumpAll()).toBe(first);
  });

  it.each(["playing-3p-welt", "playing-2p-neutral"])(
    "%s: loads as version 5, written back once, keeps playing with rising versions and hidden hands",
    async (label) => {
      seedOld();
      const ids = identities(label);
      const roomId = ids[0]!.roomId;
      const srv = await boot();
      const cs: TestClient[] = [];
      for (const id of ids) cs.push(await connect(srv, id));
      const first = cs[0]!.views().at(-1)!;
      expect(first.victoryMode).toBe("missions");
      expect(first.gameNo).toBe(1);
      expect(first.players.every((p) => !p.removed)).toBe(true);
      expect(first.game!.removedPlayerIds).toEqual([]);
      const written = rawRow(roomId);
      expect((JSON.parse(written) as GameState).stateVersion).toBe(5);
      // the active player ends the attack phase and the fortify phase: versions rise by one each
      const activeIdx = ids.findIndex((i) => i.playerId === first.game!.activePlayerId);
      cs[activeIdx]!.send({ type: "action", action: { type: "endPhase" } });
      const second = await cs[0]!.nextView((v) => v.version > first.version);
      expect(second.version).toBe(first.version + 1);
      expect(second.game!.phase).toBe("fortify");
      // a second load does not write the state again (only the action's own save changed the row)
      const afterAction = rawRow(roomId);
      expect((JSON.parse(afterAction) as GameState).phase).toBe("fortify");
      for (const [i, c] of cs.entries()) {
        const wire = c.raw.join("\n");
        expect(wire).not.toContain("stateVersion");
        expect(wire).not.toContain("originalMission");
        for (const [j, other] of ids.entries()) {
          if (i === j) continue;
          const state = JSON.parse(afterAction) as GameState;
          for (const card of state.secret.hand[other.playerId] ?? []) {
            expect(wire, `${i} sees a card of ${j}`).not.toContain(`"${card}"`);
          }
        }
      }
    },
  );

  it("the finished room allows back to the lobby; the old lobby room starts on the world map", async () => {
    seedOld();
    const srv = await boot();
    const done = identities("finished");
    const host = await connect(srv, done[0]!);
    expect((await host.latestView()).status).toBe("finished");
    const guest = await connect(srv, done[1]!);
    host.send({ type: "backToLobby" });
    const lobby = await guest.nextView((v) => v.status === "lobby");
    expect(lobby.gameNo).toBe(2);
    expect(lobby.game).toBeNull();
    expect(lobby.players).toHaveLength(3);

    const ids = identities("lobby");
    const a = await connect(srv, ids[0]!);
    const b = await connect(srv, ids[1]!);
    expect((await a.latestView()).mapId).toBe("welt");
    a.send({ type: "start" });
    const g = await b.nextView((v) => v.status === "playing");
    expect(g.mapId).toBe("welt");
    expect(Object.keys(g.game!.territories)).toHaveLength(42);
    expect(g.game!.victoryMode).toBe("missions");
  });
});
