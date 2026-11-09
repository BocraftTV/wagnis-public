import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  CREATE_CODE,
  TestClient,
  createRoom,
  joinRoom,
  makeTmpDir,
  removeDir,
  startServer,
} from "./test-helpers.js";
import type { Identity, TestServer } from "./test-helpers.js";

// Plan 008, step 1: WAGNIS_PUBLIC_URL reaches the clients only through the lobby snapshot.

const ADDRESS = "http://192.0.2.10:3000";

let dir: string;
let srv: TestServer | undefined;
const clients: TestClient[] = [];
const logLines: string[] = [];

beforeEach(() => {
  dir = makeTmpDir();
  logLines.length = 0;
});
afterEach(async () => {
  clients.splice(0).forEach((c) => c.close());
  await srv?.close();
  srv = undefined;
  removeDir(dir);
});

async function boot(publicUrl: string | undefined): Promise<TestServer> {
  const dbPath = `${dir}/db.sqlite`;
  srv = await startServer(dbPath, {
    config: { port: 0, createCode: CREATE_CODE, dbPath, trustProxyHeader: undefined, publicUrl },
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

describe("publicUrl in the room view", () => {
  it("is set in the lobby for everybody and null once the game runs", async () => {
    await boot(ADDRESS);
    const host = await createRoom(srv!);
    const guest = await joinRoom(srv!, host.roomId, "Gast");
    const a = await connect(host);
    const b = await connect(guest);
    expect((await a.latestView()).publicUrl).toBe(ADDRESS);
    expect((await b.latestView()).publicUrl).toBe(ADDRESS);

    a.send({ type: "start" });
    expect((await a.nextView((v) => v.status === "playing")).publicUrl).toBeNull();
    expect((await b.nextView((v) => v.status === "playing")).publicUrl).toBeNull();
  });

  it("is null without the variable", async () => {
    await boot(undefined);
    const host = await createRoom(srv!);
    const a = await connect(host);
    expect((await a.latestView()).publicUrl).toBeNull();
  });

  it("carries only the origin: no token, hash, create code or room code, and is never logged", async () => {
    await boot(ADDRESS);
    const host = await createRoom(srv!);
    const guest = await joinRoom(srv!, host.roomId, "Gast");
    const a = await connect(host);
    const b = await connect(guest);
    a.send({ type: "start" });
    await a.nextView((v) => v.status === "playing");
    await b.nextView((v) => v.status === "playing");

    const secrets = [
      host.token,
      guest.token,
      CREATE_CODE,
      ...srv!.store.getPlayers(host.roomId).map((p) => p.tokenHash),
    ];
    for (const client of [a, b]) {
      for (const view of client.views()) {
        if (view.publicUrl !== null) {
          expect(view.publicUrl).toBe(ADDRESS);
          expect(view.publicUrl).not.toContain(host.roomId);
        }
      }
      for (const line of client.raw)
        for (const secret of secrets) expect(line).not.toContain(secret);
    }
    expect(a.views().some((v) => v.publicUrl === ADDRESS)).toBe(true);
    for (const line of logLines) expect(line).not.toContain("192.0.2.10");
  });
});
