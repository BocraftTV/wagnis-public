import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
import type { GameState } from "@wagnis/engine";
import type { RoomView } from "@wagnis/shared";

let dir: string;
let srv: TestServer;
let dbPath: string;
const clients: TestClient[] = [];

async function connect(id: Identity, opts?: Parameters<typeof TestClient.connect>[2]) {
  const c = await TestClient.connect(srv, id, opts);
  clients.push(c);
  return c;
}

beforeEach(async () => {
  dir = makeTmpDir();
  dbPath = `${dir}/db.sqlite`;
  srv = await startServer(dbPath);
});
afterEach(async () => {
  clients.splice(0).forEach((c) => c.close());
  await srv.close();
  removeDir(dir);
});

/** Host + one joined player, both connected, game started. */
async function startedGame() {
  const host = await createRoom(srv, "Host");
  const guest = await joinRoom(srv, host.roomId, "Gast");
  const a = await connect(host);
  const b = await connect(guest);
  await a.latestView();
  await b.latestView();
  a.send({ type: "start" });
  const va = await a.nextView((v) => v.status === "playing");
  const vb = await b.latestView((v) => v.status === "playing");
  return { host, guest, a, b, va, vb };
}

function actorOf(view: RoomView, a: TestClient, b: TestClient, host: Identity) {
  return view.game!.activePlayerId === host.playerId ? { me: a, other: b } : { me: b, other: a };
}

describe("hello and snapshots", () => {
  it("answers a valid hello with a full lobby snapshot", async () => {
    const host = await createRoom(srv, "Jakob");
    const c = await connect(host);
    const view = await c.latestView();
    expect(view).toMatchObject({
      roomId: host.roomId,
      status: "lobby",
      mapId: "testland",
      version: 0,
      game: null,
      you: { playerId: host.playerId, isHost: true },
    });
    expect(view.players).toEqual([
      {
        id: host.playerId,
        name: "Jakob",
        seat: 0,
        isHost: true,
        connected: true,
        removed: false,
      },
    ]);
  });

  it("accepts a normalized room id in hello", async () => {
    const host = await createRoom(srv);
    const c = await TestClient.connect(srv, {
      ...host,
      roomId: `${host.roomId.slice(0, 3)}-${host.roomId.slice(3)}`.toLowerCase(),
    });
    clients.push(c);
    expect((await c.latestView()).roomId).toBe(host.roomId);
  });

  it("closes with 4001 on a wrong token, unknown room, or a non-hello first message", async () => {
    const host = await createRoom(srv);
    const wrong = await connect({ ...host, token: "nope" });
    expect(await wrong.closed()).toBe(4001);
    const unknown = await connect({ ...host, roomId: "ZZZZZZ" });
    expect(await unknown.closed()).toBe(4001);
    const early = await TestClient.connect(srv);
    early.send({ type: "start" });
    expect(await early.closed()).toBe(4001);
    expect(early.views()).toHaveLength(0);
  });

  it("closes a connection that sends no hello within the timeout", async () => {
    await srv.close();
    srv = await startServer(dbPath, { helloTimeoutMs: 150 });
    const c = await TestClient.connect(srv);
    clients.push(c);
    expect(await c.closed()).toBe(4001);
  });

  it("tells presence changes to others with an unchanged version", async () => {
    const host = await createRoom(srv, "Host");
    const guest = await joinRoom(srv, host.roomId, "Gast");
    const a = await connect(host);
    const first = await a.latestView();
    expect(first.players.find((p) => p.id === guest.playerId)?.connected).toBe(false);
    const b = await connect(guest);
    const joined = await a.nextView((v) => v.players.every((p) => p.connected));
    expect(joined.version).toBe(first.version);
    b.close();
    const left = await a.nextView(
      (v) => !v.players.find((p) => p.id === guest.playerId)!.connected,
    );
    expect(left.version).toBe(first.version);
  });

  it("lets the newest connection of an identity replace the old one", async () => {
    const host = await createRoom(srv, "Host");
    const guest = await joinRoom(srv, host.roomId, "Gast");
    const b = await connect(guest);
    const a1 = await connect(host);
    await a1.latestView();
    const a2 = await connect(host);
    expect(await a1.closed()).toBe(4002);
    const view = await a2.latestView();
    expect(view.players.find((p) => p.id === host.playerId)?.connected).toBe(true);
    // the other player never saw the host as disconnected after the replacement settled
    await new Promise((r) => setTimeout(r, 100));
    const last = (await b.latestView()).players.find((p) => p.id === host.playerId);
    expect(last?.connected).toBe(true);
  });

  it("answers invalid messages with BAD_MESSAGE and keeps the connection", async () => {
    const host = await createRoom(srv);
    const c = await connect(host);
    await c.latestView();
    c.send({ type: "nope" });
    c.send({ type: "hello", roomId: host.roomId, token: host.token });
    c.socket.send("not json");
    await c.waitFor(() =>
      c.messages.filter((m) => m.type === "error").length >= 3 ? true : undefined,
    );
    expect(
      c.messages
        .filter((m) => m.type === "error")
        .every((m) => m.type === "error" && m.code === "BAD_MESSAGE"),
    ).toBe(true);
    expect(c.closeCode).toBeUndefined();
  });
});

describe("start and actions", () => {
  it("allows only the host to start, with at least 2 players", async () => {
    const host = await createRoom(srv, "Host");
    const a = await connect(host);
    await a.latestView();
    a.send({ type: "start" });
    await a.waitFor(() =>
      a.messages.find((m) => m.type === "error" && m.code === "NOT_ENOUGH_PLAYERS"),
    );
    const guest = await joinRoom(srv, host.roomId, "Gast");
    const b = await connect(guest);
    await b.latestView();
    b.send({ type: "start" });
    await b.waitFor(() => b.messages.find((m) => m.type === "error" && m.code === "NOT_HOST"));
    a.send({ type: "action", reqId: "r0", action: { type: "endPhase" } });
    await a.waitFor(() =>
      a.messages.find((m) => m.type === "error" && m.code === "NOT_IN_GAME" && m.reqId === "r0"),
    );
  });

  it("starts the game and gives every player an own snapshot with a bumped version", async () => {
    const { va, vb } = await startedGame();
    expect(va.version).toBe(vb.version);
    expect(va.version).toBeGreaterThan(0);
    expect(va.you.playerId).not.toBe(vb.you.playerId);
    expect(va.game?.phase).toBe("reinforce");
    expect(Object.keys(va.game!.territories)).toHaveLength(8);
    expect(va.game).toEqual(vb.game ? { ...vb.game, secret: va.game!.secret } : null);
  });

  it("plays a complete turn and passes it on", async () => {
    const { host, a, b, va } = await startedGame();
    const { me, other } = actorOf(va, a, b, host);
    const mine = Object.entries(va.game!.territories).find(
      ([, t]) => t.ownerId === va.game!.activePlayerId,
    )![0];

    me.send({ type: "action", reqId: "x1", action: { type: "endPhase" } });
    await me.waitFor(() =>
      me.messages.find(
        (m) => m.type === "error" && m.code === "REINFORCEMENTS_REMAINING" && m.reqId === "x1",
      ),
    );
    other.send({ type: "action", reqId: "x2", action: { type: "endPhase" } });
    await other.waitFor(() =>
      other.messages.find(
        (m) => m.type === "error" && m.code === "NOT_YOUR_TURN" && m.reqId === "x2",
      ),
    );

    let view = va;
    for (let i = 0; i < va.game!.reinforcementsLeft; i++) {
      me.send({ type: "action", action: { type: "placeArmies", territoryId: mine, count: 1 } });
      view = await me.nextView();
      expect(view.game!.territories[mine]!.armies).toBe(va.game!.territories[mine]!.armies + i + 1);
    }
    expect(view.game!.reinforcementsLeft).toBe(0);
    for (let i = 0; i < 3; i++) {
      me.send({ type: "action", action: { type: "endPhase" } });
      view = await me.nextView();
    }
    expect(view.game!.activePlayerId).not.toBe(va.game!.activePlayerId);
    expect(view.game!.turn).toBe(2);
    expect(view.game!.phase).toBe("reinforce");
    const otherView = await other.latestView((v) => v.game?.turn === 2);
    expect(otherView.version).toBe(view.version);
  });
});

describe("secrets on the wire", () => {
  it("never sends another player's secret fields to a client", async () => {
    const { host, guest, a, b, va } = await startedGame();
    const MARK_B = "GEHEIM-B-4f8e1c";
    const MARK_A = "GEHEIM-A-92d7b0";
    const store = new Store(dbPath);
    const room = store.getRoom(host.roomId)!;
    const state = JSON.parse(room.stateJson!) as GameState;
    state.secret.mission[guest.playerId] = {
      type: "conquerContinents",
      continentIds: [`${MARK_B}-mission`],
      extraContinents: 0,
    };
    state.secret.hand[guest.playerId] = ["card-joker-2"];
    state.secret.mission[host.playerId] = {
      type: "conquerContinents",
      continentIds: [`${MARK_A}-mission`],
      extraContinents: 0,
    };
    state.secret.hand[host.playerId] = ["card-joker-1", "card-eisenfurt"];
    store.saveGame(host.roomId, "playing", state, Date.now());
    store.close();

    // trigger a broadcast by playing an action
    const { me } = actorOf(va, a, b, host);
    const mine = Object.entries(va.game!.territories).find(
      ([, t]) => t.ownerId === va.game!.activePlayerId,
    )![0];
    me.send({ type: "action", action: { type: "placeArmies", territoryId: mine, count: 1 } });
    await a.nextView((v) => v.game!.secret.mission !== null);
    await b.nextView((v) => v.game!.secret.mission !== null);

    const wireA = a.raw.join("\n");
    const wireB = b.raw.join("\n");
    expect(wireA).not.toContain(MARK_B);
    expect(wireB).not.toContain(MARK_A);
    expect(wireA).toContain(`${MARK_A}-mission`);
    expect(wireA).not.toContain("card-joker-2"); // B's card
    expect(wireB).not.toContain("card-joker-1"); // A's cards
    expect(wireB).not.toContain("card-eisenfurt");
    expect(wireB).toContain("card-joker-2");
    expect(wireA).toContain("card-joker-1");
    const lastA = await a.latestView();
    expect(lastA.game!.handCounts).toEqual({ [host.playerId]: 2, [guest.playerId]: 1 });
    // nothing resembling raw server state
    for (const wire of [wireA, wireB]) {
      expect(wire).not.toContain("tokenHash");
      expect(wire).not.toContain("token_hash");
      expect(wire).not.toContain('"rules"');
    }
  });
});

describe("reconnect and restart", () => {
  it("gives a reconnecting client the same version and content", async () => {
    const { host, a, b } = await startedGame();
    const before = await a.latestView();
    a.close();
    await a.closed();
    await b.nextView((v) => !v.players.find((p) => p.id === host.playerId)!.connected);
    const a2 = await connect(host);
    const after = await a2.latestView();
    expect(after).toEqual(before);
    expect(after.version).toBe(before.version);
  });

  it("survives a server restart on the same database file", async () => {
    const { host, guest, a, b, va } = await startedGame();
    const { me } = actorOf(va, a, b, host);
    const mine = Object.entries(va.game!.territories).find(
      ([, t]) => t.ownerId === va.game!.activePlayerId,
    )![0];
    me.send({ type: "action", action: { type: "placeArmies", territoryId: mine, count: 1 } });
    const played = await me.nextView();
    clients.splice(0).forEach((c) => c.close());
    await srv.close();

    srv = await startServer(dbPath);
    const back = await connect(guest);
    const view = await back.latestView();
    expect(view.status).toBe("playing");
    expect(view.version).toBe(played.version);
    expect(view.game!.territories).toEqual(played.game!.territories);
    expect(view.game!.phase).toBe(played.game!.phase);
    expect(view.players.find((p) => p.id === host.playerId)?.connected).toBe(false);
    const hostBack = await connect(host);
    await hostBack.latestView();
    // and the game continues
    const active = view.game!.activePlayerId === host.playerId ? hostBack : back;
    const left = view.game!.reinforcementsLeft;
    if (left > 0) {
      active.send({
        type: "action",
        action: {
          type: "placeArmies",
          territoryId: Object.entries(view.game!.territories).find(
            ([, t]) => t.ownerId === view.game!.activePlayerId,
          )![0],
          count: left,
        },
      });
      expect((await active.nextView()).version).toBe(view.version + 1);
    }
  });
});

describe("heartbeat", () => {
  it("drops a connection that never answers pings and marks the player absent", async () => {
    await srv.close();
    srv = await startServer(dbPath, { heartbeatIntervalMs: 40 });
    const host = await createRoom(srv, "Host");
    const guest = await joinRoom(srv, host.roomId, "Gast");
    const a = await connect(host);
    await a.latestView();
    const mute = await connect(guest, { autoPong: false });
    await mute.latestView();
    await a.waitFor(() => a.views().find((v) => v.players.every((p) => p.connected)));
    expect(await mute.closed(2000)).toBeTypeOf("number");
    const gone = await a.nextView(
      (v) => !v.players.find((p) => p.id === guest.playerId)!.connected,
    );
    expect(gone.players.find((p) => p.id === host.playerId)?.connected).toBe(true);
  });

  it("keeps connections that answer pings", async () => {
    await srv.close();
    srv = await startServer(dbPath, { heartbeatIntervalMs: 40 });
    const host = await createRoom(srv);
    const a = await connect(host);
    await a.latestView();
    await new Promise((r) => setTimeout(r, 300));
    expect(a.closeCode).toBeUndefined();
  });
});
