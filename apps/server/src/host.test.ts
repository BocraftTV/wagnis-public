import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createGame, createSeededRng, getMap, getMissionSet, getRules } from "@wagnis/engine";
import type { GameState } from "@wagnis/engine";
import type { RoomView } from "@wagnis/shared";
import { hashToken } from "./crypto.js";
import { Store } from "./store.js";
import {
  CREATE_CODE,
  type Identity,
  TestClient,
  type TestServer,
  createRoom,
  joinRoom,
  makeTmpDir,
  post,
  removeDir,
  startServer,
  unreachableMissions,
} from "./test-helpers.js";

// Plan 007, steps 6 and 7: host rights, lobby choice, removal, skipping and "back to the lobby" over the real
// WebSocket. Everything runs on testland.

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

async function boot(): Promise<TestServer> {
  srv = await startServer(dbPath, {
    logger: { level: "info", stream: { write: (line: string) => void logLines.push(line) } },
  });
  return srv;
}
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

/** Everything of the room and its players except the idle-clock column, as stored. */
function dump(roomId: string): string {
  const db = new Database(dbPath, { readonly: true });
  try {
    const room = db.prepare("SELECT * FROM rooms WHERE id = ?").get(roomId) as Record<
      string,
      unknown
    >;
    delete room["last_activity_at"];
    const players = db.prepare("SELECT * FROM players WHERE room_id = ? ORDER BY seat").all(roomId);
    return JSON.stringify({ room, players });
  } finally {
    db.close();
  }
}
const stored = (roomId: string): GameState =>
  JSON.parse(new Store(dbPath).getRoom(roomId)!.stateJson!) as GameState;

interface Table {
  ids: Identity[];
  c: TestClient[];
  roomId: string;
}

/** A room with `n` players (host first), everybody connected; started if `start`. */
async function table(n: number, start: boolean, names?: string[]): Promise<Table> {
  await boot();
  const host = await createRoom(srv!, names?.[0] ?? "Host");
  const ids = [host];
  for (let i = 1; i < n; i++) ids.push(await joinRoom(srv!, host.roomId, names?.[i] ?? `Gast${i}`));
  const c: TestClient[] = [];
  for (const id of ids) c.push(await connect(id));
  if (start) {
    c[0]!.send({ type: "start" });
    await Promise.all(c.map((x) => x.nextView((v) => v.status === "playing")));
  }
  return { ids, c, roomId: host.roomId };
}

/** Rewrites the stored state of a running room (the server loads it fresh for every message). */
function rewrite(
  roomId: string,
  mutate: (s: GameState) => void,
  status = "playing" as const,
): void {
  const store = new Store(dbPath);
  const s = JSON.parse(store.getRoom(roomId)!.stateJson!) as GameState;
  mutate(s);
  store.saveGame(roomId, status, s, Date.now());
  store.close();
}

describe("host rights", () => {
  it("a player who is not the host gets NOT_HOST for every host message; nothing is stored", async () => {
    const t = await table(3, true);
    const before = dump(t.roomId);
    const guest = t.c[1]!;
    guest.send({ type: "settings", victoryMode: "domination" });
    guest.send({ type: "host", reqId: "a", action: { type: "skipTurn", turn: 1 } });
    guest.send({
      type: "host",
      reqId: "b",
      action: { type: "removePlayer", playerId: t.ids[2]!.playerId },
    });
    guest.send({ type: "backToLobby" });
    expect(await lastError(guest, 4)).toBe("NOT_HOST");
    expect(errorsOf(guest)).toEqual(["NOT_HOST", "NOT_HOST", "NOT_HOST", "NOT_HOST"]);
    expect(guest.messages.filter((m) => m.type === "error").map((m) => (m as any).reqId)).toEqual([
      undefined,
      "a",
      "b",
      undefined,
    ]);
    expect(dump(t.roomId)).toBe(before);
    // the host's own row is not changed by any of it
    expect((await t.c[0]!.latestView()).you.isHost).toBe(true);
  });

  it("the sender is the connection, never a field of the message: a guest naming the host as target is no host", async () => {
    const t = await table(3, true);
    const before = dump(t.roomId);
    t.c[1]!.send({
      type: "host",
      action: { type: "removePlayer", playerId: t.ids[0]!.playerId },
    });
    expect(await lastError(t.c[1]!, 1)).toBe("NOT_HOST");
    expect(dump(t.roomId)).toBe(before);
    // a message with extra identity fields is not even valid
    t.c[1]!.send({
      type: "host",
      playerId: t.ids[0]!.playerId,
      action: { type: "skipTurn", turn: 1 },
    });
    expect(await lastError(t.c[1]!, 2)).toBe("BAD_MESSAGE");
    expect(dump(t.roomId)).toBe(before);
  });

  it("checks the room status after the host: NOT_IN_LOBBY, NOT_IN_GAME, NOT_FINISHED", async () => {
    const lobby = await table(2, false);
    lobby.c[0]!.send({ type: "host", action: { type: "skipTurn", turn: 1 } });
    lobby.c[0]!.send({ type: "backToLobby" });
    lobby.c[0]!.send({ type: "host", action: { type: "removePlayer", playerId: "nobody" } });
    expect(await lastError(lobby.c[0]!, 3)).toBe("UNKNOWN_PLAYER");
    expect(errorsOf(lobby.c[0]!)).toEqual(["NOT_IN_GAME", "NOT_FINISHED", "UNKNOWN_PLAYER"]);
    lobby.c[0]!.send({ type: "start" });
    await lobby.c[0]!.nextView((v) => v.status === "playing");
    lobby.c[0]!.send({ type: "settings", victoryMode: "domination" });
    lobby.c[0]!.send({ type: "backToLobby" });
    expect(await lastError(lobby.c[0]!, 5)).toBe("NOT_FINISHED");
    expect(errorsOf(lobby.c[0]!).slice(3)).toEqual(["NOT_IN_LOBBY", "NOT_FINISHED"]);
  });

  it("a host message before hello is no host message at all", async () => {
    await boot();
    const host = await createRoom(srv!);
    const c = await TestClient.connect(srv!);
    clients.push(c);
    c.send({ type: "host", action: { type: "skipTurn", turn: 1 } });
    expect(await c.closed()).toBe(4001);
    expect(dump(host.roomId)).toContain(host.playerId);
  });
});

describe("lobby choice (settings)", () => {
  it("changes map and mode for everybody, one version step each; start takes them over", async () => {
    const t = await table(2, false);
    const v0 = await t.c[1]!.latestView();
    expect(v0.victoryMode).toBe("missions");
    expect(v0.mapId).toBe("testland");
    expect(v0.gameNo).toBe(1);
    t.c[0]!.send({ type: "settings", victoryMode: "domination" });
    const a = await t.c[1]!.nextView((v) => v.victoryMode === "domination");
    expect(a.version).toBe(v0.version + 1);
    expect(a.mapId).toBe("testland");
    t.c[0]!.send({ type: "settings", mapId: "welt", victoryMode: "missions" });
    const b = await t.c[1]!.nextView((v) => v.mapId === "welt");
    expect(b.version).toBe(a.version + 1);
    expect(b.victoryMode).toBe("missions");
    t.c[0]!.send({ type: "settings", mapId: "testland", victoryMode: "domination" });
    await t.c[1]!.nextView((v) => v.mapId === "testland" && v.victoryMode === "domination");
    t.c[0]!.send({ type: "start" });
    const g = await t.c[1]!.nextView((v) => v.status === "playing");
    expect(g.game!.mapId).toBe("testland");
    expect(g.game!.victoryMode).toBe("domination");
    expect(g.victoryMode).toBe("domination");
    expect(g.game!.secret.mission).toBeNull();
    const state = stored(t.roomId);
    expect(Object.values(state.secret.mission).every((m) => m === null)).toBe(true);
    // and now settings are closed
    t.c[0]!.send({ type: "settings", victoryMode: "missions" });
    expect(await lastError(t.c[0]!, 1)).toBe("NOT_IN_LOBBY");
  });

  it("missions mode (the default) deals missions; the world map comes from the room", async () => {
    const t = await table(3, false);
    t.c[0]!.send({ type: "settings", mapId: "welt" });
    await t.c[0]!.nextView((v) => v.mapId === "welt");
    t.c[0]!.send({ type: "start" });
    const g = await t.c[1]!.nextView((v) => v.status === "playing");
    expect(g.game!.mapId).toBe("welt");
    expect(Object.keys(g.game!.territories)).toHaveLength(42);
    expect(g.game!.victoryMode).toBe("missions");
    expect(g.game!.secret.mission).not.toBeNull();
  });

  it("invalid values and empty settings are BAD_MESSAGE and change nothing", async () => {
    const t = await table(2, false);
    const before = dump(t.roomId);
    for (const m of [
      { type: "settings" },
      { type: "settings", mapId: "nirgendwo" },
      { type: "settings", victoryMode: "chaos" },
      { type: "settings", mapId: "welt", extra: 1 },
    ]) {
      t.c[0]!.send(m);
    }
    expect(await lastError(t.c[0]!, 4)).toBe("BAD_MESSAGE");
    expect(errorsOf(t.c[0]!)).toEqual(Array(4).fill("BAD_MESSAGE"));
    expect(dump(t.roomId)).toBe(before);
  });
});

describe("removing in the lobby", () => {
  it("frees seat and name, ends the connection with 4004, makes the token worthless, raises the version", async () => {
    const t = await table(3, false, ["Anna", "Ben", "Cleo"]);
    const v0 = await t.c[0]!.latestView();
    t.c[0]!.send({ type: "host", action: { type: "removePlayer", playerId: t.ids[1]!.playerId } });
    expect(await t.c[1]!.closed()).toBe(4004);
    const v1 = await t.c[0]!.latestView((v) => v.players.length === 2);
    expect(v1.version).toBe(v0.version + 1);
    expect(v1.players.map((p) => p.name)).toEqual(["Anna", "Cleo"]);
    expect(v1.players.every((p) => !p.removed)).toBe(true);
    const snapshotsAtClose = t.c[1]!.views().length;
    // the old token: hello is refused with the same answer as for any unknown token
    const again = await TestClient.connect(srv!, t.ids[1]!);
    clients.push(again);
    expect(await again.closed()).toBe(4001);
    expect(errorsOf(again)).toEqual(["NOT_AUTHENTICATED"]);
    expect(t.c[1]!.views().length).toBe(snapshotsAtClose);
    // the name is free, the seat is used again (lowest free seat), the HTTP join works
    const back = await joinRoom(srv!, t.roomId, "Ben");
    const vb = await t.c[0]!.latestView((v) => v.players.length === 3);
    expect(vb.players.find((p) => p.id === back.playerId)!.seat).toBe(1);
    expect(back.playerId).not.toBe(t.ids[1]!.playerId);
  });

  it("not the host himself (CANNOT_REMOVE_SELF), no stranger (UNKNOWN_PLAYER); the host row stays", async () => {
    const t = await table(2, false);
    const before = dump(t.roomId);
    t.c[0]!.send({
      type: "host",
      reqId: "s",
      action: { type: "removePlayer", playerId: t.ids[0]!.playerId },
    });
    t.c[0]!.send({
      type: "host",
      reqId: "u",
      action: { type: "removePlayer", playerId: "nobody" },
    });
    expect(await lastError(t.c[0]!, 2)).toBe("UNKNOWN_PLAYER");
    expect(errorsOf(t.c[0]!)).toEqual(["CANNOT_REMOVE_SELF", "UNKNOWN_PLAYER"]);
    expect(dump(t.roomId)).toBe(before);
  });
});

describe("removing and skipping in a running game", () => {
  it("removePlayer: neutral territories, hand to the pile, token worthless, 4004, no more snapshots; nothing secret to the others", async () => {
    const t = await table(3, true, ["Anna", "Ben", "Cleo"]);
    const [host, ben, cleo] = t.ids as [Identity, Identity, Identity];
    // give Cleo two known cards (taken from the deck) and the hand of nobody else
    let cards: string[] = [];
    rewrite(t.roomId, (s) => {
      cards = s.secret.deck.splice(0, 2);
      s.secret.hand[cleo.playerId] = [...cards];
      unreachableMissions(s);
    });
    // (the rewrite above is a stored change of its own: the version to compare with is the stored one)
    const v0 = { version: new Store(dbPath).getRoom(t.roomId)!.version };
    const rawBefore = t.c.map((c) => c.raw.length);
    t.c[0]!.send({ type: "host", action: { type: "removePlayer", playerId: cleo.playerId } });
    const v1 = await t.c[0]!.nextView((v) => v.game!.removedPlayerIds.length === 1);
    expect(v1.version).toBe(v0.version + 1);
    expect(v1.game!.removedPlayerIds).toEqual([cleo.playerId]);
    expect(v1.players.find((p) => p.id === cleo.playerId)!.removed).toBe(true);
    expect(v1.players.find((p) => p.id === cleo.playerId)!.name).toBe("Cleo");
    expect(v1.game!.handCounts[cleo.playerId]).toBe(0);
    expect(v1.game!.discardCount).toBe(cards.length);
    expect(Object.values(v1.game!.territories).some((x) => x.ownerId === null)).toBe(true);
    expect(Object.values(v1.game!.territories).some((x) => x.ownerId === cleo.playerId)).toBe(
      false,
    );
    expect(await t.c[2]!.closed()).toBe(4004);
    // one removal = exactly one snapshot for every remaining player; the removed one gets none
    await t.c[1]!.latestView((v) => v.game?.removedPlayerIds.length === 1);
    expect(t.c[0]!.raw.length - rawBefore[0]!).toBe(1);
    expect(t.c[1]!.raw.length - rawBefore[1]!).toBe(1);
    expect(t.c[2]!.raw.length).toBe(rawBefore[2]);
    // the token is worthless: hello, HTTP join in a running game
    const again = await TestClient.connect(srv!, cleo);
    clients.push(again);
    expect(await again.closed()).toBe(4001);
    expect(errorsOf(again)).toEqual(["NOT_AUTHENTICATED"]);
    expect((await post(`${srv!.base}/api/rooms/${t.roomId}/join`, { name: "Cleo" })).status).toBe(
      409,
    );
    // nothing of the removed player reaches the others: token, hash, cards, discard pile
    for (const c of [t.c[0]!, t.c[1]!]) {
      const wire = c.raw.join("\n");
      for (const secret of [cleo.token, hashToken(cleo.token), ...cards]) {
        expect(wire).not.toContain(secret);
      }
      expect(wire).not.toContain('"discard"');
      expect(wire).not.toContain("tokenHash");
      expect(wire).not.toContain("token_hash");
    }
    // state and rows agree
    const row = new Store(dbPath).getPlayers(t.roomId);
    expect(row.filter((p) => p.removed).map((p) => p.id)).toEqual(
      stored(t.roomId).removedPlayerIds,
    );
    expect(row.find((p) => p.id === cleo.playerId)!.tokenHash).toBe("");
    expect(row.find((p) => p.id === ben.playerId)!.removed).toBe(false);
    expect(row.find((p) => p.id === host.playerId)!.isHost).toBe(true);
  });

  it("the host cannot remove himself or a removed player in a game; unknown ids are refused", async () => {
    const t = await table(3, true);
    const cleo = t.ids[2]!;
    t.c[0]!.send({ type: "host", action: { type: "removePlayer", playerId: t.ids[0]!.playerId } });
    t.c[0]!.send({ type: "host", action: { type: "removePlayer", playerId: "zed" } });
    t.c[0]!.send({ type: "host", action: { type: "removePlayer", playerId: cleo.playerId } });
    await t.c[0]!.nextView((v) => v.game!.removedPlayerIds.length === 1);
    t.c[0]!.send({ type: "host", action: { type: "removePlayer", playerId: cleo.playerId } });
    expect(await lastError(t.c[0]!, 3)).toBe("PLAYER_REMOVED");
    expect(errorsOf(t.c[0]!)).toEqual(["CANNOT_REMOVE_SELF", "UNKNOWN_PLAYER", "PLAYER_REMOVED"]);
  });

  it("skipTurn passes the turn for everybody with one version step; a stale turn is STALE_TURN", async () => {
    const t = await table(3, true);
    const v0 = await t.c[1]!.latestView();
    const turn = v0.game!.turn;
    const active = v0.game!.activePlayerId;
    t.c[0]!.send({ type: "host", reqId: "k", action: { type: "skipTurn", turn } });
    const v1 = await t.c[1]!.nextView((v) => v.game!.turn === turn + 1);
    expect(v1.version).toBe(v0.version + 1);
    expect(v1.game!.activePlayerId).not.toBe(active);
    expect(v1.game!.phase).toBe("reinforce");
    // the same turn again: stale, nothing stored
    const before = dump(t.roomId);
    t.c[0]!.send({ type: "host", reqId: "k2", action: { type: "skipTurn", turn } });
    expect(await lastError(t.c[0]!, 1)).toBe("STALE_TURN");
    expect(dump(t.roomId)).toBe(before);
    const err = t.c[0]!.messages.find((m) => m.type === "error") as { reqId?: string };
    expect(err.reqId).toBe("k2");
  });

  it("a win by removal sets the room to finished; afterwards host actions are NOT_IN_GAME", async () => {
    const t = await table(2, true);
    t.c[0]!.send({ type: "host", action: { type: "removePlayer", playerId: t.ids[1]!.playerId } });
    const v = await t.c[0]!.nextView((x) => x.status === "finished");
    expect(v.game!.winnerId).toBe(t.ids[0]!.playerId);
    expect(v.game!.winReason).toBe("lastPlayer");
    t.c[0]!.send({ type: "host", action: { type: "skipTurn", turn: v.game!.turn } });
    t.c[0]!.send({ type: "host", action: { type: "removePlayer", playerId: t.ids[1]!.playerId } });
    await lastError(t.c[0]!, 2);
    expect(errorsOf(t.c[0]!)).toEqual(["NOT_IN_GAME", "NOT_IN_GAME"]);
    expect(new Store(dbPath).getRoom(t.roomId)!.status).toBe("finished");
  });

  it("a restart in the middle of the game keeps the state, the neutral territories and the removed row", async () => {
    const t = await table(3, true);
    t.c[0]!.send({ type: "host", action: { type: "removePlayer", playerId: t.ids[2]!.playerId } });
    await t.c[0]!.nextView((v) => v.game!.removedPlayerIds.length === 1);
    clients.splice(0).forEach((c) => c.close());
    await srv!.close();
    const before = dump(t.roomId);
    await boot();
    expect(dump(t.roomId)).toBe(before);
    const c = await connect(t.ids[0]!);
    const v = await c.latestView();
    expect(v.game!.removedPlayerIds).toEqual([t.ids[2]!.playerId]);
    expect(Object.values(v.game!.territories).some((x) => x.ownerId === null)).toBe(true);
    expect(v.players[2]!.removed).toBe(true);
    expect(
      await TestClient.connect(srv!, t.ids[2]!).then((x) => (clients.push(x), x.closed())),
    ).toBe(4001);
  });
});

describe("a removed player's mission holder (differential test)", () => {
  /** Identical rooms, ids, tokens and states; only player A's mission differs. Returns the raw messages per player. */
  async function run(aMission: "eliminate-c" | "other"): Promise<Record<string, string[]>> {
    const ids = ["h", "a", "c", "d"].map((n) => ({
      roomId: "K7M2XQ",
      playerId: `id-${n}`,
      token: `tok-${n}`,
    }));
    const state = createGame({
      map: getMap("testland")!,
      rules: getRules("testland")!,
      playerIds: ids.map((i) => i.playerId),
      rng: createSeededRng(5),
      missions: getMissionSet("testland")!,
    });
    if (!state.ok) throw new Error(state.code);
    const s = state.state;
    unreachableMissions(s);
    s.activePlayerId = "id-h";
    if (aMission === "eliminate-c") {
      const m = { type: "eliminatePlayer" as const, targetPlayerId: "id-c" };
      s.secret.mission["id-a"] = m;
      s.secret.originalMission["id-a"] = m;
    }
    const dbFile = `${dir}/diff-${aMission}.sqlite`;
    const store = new Store(dbFile);
    store.createRoom(
      "K7M2XQ",
      "testland",
      { id: "id-h", name: "H", tokenHash: hashToken("tok-h") },
      Date.now(),
    );
    for (const n of ["a", "c", "d"]) {
      store.addPlayer(
        "K7M2XQ",
        { id: `id-${n}`, name: n.toUpperCase(), tokenHash: hashToken(`tok-${n}`) },
        Date.now(),
      );
    }
    store.saveGame("K7M2XQ", "playing", s, Date.now());
    store.close();
    const server = await startServer(dbFile, { rng: createSeededRng(9) });
    const cs: TestClient[] = [];
    for (const id of ids) {
      const c = await TestClient.connect(server, id);
      await c.latestView();
      cs.push(c);
    }
    const mark = cs.map((c) => c.raw.length);
    cs[0]!.send({ type: "host", action: { type: "removePlayer", playerId: "id-c" } });
    await cs[0]!.nextView((v) => v.game!.removedPlayerIds.length === 1);
    await cs[1]!.nextView((v) => v.game!.removedPlayerIds.length === 1);
    await cs[3]!.nextView((v) => v.game!.removedPlayerIds.length === 1);
    const out = Object.fromEntries(
      cs.map((c, i) => [ids[i]!.playerId, c.raw.slice(mark[i])]),
    ) as Record<string, string[]>;
    cs.forEach((c) => c.close());
    await server.close();
    return out;
  }

  it("only the holder's own message differs; everybody else gets byte-identical messages", async () => {
    const withTarget = await run("eliminate-c");
    const without = await run("other");
    expect(withTarget["id-h"]).toEqual(without["id-h"]);
    expect(withTarget["id-d"]).toEqual(without["id-d"]);
    expect(withTarget["id-c"]).toEqual(without["id-c"]); // the removed player gets nothing in both runs
    expect(withTarget["id-a"]).toHaveLength(1);
    expect(withTarget["id-a"]).not.toEqual(without["id-a"]);
    const own = JSON.parse(withTarget["id-a"]![0]!) as { view: RoomView };
    expect(own.view.game!.secret.missionReplaced).toBe(true);
    // the holder's replacement shows nowhere else: no field, no word
    for (const id of ["id-h", "id-d"]) {
      const wire = withTarget[id]!.join("\n");
      expect(wire).not.toContain("eliminatePlayer");
      expect(wire).not.toContain("originalMission");
      expect(wire).not.toContain('"missionReplaced":true');
    }
  });
});

describe("back to the lobby", () => {
  async function finishedTable() {
    const t = await table(3, true, ["Anna", "Ben", "Cleo"]);
    t.c[0]!.send({ type: "host", action: { type: "removePlayer", playerId: t.ids[2]!.playerId } });
    await t.c[0]!.nextView((v) => v.game!.removedPlayerIds.length === 1);
    // a prepared end: Anna wins by mission with one more action
    rewrite(t.roomId, (s) => {
      s.activePlayerId = t.ids[0]!.playerId;
      s.phase = "reinforce";
      s.reinforcementsLeft = 2;
      s.secret.mission[t.ids[0]!.playerId] = { type: "holdTerritories", count: 1, minArmies: 1 };
      s.secret.originalMission[t.ids[0]!.playerId] = s.secret.mission[t.ids[0]!.playerId]!;
      s.secret.missionReplaced[t.ids[0]!.playerId] = false;
    });
    const own = Object.entries(stored(t.roomId).territories).find(
      ([, x]) => x.ownerId === t.ids[0]!.playerId,
    )![0];
    t.c[0]!.send({ type: "action", action: { type: "placeArmies", territoryId: own, count: 1 } });
    await t.c[0]!.nextView((v) => v.status === "finished");
    return t;
  }

  it("only the host, only when finished; then everybody is in the lobby again with the next game number", async () => {
    const t = await finishedTable();
    const [anna, ben] = t.ids as [Identity, Identity, Identity];
    const vEnd = await t.c[1]!.latestView((v) => v.status === "finished");
    // a guest cannot, the host can
    t.c[1]!.send({ type: "backToLobby" });
    expect(await lastError(t.c[1]!, 1)).toBe("NOT_HOST");
    const marks = t.c.map((c) => c.views().length);
    t.c[0]!.send({ type: "backToLobby" });
    const v0 = await t.c[0]!.nextView((v) => v.status === "lobby");
    const v1 = await t.c[1]!.nextView((v) => v.status === "lobby");
    expect(v0.game).toBeNull();
    expect(v0.gameNo).toBe(2);
    expect(v0.version).toBe(vEnd.version + 1);
    expect(v1.version).toBe(v0.version);
    // exactly one lobby snapshot each; the removed player (his connection ended) gets none
    expect(t.c[0]!.views().length - marks[0]!).toBe(1);
    expect(t.c[1]!.views().length - marks[1]!).toBe(1);
    // seats, names, host stay; the removed player's row is gone; map and mode are kept
    expect(v0.players.map((p) => [p.name, p.seat, p.isHost])).toEqual([
      ["Anna", 0, true],
      ["Ben", 1, false],
    ]);
    expect(v0.mapId).toBe("testland");
    expect(v0.victoryMode).toBe("missions");
    // the tokens still work after a restart of the server in between, and the lobby is open again
    clients.splice(0).forEach((c) => c.close());
    await srv!.close();
    await boot();
    const room = new Store(dbPath).getRoom(t.roomId)!;
    expect(room.status).toBe("lobby");
    expect(room.stateJson).toBeNull();
    const a = await connect(anna);
    const b = await connect(ben);
    expect((await a.latestView()).gameNo).toBe(2);
    const cleo2 = await joinRoom(srv!, t.roomId, "Cleo"); // the freed name and seat
    expect(cleo2.playerId).not.toBe(t.ids[2]!.playerId);
    // another game: a fresh state (counters at zero), game number 2 stays; the host changes the mode first
    a.send({ type: "settings", victoryMode: "domination" });
    await b.nextView((v) => v.victoryMode === "domination");
    a.send({ type: "start" });
    const g = await b.nextView((v) => v.status === "playing");
    expect(g.gameNo).toBe(2);
    expect(g.game!.lastCombat).toBeNull();
    expect(g.game!.lastTrade).toBeNull();
    expect(g.game!.removedPlayerIds).toEqual([]);
    expect(g.game!.turn).toBe(1);
    const state = stored(t.roomId);
    expect(state.combatSeq).toBe(0);
    expect(state.tradeSeq).toBe(0);
    expect(state.stateVersion).toBe(10);
    expect(state.playerOrder).toHaveLength(3);
    expect(g.version).toBeGreaterThan(v0.version);
  });

  it("is refused before the end and in the lobby; a second call after the return is NOT_FINISHED", async () => {
    const t = await finishedTable();
    t.c[0]!.send({ type: "backToLobby" });
    await t.c[0]!.nextView((v) => v.status === "lobby");
    t.c[0]!.send({ type: "backToLobby" });
    expect(await lastError(t.c[0]!, 1)).toBe("NOT_FINISHED");
  });
});

describe("a state with a newer version and host messages", () => {
  it("is never touched: skipTurn, removePlayer and backToLobby answer STATE_UNSUPPORTED", async () => {
    const t = await table(3, true);
    const roomId = t.roomId;
    const db = new Database(dbPath);
    const raw = JSON.parse(
      (
        db.prepare("SELECT state_json FROM rooms WHERE id = ?").get(roomId) as {
          state_json: string;
        }
      ).state_json,
    ) as Record<string, unknown>;
    raw["stateVersion"] = 11;
    db.prepare("UPDATE rooms SET state_json = ? WHERE id = ?").run(JSON.stringify(raw), roomId);
    db.close();
    const before = dump(roomId);
    t.c[0]!.send({ type: "host", action: { type: "skipTurn", turn: 1 } });
    t.c[0]!.send({ type: "host", action: { type: "removePlayer", playerId: t.ids[2]!.playerId } });
    expect(await lastError(t.c[0]!, 2)).toBe("STATE_UNSUPPORTED");
    expect(errorsOf(t.c[0]!)).toEqual(["STATE_UNSUPPORTED", "STATE_UNSUPPORTED"]);
    // a finished room with such a state keeps it when the host asks for the lobby
    const db2 = new Database(dbPath);
    db2.prepare("UPDATE rooms SET status = 'finished' WHERE id = ?").run(roomId);
    db2.close();
    const beforeFinished = dump(roomId);
    t.c[0]!.send({ type: "backToLobby" });
    expect(await lastError(t.c[0]!, 3)).toBe("STATE_UNSUPPORTED");
    expect(dump(roomId)).toBe(beforeFinished);
    expect(before).not.toBe(beforeFinished); // (only the status differs between the two dumps)
    expect(CREATE_CODE).toBeTruthy();
  });
});

describe("host handover (transferHost, questions 23, 32, 33)", () => {
  const give = (to: string, reqId?: string) => ({
    type: "host",
    ...(reqId ? { reqId } : {}),
    action: { type: "transferHost", playerId: to },
  });

  it("moves the role to a connected player: one host, version + 1, one snapshot each, right you.isHost for everybody", async () => {
    const t = await table(3, false, ["Anna", "Ben", "Cleo"]);
    const [anna, ben, cleo] = t.ids as [Identity, Identity, Identity];
    const v0 = await t.c[0]!.latestView();
    const marks = t.c.map((c) => c.raw.length);
    t.c[0]!.send(give(ben.playerId));
    const views = await Promise.all(
      t.c.map((c) =>
        c.nextView(
          (v) =>
            v.you.isHost !== (c === t.c[0] ? true : false) ||
            v.players.some((p) => p.id === ben.playerId && p.isHost),
        ),
      ),
    );
    expect(views.map((v) => v.you.isHost)).toEqual([false, true, false]);
    for (const v of views) {
      expect(v.version).toBe(v0.version + 1);
      expect(v.players.filter((p) => p.isHost).map((p) => p.name)).toEqual(["Ben"]);
    }
    t.c.forEach((c, i) => expect(c.raw.length - marks[i]!).toBe(1));
    const rows = new Store(dbPath).getPlayers(t.roomId);
    expect(rows.filter((p) => p.isHost).map((p) => p.id)).toEqual([ben.playerId]);
    // the old host has no host rights any more, the new one has all of them (even on seat 1)
    t.c[0]!.send({ type: "settings", victoryMode: "domination" });
    t.c[0]!.send({ type: "start" });
    expect(await lastError(t.c[0]!, 2)).toBe("NOT_HOST");
    t.c[1]!.send({ type: "settings", victoryMode: "domination" });
    await t.c[2]!.nextView((v) => v.victoryMode === "domination");
    // the new host removes the old one in the lobby; the removed old host is out
    t.c[1]!.send({ type: "host", action: { type: "removePlayer", playerId: anna.playerId } });
    expect(await t.c[0]!.closed()).toBe(4004);
    const left = await t.c[2]!.latestView((v) => v.players.length === 2);
    expect(left.players.map((p) => [p.name, p.seat, p.isHost])).toEqual([
      ["Ben", 1, true],
      ["Cleo", 2, false],
    ]);
    // start works with the host on seat 1
    t.c[1]!.send({ type: "start" });
    const g = await t.c[2]!.nextView((v) => v.status === "playing");
    expect(g.you.isHost).toBe(false);
    expect(cleo.playerId).toBe(g.you.playerId);
  });

  it("errors in order: NOT_HOST, UNKNOWN_PLAYER, PLAYER_REMOVED, ALREADY_HOST (also himself), NOT_PRESENT; nothing is stored", async () => {
    const t = await table(3, true, ["Anna", "Ben", "Cleo"]);
    const [anna, ben, cleo] = t.ids as [Identity, Identity, Identity];
    // a guest gives nothing away
    t.c[1]!.send(give(cleo.playerId));
    expect(await lastError(t.c[1]!, 1)).toBe("NOT_HOST");
    t.c[0]!.send({ type: "host", action: { type: "removePlayer", playerId: cleo.playerId } });
    await t.c[0]!.latestView((v) => v.game?.removedPlayerIds.length === 1);
    // Ben disconnects
    t.c[1]!.close();
    await vi.waitFor(() => expect(srv!.hub.isConnected(t.roomId, ben.playerId)).toBe(false));
    const before = dump(t.roomId);
    t.c[0]!.send(give("nobody"));
    t.c[0]!.send(give(cleo.playerId));
    t.c[0]!.send(give(anna.playerId));
    t.c[0]!.send(give(ben.playerId, "r"));
    expect(await lastError(t.c[0]!, 4)).toBe("NOT_PRESENT");
    expect(errorsOf(t.c[0]!)).toEqual([
      "UNKNOWN_PLAYER",
      "PLAYER_REMOVED",
      "ALREADY_HOST",
      "NOT_PRESENT",
    ]);
    expect(dump(t.roomId)).toBe(before);
    expect(new Store(dbPath).getPlayers(t.roomId).find((p) => p.id === anna.playerId)!.isHost).toBe(
      true,
    );
  });

  it("works in a running game and after the end; the game state is untouched; back to the lobby keeps the new host", async () => {
    const t = await table(3, true, ["Anna", "Ben", "Cleo"]);
    const [anna, ben] = t.ids as [Identity, Identity, Identity];
    const stateBefore = JSON.stringify(stored(t.roomId));
    t.c[0]!.send(give(ben.playerId));
    await t.c[1]!.nextView((v) => v.you.isHost);
    expect(JSON.stringify(stored(t.roomId))).toBe(stateBefore);
    // Ben ends the game by removing Cleo and Anna? He cannot remove himself; Anna and Cleo leave, Ben wins
    t.c[1]!.send({ type: "host", action: { type: "removePlayer", playerId: t.ids[2]!.playerId } });
    t.c[1]!.send({ type: "host", action: { type: "removePlayer", playerId: anna.playerId } });
    const end = await t.c[1]!.nextView((v) => v.status === "finished");
    expect(end.game!.winnerId).toBe(ben.playerId);
    // after the end the role can still move; Cleo and Anna are removed, so Ben has nobody: PLAYER_REMOVED
    t.c[1]!.send(give(anna.playerId));
    expect(await lastError(t.c[1]!, 1)).toBe("PLAYER_REMOVED");
    t.c[1]!.send({ type: "backToLobby" });
    const lobby = await t.c[1]!.nextView((v) => v.status === "lobby");
    expect(lobby.you.isHost).toBe(true);
    expect(lobby.players.map((p) => [p.name, p.seat, p.isHost])).toEqual([["Ben", 1, true]]);
  });

  it("after the end the role moves between connected players; a restart keeps the host", async () => {
    const t = await table(2, true, ["Anna", "Ben"]);
    const [anna, ben] = t.ids as [Identity, Identity];
    rewrite(
      t.roomId,
      (s) => {
        s.winnerId = anna.playerId;
        s.winReason = "lastPlayer";
      },
      "finished" as never,
    );
    t.c[0]!.send(give(ben.playerId));
    await t.c[1]!.nextView((v) => v.you.isHost);
    clients.splice(0).forEach((c) => c.close());
    await srv!.close();
    await boot();
    const b = await connect(ben);
    const a = await connect(anna);
    expect((await b.latestView()).you.isHost).toBe(true);
    expect((await a.latestView()).you.isHost).toBe(false);
    expect((await b.latestView()).status).toBe("finished");
  });

  it("only isHost changes on the wire: a guest's snapshots before and after differ in the host marks and the version", async () => {
    const t = await table(3, true, ["Anna", "Ben", "Cleo"]);
    const before = await t.c[2]!.latestView();
    t.c[0]!.send(give(t.ids[1]!.playerId));
    const after = await t.c[2]!.nextView((v) => v.version > before.version);
    const normalize = (v: RoomView) => ({
      ...v,
      version: 0,
      players: v.players.map((p) => ({ ...p, isHost: false })),
    });
    expect(normalize(after)).toEqual(normalize(before));
    const wire = t.c.flatMap((c) => c.raw).join("\n");
    for (const id of t.ids) {
      expect(wire).not.toContain(id.token);
      expect(wire).not.toContain(hashToken(id.token));
    }
  });

  it("a transfer message with a foreign sender field is invalid; the sender is the connection", async () => {
    const t = await table(2, false);
    const before = dump(t.roomId);
    t.c[1]!.send({
      type: "host",
      playerId: t.ids[0]!.playerId,
      action: { type: "transferHost", playerId: t.ids[1]!.playerId },
    });
    t.c[1]!.send(give(t.ids[1]!.playerId));
    expect(await lastError(t.c[1]!, 2)).toBe("NOT_HOST");
    expect(errorsOf(t.c[1]!)).toEqual(["BAD_MESSAGE", "NOT_HOST"]);
    expect(dump(t.roomId)).toBe(before);
  });

  it("counts as activity for the cleanup", async () => {
    const t = await table(2, false);
    const before = new Store(dbPath).getRoom(t.roomId)!.lastActivityAt;
    await new Promise((r) => setTimeout(r, 5));
    t.c[0]!.send(give(t.ids[1]!.playerId));
    await t.c[1]!.nextView((v) => v.you.isHost);
    expect(new Store(dbPath).getRoom(t.roomId)!.lastActivityAt).toBeGreaterThan(before);
  });
});
