import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FailureLimiter } from "./rate-limit.js";
import {
  CREATE_CODE,
  TestClient,
  type TestServer,
  createRoom,
  joinRoom,
  makeTmpDir,
  post,
  removeDir,
  startServer,
} from "./test-helpers.js";

describe("FailureLimiter", () => {
  it("blocks after the limit and releases after the window", () => {
    let t = 0;
    const l = new FailureLimiter(3, 1000, () => t);
    for (let i = 0; i < 3; i++) {
      expect(l.isBlocked("ip")).toBe(false);
      l.recordFailure("ip");
    }
    expect(l.isBlocked("ip")).toBe(true);
    expect(l.isBlocked("other")).toBe(false);
    t = 1001;
    expect(l.isBlocked("ip")).toBe(false);
  });
});

describe("rate limits over http", () => {
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

  it("rejects a wrong create code, limits after 5 failures, successes never count", async () => {
    // many successful creates do not trigger the limit
    for (let i = 0; i < 12; i++) {
      expect(
        (await post(`${srv.base}/api/rooms`, { createCode: CREATE_CODE, hostName: "H" })).status,
      ).toBe(201);
    }
    for (let i = 0; i < 5; i++) {
      const bad = await post(`${srv.base}/api/rooms`, {
        createCode: "wrong-code-xyz",
        hostName: "H",
      });
      expect(bad.status).toBe(403);
      expect(bad.body.error.code).toBe("BAD_CREATE_CODE");
    }
    const limited = await post(`${srv.base}/api/rooms`, {
      createCode: "wrong-code-xyz",
      hostName: "H",
    });
    expect(limited.status).toBe(429);
    expect(limited.body.error.code).toBe("RATE_LIMITED");
    // even the right code is blocked once the IP exceeded its failures
    expect(
      (await post(`${srv.base}/api/rooms`, { createCode: CREATE_CODE, hostName: "H" })).status,
    ).toBe(429);
  });

  it("counts only unknown rooms for join, not name conflicts or successes", async () => {
    const host = await createRoom(srv);
    for (let i = 0; i < 40; i++) await joinRoom(srv, host.roomId, `P${i}`).catch(() => undefined);
    // ROOM_FULL / success responses do not count -> still allowed to hit an unknown room once
    expect((await post(`${srv.base}/api/rooms/ZZZZZZ/join`, { name: "A" })).status).toBe(404);
    for (let i = 0; i < 29; i++) await post(`${srv.base}/api/rooms/ZZZZZZ/join`, { name: "A" });
    expect((await post(`${srv.base}/api/rooms/ZZZZZZ/join`, { name: "A" })).status).toBe(429);
  });

  it("counts failed hello messages but not successful ones", async () => {
    const host = await createRoom(srv);
    for (let i = 0; i < 40; i++) {
      const c = await TestClient.connect(srv, host);
      await c.nextView();
      c.close();
    }
    for (let i = 0; i < 30; i++) {
      const c = await TestClient.connect(srv, { ...host, token: "wrong" });
      expect(await c.closed()).toBe(4001);
    }
    const blocked = await TestClient.connect(srv, host);
    expect(await blocked.closed()).toBe(4003);
  });
});

describe("TRUST_PROXY_HEADER", () => {
  it("uses the configured header as client identity", async () => {
    const dir = makeTmpDir();
    const srv = await startServer(`${dir}/db.sqlite`, {
      config: {
        port: 0,
        createCode: CREATE_CODE,
        dbPath: `${dir}/db.sqlite`,
        trustProxyHeader: "cf-connecting-ip",
        publicUrl: undefined,
      },
    });
    try {
      const bad = (ip: string) =>
        post(
          `${srv.base}/api/rooms`,
          { createCode: "wrong-code-xyz", hostName: "H" },
          { "cf-connecting-ip": ip },
        );
      for (let i = 0; i < 5; i++) await bad("203.0.113.7");
      expect((await bad("203.0.113.7")).status).toBe(429);
      expect((await bad("203.0.113.8")).status).toBe(403); // another client behind the same proxy
    } finally {
      await srv.close();
      removeDir(dir);
    }
  });
});
