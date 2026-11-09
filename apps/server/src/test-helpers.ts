import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import WebSocket from "ws";
import { createSeededRng } from "@wagnis/engine";
import type { RoomView, ServerMessage } from "@wagnis/shared";
import { buildApp } from "./app.js";
import type { AppOptions } from "./app.js";

export const CREATE_CODE = "test-create-code-123";

const tmpRoot = new URL("../.test-tmp/", import.meta.url).pathname;

export function makeTmpDir(): string {
  mkdirSync(tmpRoot, { recursive: true });
  return mkdtempSync(join(tmpRoot, "t-"));
}
export const removeDir = (dir: string) => rmSync(dir, { recursive: true, force: true });

export interface TestServer {
  app: Awaited<ReturnType<typeof buildApp>>["app"];
  store: Awaited<ReturnType<typeof buildApp>>["store"];
  hub: Awaited<ReturnType<typeof buildApp>>["hub"];
  base: string;
  wsUrl: string;
  close: () => Promise<void>;
}

export async function startServer(
  dbPath: string,
  extra: Partial<AppOptions> = {},
): Promise<TestServer> {
  const { app, store, hub } = await buildApp({
    config: {
      port: 0,
      createCode: CREATE_CODE,
      dbPath,
      trustProxyHeader: undefined,
      publicUrl: undefined,
    },
    rng: createSeededRng(11),
    clientDist: null,
    ...extra,
  });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const port = (app.server.address() as AddressInfo).port;
  return {
    app,
    store,
    hub,
    base: `http://127.0.0.1:${port}`,
    wsUrl: `ws://127.0.0.1:${port}/ws`,
    close: () => app.close(),
  };
}

export async function post(url: string, body: unknown, headers: Record<string, string> = {}) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any, headers: res.headers };
}

export interface Identity {
  roomId: string;
  playerId: string;
  token: string;
}

/** Creates a room; on `testland` unless a test asks for another map (all older tests play on the small map). */
export async function createRoom(
  srv: TestServer,
  hostName = "Host",
  mapId: string = "testland",
): Promise<Identity> {
  const res = await post(`${srv.base}/api/rooms`, { createCode: CREATE_CODE, hostName, mapId });
  if (res.status !== 201) throw new Error(`create failed: ${res.status}`);
  return { roomId: res.body.roomId, playerId: res.body.playerId, token: res.body.playerToken };
}

export async function joinRoom(srv: TestServer, roomId: string, name: string): Promise<Identity> {
  const res = await post(`${srv.base}/api/rooms/${roomId}/join`, { name });
  if (res.status !== 200) throw new Error(`join failed: ${res.status}`);
  return { roomId, playerId: res.body.playerId, token: res.body.playerToken };
}

/** WebSocket test client that records every message. */
export class TestClient {
  readonly messages: ServerMessage[] = [];
  readonly raw: string[] = [];
  closeCode: number | undefined;
  private readonly waiters: (() => void)[] = [];

  private constructor(readonly socket: WebSocket) {
    socket.on("message", (data) => {
      const text = data.toString();
      this.raw.push(text);
      this.messages.push(JSON.parse(text) as ServerMessage);
      this.waiters.splice(0).forEach((w) => w());
    });
    socket.on("close", (code) => {
      this.closeCode = code;
      this.waiters.splice(0).forEach((w) => w());
    });
  }

  static async connect(
    srv: TestServer,
    id?: Identity,
    opts: { headers?: Record<string, string>; autoPong?: boolean } = {},
  ) {
    const socket = new WebSocket(srv.wsUrl, {
      headers: opts.headers ?? {},
      autoPong: opts.autoPong ?? true,
    });
    await new Promise<void>((resolve, reject) => {
      socket.once("open", () => resolve());
      socket.once("error", reject);
    });
    const client = new TestClient(socket);
    if (id) client.send({ type: "hello", roomId: id.roomId, token: id.token });
    return client;
  }

  send(msg: unknown): void {
    this.socket.send(JSON.stringify(msg));
  }

  async waitFor<T>(pick: () => T | undefined, timeoutMs = 3000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const v = pick();
      if (v !== undefined) return v;
      if (Date.now() > deadline) throw new Error("timeout waiting for condition");
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 50);
      });
    }
  }

  views(): RoomView[] {
    return this.messages.flatMap((m) => (m.type === "snapshot" ? [m.view] : []));
  }

  /** Resolves with the next snapshot (after the call) matching the predicate. */
  async nextView(pred: (v: RoomView) => boolean = () => true, timeoutMs = 3000): Promise<RoomView> {
    const seen = this.views().length;
    return this.waitFor(() => this.views().slice(seen).find(pred), timeoutMs);
  }

  async latestView(pred: (v: RoomView) => boolean = () => true): Promise<RoomView> {
    return this.waitFor(() => [...this.views()].reverse().find(pred));
  }

  async closed(timeoutMs = 3000): Promise<number> {
    return this.waitFor(() => this.closeCode, timeoutMs);
  }

  close(): void {
    this.socket.close();
  }
}

/** Strips the phase 4 fields (everything `migrate3to4` adds), leaving a state in the phase 3 format. */
export function toPhase3Format(state: unknown): Record<string, any> {
  const legacy = JSON.parse(JSON.stringify(state)) as Record<string, any>;
  delete legacy["stateVersion"];
  delete legacy["winReason"];
  delete legacy["rules"].victoryMode;
  delete legacy["secret"].originalMission;
  delete legacy["secret"].missionReplaced;
  return legacy;
}

/**
 * Gives every player a mission that can never be met, so rigged boards (which ignore the deal) cannot end the
 * game by accident. Keeps `originalMission` and `missionReplaced` consistent with it.
 */
export function unreachableMissions(state: {
  secret: {
    mission: Record<string, unknown>;
    originalMission: Record<string, unknown>;
    missionReplaced: Record<string, boolean>;
  };
}): void {
  for (const p of Object.keys(state.secret.mission)) {
    const m = { type: "holdTerritories", count: 99, minArmies: 99 };
    state.secret.mission[p] = m;
    state.secret.originalMission[p] = { ...m };
    state.secret.missionReplaced[p] = false;
  }
}
