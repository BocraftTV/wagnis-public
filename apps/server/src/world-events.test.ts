import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GameState } from "@wagnis/engine";
import {
  type Identity,
  TestClient,
  type TestServer,
  createRoom,
  joinRoom,
  makeTmpDir,
  removeDir,
  startServer,
} from "./test-helpers.js";

// Plan 014 B: the lobby option `worldEvents`, the event in the snapshot, and the fog over the real WebSocket.

let dir: string;
let dbPath: string;
let srv: TestServer | undefined;
const clients: TestClient[] = [];

beforeEach(() => {
  dir = makeTmpDir();
  dbPath = `${dir}/db.sqlite`;
});
afterEach(async () => {
  clients.splice(0).forEach((c) => c.close());
  await srv?.close();
  srv = undefined;
  removeDir(dir);
});

async function connect(id: Identity): Promise<TestClient> {
  const c = await TestClient.connect(srv!, id);
  clients.push(c);
  await c.latestView();
  return c;
}
const errorsOf = (c: TestClient) => c.messages.flatMap((m) => (m.type === "error" ? [m.code] : []));
const rowOf = (roomId: string): Record<string, unknown> => {
  const db = new Database(dbPath, { readonly: true });
  try {
    return db.prepare("SELECT * FROM rooms WHERE id = ?").get(roomId) as Record<string, unknown>;
  } finally {
    db.close();
  }
};
const stored = (roomId: string): GameState =>
  JSON.parse(rowOf(roomId)["state_json"] as string) as GameState;

async function table(n: number) {
  srv = await startServer(dbPath);
  const host = await createRoom(srv, "Host");
  const ids = [host];
  for (let i = 1; i < n; i++) ids.push(await joinRoom(srv, host.roomId, `Gast${i}`));
  const c: TestClient[] = [];
  for (const id of ids) c.push(await connect(id));
  return { ids, c, roomId: host.roomId };
}

describe("lobby option worldEvents", () => {
  it("is off by default; only the host sets it, everybody sees it, the column follows", async () => {
    const t = await table(2);
    expect((await t.c[0]!.latestView()).worldEvents).toBe(false);
    expect(rowOf(t.roomId)["world_events"]).toBe(0);
    t.c[1]!.send({ type: "settings", worldEvents: true });
    await t.c[1]!.waitFor(() => (errorsOf(t.c[1]!).includes("NOT_HOST") ? true : undefined));
    t.c[0]!.send({ type: "settings", worldEvents: true });
    await Promise.all(t.c.map((x) => x.nextView((w) => w.worldEvents)));
    expect(rowOf(t.roomId)["world_events"]).toBe(1);
    t.c[0]!.send({ type: "settings", worldEvents: false });
    expect((await t.c[1]!.nextView((w) => !w.worldEvents)).worldEvents).toBe(false);
  });

  it("a wrong type is BAD_MESSAGE", async () => {
    const t = await table(2);
    t.c[0]!.send({ type: "settings", worldEvents: "yes" });
    await t.c[0]!.waitFor(() => (errorsOf(t.c[0]!).length >= 1 ? true : undefined));
    expect(errorsOf(t.c[0]!)).toEqual(["BAD_MESSAGE"]);
  });

  it("the game starts with an event in round 1 and 6 or 7 cards left; the deck never goes out", async () => {
    const t = await table(2);
    t.c[0]!.send({ type: "settings", worldEvents: true, victoryMode: "domination" });
    await t.c[1]!.nextView((w) => w.worldEvents);
    t.c[0]!.send({ type: "start" });
    const started = await t.c[1]!.nextView((w) => w.status === "playing");
    expect(started.worldEvents).toBe(true);
    expect(started.game!.worldEvent).not.toBeNull();
    // 7 cards left, or 6 when a storm was skipped (testland has no sea routes)
    expect([6, 7]).toContain(started.game!.worldEventsLeft);
    expect(stored(t.roomId).secret.eventDeck).toHaveLength(started.game!.worldEventsLeft);
    expect(t.c.flatMap((c) => c.raw).join("\n")).not.toContain("eventDeck");
    t.c[0]!.send({ type: "settings", worldEvents: false });
    await t.c[0]!.waitFor(() => (errorsOf(t.c[0]!).includes("NOT_IN_LOBBY") ? true : undefined));
    expect(stored(t.roomId).rules.worldEvents).toBe(true);
  });

  it("a new round draws a new event: after a full round the deck is shorter", async () => {
    const t = await table(2);
    t.c[0]!.send({ type: "settings", worldEvents: true, victoryMode: "domination" });
    await t.c[1]!.nextView((w) => w.worldEvents);
    t.c[0]!.send({ type: "start" });
    let v = await t.c[0]!.nextView((w) => w.status === "playing");
    expect(v.game!.round).toBe(1);
    const left = v.game!.worldEventsLeft;
    for (let i = 0; i < 2; i++) {
      const turn = v.game!.turn;
      t.c[0]!.send({ type: "host", action: { type: "skipTurn", turn } });
      v = await t.c[0]!.nextView((w) => (w.game?.turn ?? 0) > turn);
    }
    expect(v.game!.round).toBe(2);
    expect(v.game!.worldEventsLeft).toBeLessThan(left);
  });
});

describe("fog over the wire", () => {
  it("no player gets a foreign or neutral army count while the fog stands", async () => {
    const t = await table(3);
    t.c[0]!.send({ type: "settings", worldEvents: true, victoryMode: "domination" });
    await Promise.all(t.c.map((x) => x.nextView((w) => w.worldEvents)));
    t.c[0]!.send({ type: "start" });
    await Promise.all(t.c.map((x) => x.nextView((w) => w.status === "playing")));
    // put the fog in force in the stored state, then reconnect everybody for a fresh snapshot
    const raw = stored(t.roomId);
    raw.worldEvent = { kind: "fog", continentId: null, playerIds: [], territoryIds: [] };
    const db = new Database(dbPath);
    db.prepare("UPDATE rooms SET state_json = ? WHERE id = ?").run(JSON.stringify(raw), t.roomId);
    db.close();
    clients.splice(0).forEach((c) => c.close());
    for (let i = 0; i < t.ids.length; i++) {
      const me = t.ids[i]!;
      const c = await connect(me);
      const view = await c.latestView((w) => w.game?.worldEvent?.kind === "fog");
      const own = Object.values(view.game!.territories).filter((x) => x.ownerId === me.playerId);
      expect(own.length).toBeGreaterThan(0);
      for (const x of Object.values(view.game!.territories)) {
        if (x.ownerId === me.playerId) {
          expect(typeof x.armies).toBe("number");
        } else {
          expect([x.armies, x.maxAttackDice, x.maxMove]).toEqual([null, null, null]);
        }
      }
      expect(view.game!.worldEvent!.kind).toBe("fog");
    }
  });
});
