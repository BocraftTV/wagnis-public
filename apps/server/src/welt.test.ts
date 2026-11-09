import { readFileSync } from "node:fs";
import Database from "better-sqlite3";
import { afterEach, describe, expect, it } from "vitest";
import { createSeededRng, getMap, mapIds, weltRules } from "@wagnis/engine";
import type { GameState } from "@wagnis/engine";
import { mapIdSchema, serverMessageSchema } from "@wagnis/shared";
import type { RoomView } from "@wagnis/shared";
import { hashToken } from "./crypto.js";
import { Store } from "./store.js";
import {
  CREATE_CODE,
  type Identity,
  TestClient,
  type TestServer,
  joinRoom,
  makeTmpDir,
  post,
  removeDir,
  startServer,
} from "./test-helpers.js";

const dirs: string[] = [];
const servers: TestServer[] = [];
const clients: TestClient[] = [];

afterEach(async () => {
  clients.splice(0).forEach((c) => c.close());
  for (const s of servers.splice(0)) await s.close();
  dirs.splice(0).forEach(removeDir);
});

function newDb(): string {
  const dir = makeTmpDir();
  dirs.push(dir);
  return `${dir}/db.sqlite`;
}

async function boot(dbPath: string, seed = 11): Promise<TestServer> {
  const srv = await startServer(dbPath, { rng: createSeededRng(seed) });
  servers.push(srv);
  return srv;
}

async function connect(srv: TestServer, id: Identity): Promise<TestClient> {
  const c = await TestClient.connect(srv, id);
  clients.push(c);
  await c.latestView();
  return c;
}

const action = (a: unknown) => ({ type: "action", action: a });

interface Room {
  srv: TestServer;
  ids: Identity[];
  c: TestClient[];
}

/** Creates a room (map as given; none = the server default), joins `n - 1` players, connects all and starts. */
async function startRoom(srv: TestServer, n: number, mapId?: string, start = true): Promise<Room> {
  const body = { createCode: CREATE_CODE, hostName: "P1", ...(mapId ? { mapId } : {}) };
  const created = await post(`${srv.base}/api/rooms`, body);
  expect(created.status).toBe(201);
  const host: Identity = {
    roomId: created.body.roomId,
    playerId: created.body.playerId,
    token: created.body.playerToken,
  };
  const ids = [host];
  for (let i = 2; i <= n; i++) ids.push(await joinRoom(srv, host.roomId, `P${i}`));
  const c: TestClient[] = [];
  for (const id of ids) c.push(await connect(srv, id));
  if (start) {
    c[0]!.send({ type: "start" });
    for (const x of c) await x.nextView((v) => v.status === "playing");
  }
  return { srv, ids, c };
}

const activeIndex = (r: Room): number => {
  const v = r.c[0]!.views().at(-1)!;
  return r.ids.findIndex((i) => i.playerId === v.game!.activePlayerId);
};

/** Sends one action as the active player and waits until everybody has the next snapshot. */
async function step(r: Room, a: unknown): Promise<void> {
  const who = r.c[activeIndex(r)]!;
  const before = who.views().at(-1)!.version;
  who.send(action(a));
  for (const x of r.c) await x.latestView((v) => v.version > before);
}

/** One scripted turn: everything on the strongest border territory, blitz until a conquest, end the turn. */
async function playTurn(r: Room, mapId: string): Promise<void> {
  const map = getMap(mapId)!;
  const view = () => r.c[activeIndex(r)]!.views().at(-1)!.game!;
  const me = () => view().activePlayerId;
  const borders = () =>
    map.territories
      .filter(
        (t) =>
          view().territories[t.id]!.ownerId === me() &&
          t.neighbors.some((n) => view().territories[n]!.ownerId !== me()),
      )
      .sort(
        (a, b) => (view().territories[b.id]!.armies ?? 0) - (view().territories[a.id]!.armies ?? 0),
      );
  const hand = view().secret.hand;
  expect(hand.length).toBeLessThan(5);
  const left = view().reinforcementsLeft;
  await step(r, { type: "placeArmies", territoryId: borders()[0]!.id, count: left });
  await step(r, { type: "endPhase" });
  for (let i = 0; i < 12 && !view().conqueredThisTurn; i++) {
    let best: { from: string; to: string; score: number } | undefined;
    for (const t of map.territories) {
      const s = view().territories[t.id]!;
      if (s.ownerId !== me() || (s.maxAttackDice ?? 0) < 1) continue;
      for (const n of t.neighbors) {
        const o = view().territories[n]!;
        if (o.ownerId === me()) continue;
        const score = (s.armies ?? 0) - (o.armies ?? 0);
        if (!best || score > best.score) best = { from: t.id, to: n, score };
      }
    }
    if (!best) break;
    await step(r, { type: "blitz", from: best.from, to: best.to });
    const pending = view().pendingOccupation;
    if (pending) await step(r, { type: "occupy", count: pending.max });
    if (view().winnerId) return;
  }
  await step(r, { type: "endPhase" });
  await step(r, { type: "endPhase" });
}

const storedState = (dbPath: string, roomId: string): GameState => {
  const db = new Database(dbPath, { readonly: true });
  try {
    const row = db.prepare("SELECT state_json FROM rooms WHERE id = ?").get(roomId) as {
      state_json: string;
    };
    return JSON.parse(row.state_json) as GameState;
  } finally {
    db.close();
  }
};

describe("map registry", () => {
  it("has every schema id in the engine registry and every registered id in the schema", () => {
    expect([...mapIdSchema.options].sort()).toEqual([...mapIds].sort());
  });
});

describe("creating rooms with a map", () => {
  it("defaults to the world map and shows the map already in the lobby", async () => {
    const srv = await boot(newDb());
    const r = await startRoom(srv, 3, undefined, false);
    const lobby = await r.c[0]!.latestView();
    expect(lobby.status).toBe("lobby");
    expect(lobby.mapId).toBe("welt");
    expect(lobby.game).toBeNull();
  });

  it("accepts testland, rejects an unknown map and keeps nothing of a rejected request", async () => {
    const srv = await boot(newDb());
    const r = await startRoom(srv, 2, "testland", false);
    expect((await r.c[0]!.latestView()).mapId).toBe("testland");
    const bad = await post(`${srv.base}/api/rooms`, {
      createCode: CREATE_CODE,
      hostName: "X",
      mapId: "nirgendwo",
    });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("VALIDATION");
  });

  it.each([2, 3, 4, 5, 6])(
    "%i players: the world map starts with 42 territories, 44 cards and the start armies",
    async (n) => {
      const srv = await boot(newDb(), 20 + n);
      const r = await startRoom(srv, n, "welt");
      for (const c of r.c) {
        const v = c.views().at(-1)!;
        expect(v.mapId).toBe("welt");
        expect(v.game!.mapId).toBe("welt");
        expect(Object.keys(v.game!.territories)).toHaveLength(42);
        expect(v.game!.deckCount).toBe(44);
      }
      const g = r.c[0]!.views().at(-1)!.game!;
      const armies = new Map<string | null, number>();
      const count = new Map<string | null, number>();
      for (const t of Object.values(g.territories)) {
        armies.set(t.ownerId, (armies.get(t.ownerId) ?? 0) + (t.armies ?? 0));
        count.set(t.ownerId, (count.get(t.ownerId) ?? 0) + 1);
      }
      const owners =
        n === 2 ? [...r.ids.map((i) => i.playerId), null] : r.ids.map((i) => i.playerId);
      for (const o of owners) {
        expect(armies.get(o)).toBe(weltRules.startArmies[n]);
        expect([14, 11, 10, 9, 8, 7]).toContain(count.get(o));
      }
      expect(count.has(null)).toBe(n === 2);
    },
  );

  it("starts a testland room as before (8 territories)", async () => {
    const srv = await boot(newDb());
    const r = await startRoom(srv, 3, "testland");
    expect(Object.keys(r.c[0]!.views().at(-1)!.game!.territories)).toHaveLength(8);
  });
});

describe("old Phase-4 database (fixture from the real Phase-4 server)", () => {
  interface Fixture {
    schemaMetaVersion: number;
    rooms: {
      label: string;
      room: Record<string, unknown>;
      players: Record<string, unknown>[];
    }[];
  }
  const read = (name: string) =>
    readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8");
  const fixture = JSON.parse(read("phase4-rooms.json")) as Fixture;
  // The fixture is real data from the day it was made: the idle cleanup at the start must see it as fresh, so the
  // server's clock stands just after the newest row.
  const fixtureNow = Math.max(...fixture.rooms.map((r) => r.room["updated_at"] as number)) + 1000;
  const bootOld = (dbPath: string) =>
    startServer(dbPath, { rng: createSeededRng(11), now: () => fixtureNow }).then(
      (s) => (servers.push(s), s),
    );
  const tokenOf = (label: string, seat: unknown) => `fixture-token-${label}-${String(seat)}`;

  /** Builds the database the Phase-4 server left behind: old CREATE statements, rows as stored. */
  function seedOld(dbPath: string): void {
    const db = new Database(dbPath);
    db.exec(read("phase4-schema.sql"));
    db.prepare("INSERT INTO schema_meta (version) VALUES (?)").run(fixture.schemaMetaVersion);
    for (const { label, room, players } of fixture.rooms) {
      db.prepare(
        "INSERT INTO rooms (id, status, state_json, version, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      ).run(
        room["id"],
        room["status"],
        room["state_json"] === null ? null : JSON.stringify(room["state_json"]),
        room["version"],
        room["created_at"],
        room["updated_at"],
      );
      for (const p of players) {
        db.prepare(
          "INSERT INTO players (id, room_id, name, token_hash, seat, is_host) VALUES (?, ?, ?, ?, ?, ?)",
        ).run(
          p["id"],
          p["room_id"],
          p["name"],
          hashToken(tokenOf(label, p["seat"])),
          p["seat"],
          p["is_host"],
        );
      }
    }
    db.close();
  }

  const identities = (label: string): Identity[] => {
    const f = fixture.rooms.find((r) => r.label === label)!;
    return f.players.map((p) => ({
      roomId: f.room["id"] as string,
      playerId: p["id"] as string,
      token: tokenOf(label, p["seat"]),
    }));
  };

  const columns = (dbPath: string) => {
    const db = new Database(dbPath, { readonly: true });
    try {
      return {
        cols: (db.prepare("PRAGMA table_info(rooms)").all() as { name: string }[]).map(
          (c) => c.name,
        ),
        rooms: db.prepare("SELECT * FROM rooms ORDER BY id").all() as { map_id?: string }[],
        meta: db.prepare("SELECT version FROM schema_meta").all(),
        dump: JSON.stringify(db.prepare("SELECT * FROM rooms ORDER BY id").all()),
      };
    } finally {
      db.close();
    }
  };

  it("is the old format: no map_id column, schema version 1", () => {
    const dbPath = newDb();
    seedOld(dbPath);
    const before = columns(dbPath);
    expect(before.cols).not.toContain("map_id");
    expect(before.meta).toEqual([{ version: 1 }]);
  });

  it("gets the column with testland for old rows, schema version 7 (phase 6a columns too), and a second open changes nothing", async () => {
    const dbPath = newDb();
    seedOld(dbPath);
    await bootOld(dbPath);
    await servers.pop()!.close();
    const first = columns(dbPath);
    expect(first.cols).toContain("map_id");
    expect(first.meta).toEqual([{ version: 7 }]);
    expect(first.rooms).toHaveLength(3);
    for (const r of first.rooms as { map_id: string }[]) expect(r.map_id).toBe("testland");
    // the state rows themselves were not rewritten
    const db = new Database(dbPath, { readonly: true });
    const rows = db.prepare("SELECT id, state_json FROM rooms").all() as {
      id: string;
      state_json: string | null;
    }[];
    db.close();
    for (const { room } of fixture.rooms) {
      const row = rows.find((x) => x.id === room["id"])!;
      expect(row.state_json).toBe(
        room["state_json"] === null ? null : JSON.stringify(room["state_json"]),
      );
    }
    new Store(dbPath).close();
    expect(columns(dbPath)).toEqual(first);
  });

  it("starts the old lobby room on testland", async () => {
    const dbPath = newDb();
    seedOld(dbPath);
    const srv = await bootOld(dbPath);
    const ids = identities("lobby");
    const c = [await connect(srv, ids[0]!), await connect(srv, ids[1]!)];
    expect((await c[0]!.latestView()).mapId).toBe("testland");
    c[0]!.send({ type: "start" });
    const v = await c[1]!.nextView((x) => x.status === "playing");
    expect(v.mapId).toBe("testland");
    expect(v.game!.mapId).toBe("testland");
    expect(Object.keys(v.game!.territories)).toHaveLength(8);
  });

  it.each(["playing-3p", "playing-2p-neutral"])(
    "%s: plays on (place, attack, end phase), version rises, the stored state is version 9 (migrated on load)",
    async (label) => {
      const dbPath = newDb();
      seedOld(dbPath);
      const srv = await bootOld(dbPath);
      const ids = identities(label);
      const r: Room = { srv, ids, c: [] };
      for (const id of ids) r.c.push(await connect(srv, id));
      const first = r.c[0]!.views().at(-1)!;
      expect(first.mapId).toBe("testland");
      expect(first.game!.phase).toBe("attack");
      const versions: number[] = [first.version];
      const bump = () => versions.push(r.c[0]!.views().at(-1)!.version);
      // attack phase -> fortify -> next player's reinforce phase
      await step(r, { type: "endPhase" });
      bump();
      await step(r, { type: "endPhase" });
      bump();
      const map = getMap("testland")!;
      const g = () => r.c[activeIndex(r)]!.views().at(-1)!.game!;
      const me = g().activePlayerId;
      const own = map.territories.find((t) => g().territories[t.id]!.ownerId === me)!;
      expect(g().phase).toBe("reinforce");
      await step(r, { type: "placeArmies", territoryId: own.id, count: g().reinforcementsLeft });
      bump();
      await step(r, { type: "endPhase" });
      bump();
      const pair = map.territories
        .flatMap((t) => t.neighbors.map((n) => [t.id, n] as const))
        .find(
          ([a, b]) =>
            g().territories[a]!.ownerId === me &&
            (g().territories[a]!.maxAttackDice ?? 0) >= 1 &&
            g().territories[b]!.ownerId !== me,
        );
      expect(pair).toBeDefined();
      await step(r, { type: "attack", from: pair![0], to: pair![1], dice: 1 });
      bump();
      expect(g().lastCombat).not.toBeNull();
      expect(versions).toEqual([...versions].sort((a, b) => a - b));
      expect(new Set(versions).size).toBe(versions.length);
      const state = storedState(dbPath, ids[0]!.roomId);
      expect(state.stateVersion).toBe(9);
      expect(state.mapId).toBe("testland");
      for (const c of r.c) {
        const wire = c.raw.join("\n");
        expect(wire).not.toContain("stateVersion");
        expect(wire).not.toContain("originalMission");
      }
    },
  );
});

describe("world map games over the real WebSocket", () => {
  it.each([3, 6, 2])(
    "%i players: no other player's mission, card or deck appears in any message to a player",
    async (n) => {
      const dbPath = newDb();
      const srv = await boot(dbPath, 30 + n);
      const r = await startRoom(srv, n, "welt");
      for (let t = 0; t < n + 1; t++) await playTurn(r, "welt");
      await new Promise((resolve) => setTimeout(resolve, 100));
      const state = storedState(dbPath, r.ids[0]!.roomId);
      expect(Object.values(state.secret.hand).some((h) => h.length > 0)).toBe(true);
      const wire = r.c.map((c) => c.raw.join("\n"));
      r.ids.forEach((me, i) => {
        const own = JSON.stringify(state.secret.mission[me.playerId]);
        expect(wire[i], `P${i + 1} gets its mission`).toContain(own);
        for (const other of r.ids) {
          if (other.playerId === me.playerId) continue;
          const theirs = JSON.stringify(state.secret.mission[other.playerId]);
          if (theirs !== own) expect(wire[i], `P${i + 1} sees ${theirs}`).not.toContain(theirs);
          for (const card of state.secret.hand[other.playerId]!) {
            expect(wire[i], `P${i + 1} sees ${card}`).not.toContain(`"${card}"`);
          }
        }
        // deck and discard never leave the server, neither the originals nor the state version
        for (const id of [...state.secret.deck, ...state.secret.discard]) {
          expect(wire[i]).not.toContain(`"${id}"`);
        }
        for (const word of [
          "originalMission",
          "stateVersion",
          '"deck"',
          '"discard"',
          "tokenHash",
        ]) {
          expect(wire[i]).not.toContain(word);
        }
        for (const m of r.c[i]!.messages) expect(serverMessageSchema.parse(m)).toEqual(m);
        // roomView.mapId is the same for everybody
        for (const v of r.c[i]!.views()) expect(v.mapId).toBe("welt");
        const lastGame = r.c[i]!.views().at(-1)!.game!;
        expect(lastGame.missions).toBeNull();
        expect(Object.keys(lastGame.territories)).toHaveLength(42);
      });
    },
    60_000,
  );

  it("differential: another player's mission changes only that player's own messages", async () => {
    const run = async (swap: boolean) => {
      const dbPath = newDb();
      const srv = await boot(dbPath, 77);
      const r = await startRoom(srv, 3, "welt");
      const roomId = r.ids[0]!.roomId;
      if (swap) {
        const store = new Store(dbPath);
        const state = JSON.parse(store.getRoom(roomId)!.stateJson!) as GameState;
        const other = { type: "holdTerritories", count: 18, minArmies: 1 } as const;
        const p3 = r.ids[2]!.playerId;
        state.secret.mission[p3] = { ...other };
        state.secret.originalMission[p3] = { ...other };
        state.secret.missionReplaced[p3] = false;
        store.rewriteState(roomId, state);
        store.close();
      }
      const startVersion = r.c[0]!.views().at(-1)!.version;
      for (let t = 0; t < 3; t++) await playTurn(r, "welt");
      await new Promise((resolve) => setTimeout(resolve, 100));
      const norm = (text: string): string => {
        let out = text.split(roomId).join("<ROOM>");
        r.ids.forEach((i, k) => (out = out.split(i.playerId).join(`<P${k + 1}>`)));
        return out;
      };
      const after = (i: number) =>
        r.c[i]!.raw.filter(
          (t) => (JSON.parse(t) as { view: RoomView }).view.version > startVersion,
        ).map(norm);
      return [0, 1, 2].map(after);
    };
    const a = await run(false);
    const b = await run(true);
    expect(a[0]!.length).toBeGreaterThan(5);
    expect(b[0]).toEqual(a[0]);
    expect(b[1]).toEqual(a[1]);
    // the third player's own messages differ only in the own secret
    const strip = (lines: string[]) =>
      lines.map((l) => {
        const m = JSON.parse(l) as { view: { game?: { secret?: unknown } } };
        if (m.view.game) delete m.view.game.secret;
        return m;
      });
    expect(strip(b[2]!)).toEqual(strip(a[2]!));
  }, 60_000);

  it("survives a restart in the middle of the game: missions, neutral owner, deck and owners stay", async () => {
    const dbPath = newDb();
    const srv = await boot(dbPath, 5);
    const r = await startRoom(srv, 2, "welt");
    await playTurn(r, "welt");
    await playTurn(r, "welt");
    for (const c of r.c) await c.latestView();
    const roomId = r.ids[0]!.roomId;
    const before = storedState(dbPath, roomId);
    const views = r.c.map((c) => c.views().at(-1)!);
    r.c.forEach((c) => c.close());
    clients.length = 0;
    await servers.pop()!.close();

    const srv2 = await boot(dbPath, 6);
    const again = [await connect(srv2, r.ids[0]!), await connect(srv2, r.ids[1]!)];
    again.forEach((c, i) => {
      const v = c.views().at(-1)!;
      const was = views[i]!;
      expect(v.version).toBe(was.version);
      expect(v.mapId).toBe("welt");
      expect(v.game).toEqual(was.game);
    });
    const after = storedState(dbPath, roomId);
    expect(after).toEqual(before);
    expect(Object.values(after.territories).some((t) => t.ownerId === null)).toBe(true);
    expect(after.secret.deck.length + after.secret.discard.length).toBeGreaterThan(30);
    // and the game goes on
    const rr: Room = { srv: srv2, ids: r.ids, c: again };
    await playTurn(rr, "welt");
    expect(again[0]!.views().at(-1)!.version).toBeGreaterThan(views[0]!.version);
  }, 60_000);
});
