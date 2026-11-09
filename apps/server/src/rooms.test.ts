import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { ROOM_ID_ALPHABET, formatRoomId, normalizeRoomId } from "@wagnis/shared";
import { generateRoomId, hashToken, newToken } from "./crypto.js";
import { Store } from "./store.js";
import {
  CREATE_CODE,
  type TestServer,
  createRoom,
  joinRoom,
  makeTmpDir,
  post,
  removeDir,
  startServer,
} from "./test-helpers.js";

describe("room ids", () => {
  it("generates 10 000 ids of 6 characters from the alphabet", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) {
      const id = generateRoomId((x) => seen.has(x));
      expect(id).toHaveLength(6);
      expect([...id].every((c) => ROOM_ID_ALPHABET.includes(c))).toBe(true);
      seen.add(id);
    }
    expect(seen.size).toBe(10_000);
  });

  it("avoids ids that already exist", () => {
    let calls = 0;
    const id = generateRoomId(() => ++calls < 3);
    expect(calls).toBe(3);
    expect(id).toHaveLength(6);
  });

  it("normalizes and formats", () => {
    expect(normalizeRoomId(" k7m-2xq ")).toBe("K7M2XQ");
    expect(formatRoomId("K7M2XQ")).toBe("K7M-2XQ");
  });

  it("generates tokens of 32 bytes (base64url) and hashes them", () => {
    const t = newToken();
    expect(Buffer.from(t, "base64url")).toHaveLength(32);
    expect(t).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(hashToken(t)).toMatch(/^[0-9a-f]{64}$/);
    expect(newToken()).not.toBe(t);
  });
});

describe("room http api", () => {
  let dir: string;
  let srv: TestServer;
  beforeEach(async () => {
    dir = makeTmpDir();
    srv = await startServer(`${dir}/db.sqlite`);
  });
  afterEach(async () => {
    await srv.close();
    removeDir(dir);
  });

  it("serves /healthz and noindex headers", async () => {
    const res = await fetch(`${srv.base}/healthz`);
    expect(await res.json()).toEqual({ ok: true });
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect((await fetch(`${srv.base}/api/unknown`)).status).toBe(404);
  });

  it("creates a room and stores only the token hash", async () => {
    const res = await post(`${srv.base}/api/rooms`, { createCode: CREATE_CODE, hostName: "Jakob" });
    expect(res.status).toBe(201);
    expect(res.body.roomId).toMatch(new RegExp(`^[${ROOM_ID_ALPHABET}]{6}$`));
    expect(res.headers.get("x-robots-tag")).toBe("noindex");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const store = new Store(`${dir}/db.sqlite`);
    const [host] = store.getPlayers(res.body.roomId);
    store.close();
    expect(host?.isHost).toBe(true);
    expect(host?.tokenHash).toBe(hashToken(res.body.playerToken));
    expect(host?.tokenHash).not.toBe(res.body.playerToken);
  });

  it("validates creation input", async () => {
    expect((await post(`${srv.base}/api/rooms`, { createCode: CREATE_CODE })).status).toBe(400);
    expect(
      (await post(`${srv.base}/api/rooms`, { createCode: CREATE_CODE, hostName: "" })).status,
    ).toBe(400);
    const r = await fetch(`${srv.base}/api/rooms`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{oops",
    });
    expect(r.status).toBe(400);
  });

  it("joins with normalized id, enforces unique names, max 6 players and lobby only", async () => {
    const host = await createRoom(srv, "Host");
    const dashed = formatRoomId(host.roomId).toLowerCase();
    const first = await post(`${srv.base}/api/rooms/${dashed}/join`, { name: "Anna" });
    expect(first.status).toBe(200);
    expect(first.body.playerToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(
      (await post(`${srv.base}/api/rooms/${host.roomId}/join`, { name: "anna" })).body.error.code,
    ).toBe("NAME_TAKEN");
    expect(
      (await post(`${srv.base}/api/rooms/${host.roomId}/join`, { name: "host" })).body.error.code,
    ).toBe("NAME_TAKEN");
    expect(
      (await post(`${srv.base}/api/rooms/${host.roomId}/join`, { name: "x".repeat(17) })).status,
    ).toBe(400);
    for (const n of ["B", "C", "D", "E"]) await joinRoom(srv, host.roomId, n);
    const full = await post(`${srv.base}/api/rooms/${host.roomId}/join`, { name: "G" });
    expect(full.status).toBe(409);
    expect(full.body.error.code).toBe("ROOM_FULL");
  });

  it("rejects joining unknown rooms and rooms that have started", async () => {
    expect((await post(`${srv.base}/api/rooms/ZZZZZZ/join`, { name: "A" })).body.error.code).toBe(
      "ROOM_NOT_FOUND",
    );
    expect((await post(`${srv.base}/api/rooms/abc/join`, { name: "A" })).status).toBe(404);
    const host = await createRoom(srv);
    await joinRoom(srv, host.roomId, "Anna");
    const { TestClient } = await import("./test-helpers.js");
    const c = await TestClient.connect(srv, host);
    await c.nextView();
    c.send({ type: "start" });
    await c.nextView((v) => v.status === "playing");
    const late = await post(`${srv.base}/api/rooms/${host.roomId}/join`, { name: "Zed" });
    expect(late.status).toBe(409);
    expect(late.body.error.code).toBe("ROOM_NOT_JOINABLE");
    c.close();
  });
});
