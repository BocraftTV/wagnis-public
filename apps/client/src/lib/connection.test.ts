import { describe, expect, it } from "vitest";
import { GameConnection } from "./connection.svelte.js";
import type { ConnectionDeps, SocketLike } from "./connection.svelte.js";

class FakeSocket implements SocketLike {
  readyState = 0;
  sent: string[] = [];
  closedByClient = false;
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number }) => void) | null = null;
  onerror: (() => void) | null = null;
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.closedByClient = true;
    this.readyState = 3;
  }
  // test helpers
  open() {
    this.readyState = 1;
    this.onopen?.();
  }
  receive(msg: unknown) {
    this.onmessage?.({ data: JSON.stringify(msg) });
  }
  serverClose(code: number) {
    this.readyState = 3;
    this.onclose?.({ code });
  }
}

function harness() {
  const sockets: FakeSocket[] = [];
  const timers: { fn: () => void; ms: number; id: number; active: boolean }[] = [];
  const deps: ConnectionDeps = {
    createSocket: () => {
      const s = new FakeSocket();
      sockets.push(s);
      return s;
    },
    wsUrl: () => "ws://test/ws",
    setTimer: (fn, ms) => {
      const t = { fn, ms, id: timers.length, active: true };
      timers.push(t);
      return t.id;
    },
    clearTimer: (h) => {
      const t = timers[h as number];
      if (t) t.active = false;
    },
  };
  let rejected = 0;
  const conn = new GameConnection(() => rejected++, deps);
  const fire = () => {
    const t = timers.find((x) => x.active && x.ms >= 500 && x.ms <= 5000);
    if (!t) throw new Error("no pending reconnect timer");
    t.active = false;
    t.fn();
  };
  return { conn, deps, sockets, timers, fire, rejected: () => rejected };
}

const snapshot = (version: number) => ({
  type: "snapshot",
  view: {
    roomId: "K7M2XQ",
    status: "lobby",
    mapId: "testland",
    version,
    you: { playerId: "p1", isHost: true },
    players: [{ id: "p1", name: "A", seat: 0, isHost: true, connected: true, removed: false }],
    victoryMode: "missions",
    fortifyMoves: 1,
    missionDraft: false,
    holdToWin: false,
    gameNo: 1,
    publicUrl: null,
    game: null,
  },
});

describe("GameConnection", () => {
  it("sends hello on open and becomes open with the first snapshot", () => {
    const h = harness();
    h.conn.start("K7M2XQ", "tok");
    const s = h.sockets[0]!;
    s.open();
    expect(JSON.parse(s.sent[0]!)).toEqual({ type: "hello", roomId: "K7M2XQ", token: "tok" });
    expect(h.conn.status).toBe("connecting");
    s.receive(snapshot(2));
    expect(h.conn.status).toBe("open");
    expect(h.conn.view?.version).toBe(2);
  });

  it("reconnects with growing backoff after losing the connection, then says hello again", () => {
    const h = harness();
    h.conn.start("K7M2XQ", "tok");
    h.sockets[0]!.open();
    h.sockets[0]!.receive(snapshot(1));
    h.sockets[0]!.serverClose(1006);
    expect(h.conn.status).toBe("reconnecting");
    expect(h.timers.at(-1)?.ms).toBe(500);
    h.fire();
    h.sockets[1]!.serverClose(1006); // fails before open
    expect(h.timers.at(-1)?.ms).toBe(1000);
    h.fire();
    h.sockets[2]!.open();
    expect(JSON.parse(h.sockets[2]!.sent[0]!).type).toBe("hello");
    h.sockets[2]!.receive(snapshot(1));
    expect(h.conn.status).toBe("open");
    // backoff restarted after success
    h.sockets[2]!.serverClose(1006);
    expect(h.timers.at(-1)?.ms).toBe(500);
  });

  it("keeps the delay at 5 s and never gives up", () => {
    const h = harness();
    h.conn.start("K7M2XQ", "tok");
    for (let i = 0; i < 12; i++) {
      h.sockets.at(-1)!.serverClose(1006);
      h.fire();
    }
    h.sockets.at(-1)!.serverClose(1006);
    expect(h.timers.at(-1)?.ms).toBe(5000);
    expect(h.conn.status).toBe("reconnecting");
  });

  it("reconnects immediately when the page becomes visible or the network returns", () => {
    const h = harness();
    h.conn.start("K7M2XQ", "tok");
    h.sockets[0]!.open();
    h.sockets[0]!.receive(snapshot(1));
    h.sockets[0]!.serverClose(1006);
    expect(h.sockets).toHaveLength(1);
    h.conn.onVisibilityChange(true, 1000);
    expect(h.sockets).toHaveLength(2);
    h.sockets[1]!.serverClose(1006);
    h.conn.onOnline();
    expect(h.sockets).toHaveLength(3);
  });

  it("replaces a possibly dead socket after a long time in the background, not after a short one", () => {
    const h = harness();
    h.conn.start("K7M2XQ", "tok");
    h.sockets[0]!.open();
    h.sockets[0]!.receive(snapshot(1));
    h.conn.onVisibilityChange(false, 0);
    h.conn.onVisibilityChange(true, 2000);
    expect(h.sockets).toHaveLength(1);
    h.conn.onVisibilityChange(false, 10_000);
    h.conn.onVisibilityChange(true, 60_000);
    expect(h.sockets).toHaveLength(2);
    expect(h.sockets[0]!.closedByClient).toBe(true);
    // late events of the old socket are ignored
    h.sockets[0]!.serverClose(4002);
    expect(h.conn.status).not.toBe("replaced");
  });

  it("does not reconnect when replaced by another window, until resumed", () => {
    const h = harness();
    h.conn.start("K7M2XQ", "tok");
    h.sockets[0]!.open();
    h.sockets[0]!.serverClose(4002);
    expect(h.conn.status).toBe("replaced");
    h.conn.onOnline();
    h.conn.onVisibilityChange(true, 99999);
    expect(h.sockets).toHaveLength(1);
    h.conn.resume();
    expect(h.sockets).toHaveLength(2);
  });

  it("stops and reports when the server rejects the token (4001)", () => {
    const h = harness();
    h.conn.start("K7M2XQ", "bad");
    h.sockets[0]!.serverClose(4001);
    expect(h.conn.status).toBe("rejected");
    expect(h.rejected()).toBe(1);
    h.conn.onOnline();
    expect(h.sockets).toHaveLength(1);
  });

  it("a close with 4004 (removed by the host) reports removed, stops and never reconnects", () => {
    const reasons: string[] = [];
    const base = harness();
    const conn = new GameConnection((r) => reasons.push(r), base.deps);
    conn.start("K7M2XQ", "tok");
    base.sockets[0]!.open();
    base.sockets[0]!.serverClose(4004);
    expect(conn.status).toBe("rejected");
    expect(reasons).toEqual(["removed"]);
    conn.onOnline();
    conn.onVisibilityChange(true, 999999);
    expect(base.sockets).toHaveLength(1);
    // the token was refused (4001): reason "invalid"
    const other = harness();
    const r2: string[] = [];
    const c2 = new GameConnection((r) => r2.push(r), other.deps);
    c2.start("K7M2XQ", "bad");
    other.sockets[0]!.serverClose(4001);
    expect(r2).toEqual(["invalid"]);
  });

  it("sends host messages through the open connection and refuses them offline", () => {
    const h = harness();
    h.conn.start("K7M2XQ", "tok");
    h.sockets[0]!.open();
    expect(h.conn.sendHost({ type: "backToLobby" })).toBe(false); // not open yet: no snapshot
    h.sockets[0]!.receive(snapshot(1));
    expect(h.conn.sendHost({ type: "backToLobby" })).toBe(true);
    expect(h.sockets[0]!.sent.at(-1)).toBe(JSON.stringify({ type: "backToLobby" }));
  });

  it("ignores older snapshots, shows server errors briefly, refuses to send while offline", () => {
    const h = harness();
    h.conn.start("K7M2XQ", "tok");
    const s = h.sockets[0]!;
    s.open();
    s.receive(snapshot(5));
    s.receive(snapshot(4));
    expect(h.conn.view?.version).toBe(5);
    s.receive(snapshot(5));
    expect(h.conn.view?.version).toBe(5);
    s.receive({ type: "error", code: "NOT_YOUR_TURN" });
    expect(h.conn.notice).toBe("Du bist nicht am Zug.");
    h.timers.at(-1)!.fn();
    expect(h.conn.notice).toBeNull();
    expect(h.conn.sendAction({ type: "endPhase" })).toBe(true);
    expect(JSON.parse(s.sent.at(-1)!)).toMatchObject({
      type: "action",
      action: { type: "endPhase" },
    });
    s.serverClose(1006);
    expect(h.conn.sendAction({ type: "endPhase" })).toBe(false);
    expect(h.conn.notice).toBe("Keine Verbindung.");
  });

  it("stop() closes the socket and cancels retries", () => {
    const h = harness();
    h.conn.start("K7M2XQ", "tok");
    h.sockets[0]!.serverClose(1006);
    h.conn.stop();
    expect(h.timers.every((t) => !t.active)).toBe(true);
    expect(h.conn.status).toBe("idle");
  });
});
