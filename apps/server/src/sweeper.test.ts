import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { hashToken } from "./crypto.js";
import { Hub } from "./hub.js";
import { IDLE_MS, SWEEP_INTERVAL_MS, startSweeper, sweepIdleRooms } from "./sweeper.js";
import { Store } from "./store.js";
import {
  type Identity,
  TestClient,
  type TestServer,
  createRoom,
  joinRoom,
  makeTmpDir,
  post,
  removeDir,
  startServer,
} from "./test-helpers.js";
import type { GameState } from "@wagnis/engine";
import { createGame, createSeededRng, getMap, getMissionSet, getRules } from "@wagnis/engine";

// Plan 007, step 8: the cleanup of idle rooms (rules.md 10.4) with a steerable clock; nothing waits for real time.

const H = 60 * 60 * 1000;
let dir: string;
let dbPath: string;
let srv: TestServer | undefined;
const clients: TestClient[] = [];
const logLines: string[] = [];
let clock = 1_000_000;

beforeEach(() => {
  dir = makeTmpDir();
  dbPath = `${dir}/db.sqlite`;
  logLines.length = 0;
  clock = 1_000_000;
});
afterEach(async () => {
  vi.useRealTimers();
  clients.splice(0).forEach((c) => c.close());
  await srv?.close();
  srv = undefined;
  removeDir(dir);
});

const boot = async (extra = {}) =>
  (srv = await startServer(dbPath, {
    now: () => clock,
    logger: { level: "info", stream: { write: (l: string) => void logLines.push(l) } },
    ...extra,
  }));
async function connect(id: Identity): Promise<TestClient> {
  const c = await TestClient.connect(srv!, id);
  clients.push(c);
  await c.latestView();
  return c;
}
const activity = (roomId: string): number | undefined => srv!.store.getRoom(roomId)?.lastActivityAt;
const sweep = (maxIdleMs = IDLE_MS) =>
  sweepIdleRooms({ store: srv!.store, hub: srv!.hub, now: () => clock, maxIdleMs });

/** A room of each kind, written through the store at the current clock. */
function threeRooms(store: Store): { lobby: string; playing: string; finished: string } {
  const game = (n: number): GameState => {
    const r = createGame({
      map: getMap("testland")!,
      rules: getRules("testland")!,
      playerIds: Array.from({ length: n }, (_, i) => `p${i}`),
      rng: createSeededRng(3),
      missions: getMissionSet("testland")!,
    });
    if (!r.ok) throw new Error(r.code);
    return r.state;
  };
  const make = (id: string): void => {
    store.createRoom(id, "testland", { id: `${id}-h`, name: "H", tokenHash: hashToken(id) }, clock);
    store.addPlayer(id, { id: `${id}-g`, name: "G", tokenHash: hashToken(id + "g") }, clock);
  };
  make("LOBBY2");
  make("PLAYNG");
  make("FINISH");
  const s = game(2);
  store.saveGame("PLAYNG", "playing", s, clock);
  store.saveGame("FINISH", "finished", { ...s, winnerId: "p0", winReason: "lastPlayer" }, clock);
  return { lobby: "LOBBY2", playing: "PLAYNG", finished: "FINISH" };
}

describe("sweepIdleRooms with a steerable clock", () => {
  it("keeps rooms idle for 47 hours and deletes those idle for 49 hours: lobby, running and finished alike", async () => {
    await boot();
    const rooms = threeRooms(srv!.store);
    clock += 47 * H;
    expect(sweep()).toBe(0);
    for (const id of Object.values(rooms)) expect(srv!.store.getRoom(id)).toBeDefined();
    clock += 2 * H;
    expect(sweep()).toBe(3);
    for (const id of Object.values(rooms)) {
      expect(srv!.store.getRoom(id)).toBeUndefined();
      expect(srv!.store.getPlayers(id)).toEqual([]);
    }
    expect(sweep()).toBe(0);
  });

  it("the boundary: exactly 48 hours is not yet more than 48 hours", async () => {
    await boot();
    const { lobby } = threeRooms(srv!.store);
    clock += 48 * H;
    expect(sweep()).toBe(0);
    clock += 1;
    expect(sweep()).toBe(3);
    expect(srv!.store.getRoom(lobby)).toBeUndefined();
  });

  it("a room with a connection is never idle, however long nothing happens; the clock restarts when it ends", async () => {
    await boot();
    const host = await createRoom(srv!, "Anna");
    const other = await createRoom(srv!, "Bert");
    const c = await connect(host);
    clock += 49 * H;
    expect(sweep()).toBe(1); // Bert's room only
    expect(srv!.store.getRoom(other.roomId)).toBeUndefined();
    expect(srv!.store.getRoom(host.roomId)).toBeDefined();
    clock += 100 * H;
    expect(sweep()).toBe(0);
    // the connection ends: the idle clock starts from there
    const endedAt = clock;
    c.close();
    await vi.waitFor(() => expect(activity(host.roomId)).toBe(endedAt));
    clock = endedAt + 47 * H;
    expect(sweep()).toBe(0);
    clock = endedAt + 49 * H;
    expect(sweep()).toBe(1);
    expect(srv!.store.getRoom(host.roomId)).toBeUndefined();
  });

  it("a deleted room is gone for everybody: join is ROOM_NOT_FOUND, hello is refused with 4001; the code can be reused", async () => {
    await boot();
    const host = await createRoom(srv!, "Anna");
    clock += 49 * H;
    sweep();
    expect(
      (await post(`${srv!.base}/api/rooms/${host.roomId}/join`, { name: "Zoe" })).body.error.code,
    ).toBe("ROOM_NOT_FOUND");
    const c = await TestClient.connect(srv!, host);
    clients.push(c);
    expect(await c.closed()).toBe(4001);
    expect(c.messages.map((m) => (m.type === "error" ? m.code : m.type))).toEqual([
      "NOT_AUTHENTICATED",
    ]);
  });
});

describe("what counts as activity", () => {
  it("every path sets the idle clock: create, join, hello, close, start, settings, action, host actions, back to the lobby", async () => {
    await boot();
    clock = 5_000_000;
    const host = await createRoom(srv!, "Anna");
    expect(activity(host.roomId)).toBe(5_000_000);
    clock += H;
    const ben = await joinRoom(srv!, host.roomId, "Ben");
    expect(activity(host.roomId)).toBe(clock);
    clock += H;
    const a = await connect(host); // hello
    expect(activity(host.roomId)).toBe(clock);
    const b = await connect(ben);
    clock += H;
    a.send({ type: "settings", victoryMode: "domination" });
    await a.nextView((v) => v.victoryMode === "domination");
    expect(activity(host.roomId)).toBe(clock);
    clock += H;
    a.send({ type: "start" });
    await a.nextView((v) => v.status === "playing");
    expect(activity(host.roomId)).toBe(clock);
    const g = await a.latestView();
    const active = g.game!.activePlayerId === host.playerId ? a : b;
    clock += H;
    const own = Object.entries(g.game!.territories).find(
      ([, t]) => t.ownerId === g.game!.activePlayerId,
    )![0];
    active.send({
      type: "action",
      action: { type: "placeArmies", territoryId: own, count: g.game!.reinforcementsLeft },
    });
    await a.nextView((v) => v.game!.reinforcementsLeft === 0);
    expect(activity(host.roomId)).toBe(clock);
    clock += H;
    a.send({ type: "host", action: { type: "skipTurn", turn: g.game!.turn } });
    await a.nextView((v) => v.game!.turn === g.game!.turn + 1);
    expect(activity(host.roomId)).toBe(clock);
    clock += H;
    a.send({ type: "host", action: { type: "removePlayer", playerId: ben.playerId } });
    await a.nextView((v) => v.status === "finished");
    expect(activity(host.roomId)).toBe(clock);
    clock += H;
    a.send({ type: "backToLobby" });
    await a.nextView((v) => v.status === "lobby");
    expect(activity(host.roomId)).toBe(clock);
    clock += H;
    const ended = clock;
    a.close();
    await vi.waitFor(() => expect(activity(host.roomId)).toBe(ended));
  });

  it("a lobby removal counts too", async () => {
    await boot();
    const host = await createRoom(srv!, "Anna");
    const ben = await joinRoom(srv!, host.roomId, "Ben");
    const a = await connect(host);
    clock += 3 * H;
    a.send({ type: "host", action: { type: "removePlayer", playerId: ben.playerId } });
    await a.nextView((v) => v.players.length === 1);
    expect(activity(host.roomId)).toBe(clock);
  });
});

describe("startup, timer and logs", () => {
  it("sweeps at the start, before the first request; the time the server did not run counts as idle (plan assumption)", async () => {
    await boot();
    const host = await createRoom(srv!, "Anna");
    await srv!.close();
    srv = undefined;
    clock += 50 * H; // the server was down for 50 hours
    await boot();
    expect(srv!.store.getRoom(host.roomId)).toBeUndefined();
    expect(logLines.join("\n")).toContain("idle rooms removed");
    // a restart inside the 48 hours extends nothing and deletes nothing
    const again = await createRoom(srv!, "Zoe");
    await srv!.close();
    srv = undefined;
    clock += 47 * H;
    await boot();
    expect(srv!.store.getRoom(again.roomId)).toBeDefined();
    await srv!.close();
    srv = undefined;
    clock += 2 * H; // 49 hours after the last activity: gone although the server restarted in between
    await boot();
    expect(srv!.store.getRoom(again.roomId)).toBeUndefined();
  });

  it("the log holds only a number: no room code, name, token or state", async () => {
    await boot();
    const r = await createRoom(srv!, "Annabelle");
    const g = await joinRoom(srv!, r.roomId, "Bertram");
    await srv!.close();
    srv = undefined;
    logLines.length = 0;
    clock += 49 * H;
    await boot(); // the sweep at the start deletes the room and logs
    const log = logLines.join("\n");
    expect(log).toContain("idle rooms removed");
    expect(log).toMatch(/"deleted":1\b/);
    for (const secret of [r.roomId, "Annabelle", "Bertram", r.token, g.token, hashToken(r.token)]) {
      expect(log, secret).not.toContain(secret);
    }
  });

  it("startSweeper runs once at the start and then every interval; stop ends it", () => {
    vi.useFakeTimers();
    const calls: number[] = [];
    const store = {
      deleteIdleRooms: (cutoff: number) => (calls.push(cutoff), calls.length === 2 ? 2 : 0),
    };
    const hub = { connectedRoomIds: () => [] };
    const swept: number[] = [];
    const s = startSweeper({
      store: store as unknown as Store,
      hub: hub as unknown as Hub,
      now: () => 10 * H,
      maxIdleMs: 2 * H,
      intervalMs: SWEEP_INTERVAL_MS,
      onSwept: (n) => swept.push(n),
    });
    expect(calls).toEqual([8 * H]);
    vi.advanceTimersByTime(SWEEP_INTERVAL_MS - 1);
    expect(calls).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(calls).toHaveLength(2);
    expect(swept).toEqual([2]); // only a non-zero count is reported
    vi.advanceTimersByTime(3 * SWEEP_INTERVAL_MS);
    expect(calls).toHaveLength(5);
    s.stop();
    vi.advanceTimersByTime(10 * SWEEP_INTERVAL_MS);
    expect(calls).toHaveLength(5);
  });

  it("the app sweeps hourly through its timer and onClose ends it", async () => {
    vi.useFakeTimers({ toFake: ["setInterval", "clearInterval"] });
    await boot({ sweepIntervalMs: 1000 });
    const host = await createRoom(srv!, "Anna");
    clock += 49 * H;
    await vi.advanceTimersByTimeAsync(1000);
    expect(srv!.store.getRoom(host.roomId)).toBeUndefined();
    const timers = vi.getTimerCount();
    await srv!.close();
    srv = undefined;
    expect(vi.getTimerCount()).toBeLessThan(timers);
    await vi.advanceTimersByTimeAsync(10_000); // a live timer would now hit the closed database and throw
  });

  it("the defaults are 48 hours and one hour", () => {
    expect(IDLE_MS).toBe(48 * H);
    expect(SWEEP_INTERVAL_MS).toBe(H);
  });
});
