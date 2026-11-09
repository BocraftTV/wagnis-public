import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getMap } from "@wagnis/engine";
import type { GameState } from "@wagnis/engine";
import { Store } from "./store.js";
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

// Plan 011, step 5: the lobby setting `fortifyMoves` (1 or 2) over the real WebSocket: who may change it, when it is
// fixed, how it reaches the game, and the fortify moves of a turn on the wire.

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
const lastError = async (c: TestClient, n: number) => {
  await c.waitFor(() => (errorsOf(c).length >= n ? true : undefined));
  return errorsOf(c).at(-1);
};
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

interface Table {
  ids: Identity[];
  c: TestClient[];
  roomId: string;
}
async function table(n: number, start: boolean, moves?: 1 | 2): Promise<Table> {
  srv = await startServer(dbPath);
  const host = await createRoom(srv, "Host");
  const ids = [host];
  for (let i = 1; i < n; i++) ids.push(await joinRoom(srv, host.roomId, `Gast${i}`));
  const c: TestClient[] = [];
  for (const id of ids) c.push(await connect(id));
  if (moves !== undefined) {
    c[0]!.send({ type: "settings", victoryMode: "domination", fortifyMoves: moves });
    await Promise.all(c.map((x) => x.nextView((v) => v.fortifyMoves === moves)));
  }
  if (start) {
    c[0]!.send({ type: "start" });
    await Promise.all(c.map((x) => x.nextView((v) => v.status === "playing")));
  }
  return { ids, c, roomId: host.roomId };
}

describe("the lobby setting fortifyMoves", () => {
  it("is 1 in a new room, the host changes it, everybody gets the snapshot, one version step each", async () => {
    const t = await table(2, false);
    const v0 = await t.c[1]!.latestView();
    expect(v0.fortifyMoves).toBe(1);
    expect(rowOf(t.roomId)["fortify_moves"]).toBe(1);
    t.c[0]!.send({ type: "settings", fortifyMoves: 2 });
    const a = await t.c[1]!.nextView((v) => v.fortifyMoves === 2);
    expect(a.version).toBe(v0.version + 1);
    const own = await t.c[0]!.latestView((v) => v.fortifyMoves === 2);
    expect(own.version).toBe(a.version);
    expect(rowOf(t.roomId)["fortify_moves"]).toBe(2);
    t.c[0]!.send({ type: "settings", fortifyMoves: 1 });
    const b = await t.c[1]!.nextView((v) => v.fortifyMoves === 1);
    expect(b.version).toBe(a.version + 1);
    // combined with the other settings in one message: one version step
    t.c[0]!.send({ type: "settings", mapId: "welt", victoryMode: "domination", fortifyMoves: 2 });
    const c = await t.c[1]!.nextView((v) => v.fortifyMoves === 2);
    expect([c.mapId, c.victoryMode, c.version]).toEqual(["welt", "domination", b.version + 1]);
  });

  it("only the host changes it: a guest gets NOT_HOST and nothing changes", async () => {
    const t = await table(2, false);
    const before = rowOf(t.roomId);
    t.c[1]!.send({ type: "settings", fortifyMoves: 2 });
    expect(await lastError(t.c[1]!, 1)).toBe("NOT_HOST");
    expect(rowOf(t.roomId)).toEqual(before);
  });

  it("invalid values are BAD_MESSAGE and change nothing", async () => {
    const t = await table(2, false);
    const before = rowOf(t.roomId);
    const bad = [0, 3, "2", true, null, 1.5, [2]];
    for (const fortifyMoves of bad) t.c[0]!.send({ type: "settings", fortifyMoves });
    expect(await lastError(t.c[0]!, bad.length)).toBe("BAD_MESSAGE");
    expect(errorsOf(t.c[0]!)).toEqual(Array(bad.length).fill("BAD_MESSAGE"));
    expect(rowOf(t.roomId)).toEqual(before);
  });

  it.each([1, 2] as const)(
    "a room with %s starts with that value in the game state and the views",
    async (moves) => {
      const t = await table(2, true, moves);
      expect(stored(t.roomId).rules.fortifyMoves).toBe(moves);
      expect(stored(t.roomId).fortifyMovesDone).toBe(0);
      for (const c of t.c) expect((await c.latestView()).fortifyMoves).toBe(moves);
    },
  );

  it("is closed in a running game: NOT_IN_LOBBY, value and version unchanged", async () => {
    const t = await table(2, true, 2);
    const before = rowOf(t.roomId);
    t.c[0]!.send({ type: "settings", fortifyMoves: 1 });
    expect(await lastError(t.c[0]!, 1)).toBe("NOT_IN_LOBBY");
    expect(rowOf(t.roomId)).toEqual(before);
    // the room view in the game shows the value of the game state, not the column
    const db = new Database(dbPath);
    db.prepare("UPDATE rooms SET fortify_moves = 1 WHERE id = ?").run(t.roomId);
    db.close();
    t.c[0]!.send({ type: "host", action: { type: "skipTurn", turn: stored(t.roomId).turn } });
    const v = await t.c[1]!.nextView((x) => x.version > (before["version"] as number));
    expect(v.fortifyMoves).toBe(2);
  });

  it("stays after back to the lobby; the host changes it again and the next game uses the new value", async () => {
    const t = await table(2, true, 2);
    const db = new Database(dbPath);
    const s = stored(t.roomId);
    db.prepare("UPDATE rooms SET status = 'finished' WHERE id = ?").run(t.roomId);
    db.close();
    void s;
    await srv!.close();
    srv = await startServer(dbPath);
    for (const c of clients.splice(0)) c.close();
    const c = [await connect(t.ids[0]!), await connect(t.ids[1]!)];
    c[0]!.send({ type: "backToLobby" });
    const lobby = await c[1]!.nextView((v) => v.status === "lobby");
    expect(lobby.fortifyMoves).toBe(2);
    c[0]!.send({ type: "settings", fortifyMoves: 1 });
    await c[1]!.nextView((v) => v.fortifyMoves === 1);
    c[0]!.send({ type: "start" });
    await c[1]!.nextView((v) => v.status === "playing");
    expect(stored(t.roomId).rules.fortifyMoves).toBe(1);
  });

  it("after transferHost the new host may change it, the old one may not", async () => {
    const t = await table(2, false);
    t.c[0]!.send({ type: "host", action: { type: "transferHost", playerId: t.ids[1]!.playerId } });
    await t.c[1]!.nextView((v) => v.you.isHost);
    t.c[1]!.send({ type: "settings", fortifyMoves: 2 });
    await t.c[0]!.nextView((v) => v.fortifyMoves === 2);
    t.c[0]!.send({ type: "settings", fortifyMoves: 1 });
    expect(await lastError(t.c[0]!, 1)).toBe("NOT_HOST");
    expect(rowOf(t.roomId)["fortify_moves"]).toBe(2);
  });
});

/** A running 2-player game whose active player owns two linked territories with 3 armies each, in `fortify`. */
async function fortifyTable(moves: 1 | 2) {
  const t = await table(2, true, moves);
  const state = stored(t.roomId);
  const me = state.activePlayerId;
  const map = getMap(state.mapId)!;
  const from = map.territories[0]!;
  const to = from.neighbors[0]!;
  for (const id of [from.id, to]) state.territories[id] = { ownerId: me, armies: 3 };
  state.phase = "fortify";
  state.reinforcementsLeft = 0;
  const store = new Store(dbPath);
  store.saveGame(t.roomId, "playing", state, Date.now());
  store.close();
  // reconnect so that everybody has a snapshot of the rewritten state
  for (const c of clients.splice(0)) c.close();
  const c = [await connect(t.ids[0]!), await connect(t.ids[1]!)];
  const mine = t.ids.findIndex((i) => i.playerId === me);
  return { t, c, me, mine, other: 1 - mine, from: from.id, to };
}

describe("fortify moves over the wire", () => {
  it("setting 2: the first move keeps the player in the turn (version + 1), the second changes the turn, a third is NOT_YOUR_TURN", async () => {
    const r = await fortifyTable(2);
    const mover = r.c[r.mine]!;
    const first = await mover.latestView();
    expect(first.game!.fortify).toMatchObject({ movesDone: 0, movesMax: 2 });
    mover.send({ type: "action", action: { type: "fortify", from: r.from, to: r.to, count: 1 } });
    const a = await mover.nextView((v) => v.version > first.version);
    expect(a.version).toBe(first.version + 1);
    expect(a.game!.activePlayerId).toBe(r.me);
    expect(a.game!.phase).toBe("fortify");
    expect(a.game!.fortify).toMatchObject({ movesDone: 1, movesMax: 2 });
    const o = await r.c[r.other]!.latestView((v) => v.version === a.version);
    expect(o.game!.fortify).toBeNull();
    // reconnect in the middle of the turn: the snapshot says movesDone 1
    mover.close();
    const again = await TestClient.connect(srv!, r.t.ids[r.mine]!);
    clients.push(again);
    expect((await again.latestView()).game!.fortify).toMatchObject({ movesDone: 1, movesMax: 2 });
    again.send({ type: "action", action: { type: "fortify", from: r.to, to: r.from, count: 1 } });
    const b = await again.nextView((v) => v.version > a.version);
    expect(b.version).toBe(a.version + 1);
    expect(b.game!.activePlayerId).not.toBe(r.me);
    expect(b.game!.phase).toBe("reinforce");
    const sent = again.messages.length;
    again.send({
      type: "action",
      reqId: "x",
      action: { type: "fortify", from: r.from, to: r.to, count: 1 },
    });
    const err = await again.waitFor(() =>
      again.messages.slice(sent).find((m) => m.type === "error"),
    );
    expect(err).toMatchObject({ code: "NOT_YOUR_TURN", reqId: "x" });
    // the internal counter is in no message to anybody
    for (const c of [...r.c, again]) {
      expect(c.raw.join("\n")).not.toContain("fortifyMovesDone");
    }
  });

  it("setting 1: the first move changes the turn", async () => {
    const r = await fortifyTable(1);
    const mover = r.c[r.mine]!;
    const first = await mover.latestView();
    expect(first.game!.fortify).toMatchObject({ movesDone: 0, movesMax: 1 });
    mover.send({ type: "action", action: { type: "fortify", from: r.from, to: r.to, count: 1 } });
    const a = await mover.nextView((v) => v.version > first.version);
    expect(a.game!.activePlayerId).not.toBe(r.me);
    expect(a.game!.phase).toBe("reinforce");
  });

  it("setting 2: the host skips the turn after the first move; a wrong turn number is stale", async () => {
    const r = await fortifyTable(2);
    const mover = r.c[r.mine]!;
    const first = await mover.latestView();
    mover.send({ type: "action", action: { type: "fortify", from: r.from, to: r.to, count: 1 } });
    const a = await mover.nextView((v) => v.version > first.version);
    const host = r.c[0]!;
    host.send({ type: "host", reqId: "s0", action: { type: "skipTurn", turn: a.game!.turn + 5 } });
    expect(await lastError(host, 1)).toBe("STALE_TURN");
    host.send({ type: "host", reqId: "s1", action: { type: "skipTurn", turn: a.game!.turn } });
    const b = await r.c[r.other]!.nextView((v) => v.game!.turn === a.game!.turn + 1);
    expect(b.game!.activePlayerId).toBe(r.t.ids[r.other]!.playerId);
    expect(stored(r.t.roomId).fortifyMovesDone).toBe(0);
  });
});
