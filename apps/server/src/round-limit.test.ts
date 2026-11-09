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

// Plan 014 A: the lobby option `roundLimit` over the real WebSocket, up to the score at the end.

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

describe("lobby option roundLimit", () => {
  it("is off by default; only the host sets it, everybody sees it, the column follows", async () => {
    const t = await table(2);
    expect((await t.c[0]!.latestView()).roundLimit).toBeNull();
    expect(rowOf(t.roomId)["round_limit"]).toBeNull();

    t.c[1]!.send({ type: "settings", roundLimit: 12 });
    await t.c[1]!.waitFor(() => (errorsOf(t.c[1]!).includes("NOT_HOST") ? true : undefined));

    t.c[0]!.send({ type: "settings", roundLimit: 12 });
    const seen = await Promise.all(t.c.map((x) => x.nextView((w) => w.roundLimit === 12)));
    expect(seen).toHaveLength(2);
    expect(rowOf(t.roomId)["round_limit"]).toBe(12);

    t.c[0]!.send({ type: "settings", roundLimit: null });
    const off = await t.c[1]!.nextView((w) => w.roundLimit === null);
    expect(off.roundLimit).toBeNull();
    expect(rowOf(t.roomId)["round_limit"]).toBeNull();
  });

  it("rejects values that are not offered with BAD_MESSAGE", async () => {
    const t = await table(2);
    t.c[0]!.send({ type: "settings", roundLimit: 10 });
    t.c[0]!.send({ type: "settings", roundLimit: "8" });
    await t.c[0]!.waitFor(() => (errorsOf(t.c[0]!).length >= 2 ? true : undefined));
    expect(errorsOf(t.c[0]!)).toEqual(["BAD_MESSAGE", "BAD_MESSAGE"]);
  });

  it("is copied into the game, shown as round 1, and fixed once the game runs", async () => {
    const t = await table(2);
    t.c[0]!.send({ type: "settings", roundLimit: 8, victoryMode: "domination" });
    await t.c[1]!.nextView((w) => w.roundLimit === 8 && w.victoryMode === "domination");
    t.c[0]!.send({ type: "start" });
    const started = await t.c[1]!.nextView((w) => w.status === "playing");
    expect(started.roundLimit).toBe(8);
    expect(started.game).toMatchObject({ round: 1, roundLimit: 8, winnerIds: [], scores: null });
    expect(stored(t.roomId).rules.roundLimit).toBe(8);
    expect(stored(t.roomId).round).toBe(1);

    t.c[0]!.send({ type: "settings", roundLimit: 16 });
    await t.c[0]!.waitFor(() => (errorsOf(t.c[0]!).includes("NOT_IN_LOBBY") ? true : undefined));
    expect(stored(t.roomId).rules.roundLimit).toBe(8);
  });

  it("the host skipping every turn reaches the score after round 8: finished, with scores for everybody", async () => {
    const t = await table(2);
    t.c[0]!.send({ type: "settings", roundLimit: 8, victoryMode: "domination" });
    await t.c[1]!.nextView((w) => w.roundLimit === 8);
    t.c[0]!.send({ type: "start" });
    let v = await t.c[0]!.nextView((w) => w.status === "playing");
    // 2 players, 8 rounds: 16 turns; the 16th skip scores
    for (let i = 1; i <= 16; i++) {
      const turn = v.game!.turn;
      expect(v.game!.round).toBe(Math.ceil(turn / 2));
      t.c[0]!.send({ type: "host", action: { type: "skipTurn", turn } });
      v = await t.c[0]!.nextView((w) => (w.game?.turn ?? 0) > turn || w.status === "finished");
    }
    expect(v.status).toBe("finished");
    expect(v.game!.winReason).toBe("roundLimit");
    expect(v.game!.round).toBe(8);
    expect(v.game!.winnerIds).toContain(v.game!.winnerId);
    // 2 players: 40 territories each plus 40 neutral; the score lists the two players
    expect(v.game!.scores!.map((s) => s.playerId).sort()).toEqual(
      t.ids.map((i) => i.playerId).sort(),
    );
    const other = await t.c[1]!.latestView((w) => w.status === "finished");
    expect(other.game!.scores).toEqual(v.game!.scores);
    expect(stored(t.roomId).winReason).toBe("roundLimit");
  });
});

describe("schema version 8", () => {
  it("has the nullable round_limit column", async () => {
    const t = await table(2);
    const db = new Database(dbPath, { readonly: true });
    const cols = db.prepare("PRAGMA table_info(rooms)").all() as {
      name: string;
      notnull: number;
    }[];
    expect(cols.find((c) => c.name === "round_limit")).toMatchObject({ notnull: 0 });
    expect(db.prepare("SELECT version FROM schema_meta").all()).toEqual([{ version: 8 }]);
    db.close();
    expect(t.roomId).toBeTruthy();
  });
});
