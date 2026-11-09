import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
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

// Plan 013, step 5: the lobby options `missionDraft` and `holdToWin` over the real WebSocket, the simultaneous
// choice in phase `missionChoice`, and what each client may (not) see of it.

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

interface Table {
  ids: Identity[];
  c: TestClient[];
  roomId: string;
}
async function table(n: number): Promise<Table> {
  srv = await startServer(dbPath);
  const host = await createRoom(srv, "Host");
  const ids = [host];
  for (let i = 1; i < n; i++) ids.push(await joinRoom(srv, host.roomId, `Gast${i}`));
  const c: TestClient[] = [];
  for (const id of ids) c.push(await connect(id));
  return { ids, c, roomId: host.roomId };
}

describe("lobby options", () => {
  it("are off by default; only the host changes them, everybody sees them, the column follows", async () => {
    const t = await table(3);
    const v = await t.c[0]!.latestView();
    expect([v.missionDraft, v.holdToWin]).toEqual([false, false]);

    t.c[1]!.send({ type: "settings", missionDraft: true });
    await t.c[1]!.waitFor(() => (errorsOf(t.c[1]!).includes("NOT_HOST") ? true : undefined));

    t.c[0]!.send({ type: "settings", missionDraft: true });
    const seen = await Promise.all(t.c.map((x) => x.nextView((w) => w.missionDraft)));
    for (const w of seen) expect([w.missionDraft, w.holdToWin]).toEqual([true, false]);
    expect(rowOf(t.roomId)["mission_draft"]).toBe(1);

    t.c[0]!.send({ type: "settings", holdToWin: true });
    await Promise.all(t.c.map((x) => x.nextView((w) => w.holdToWin)));
    t.c[0]!.send({ type: "settings", missionDraft: false });
    const off = await t.c[2]!.nextView((w) => !w.missionDraft);
    expect([off.missionDraft, off.holdToWin]).toEqual([false, true]);
    expect([rowOf(t.roomId)["mission_draft"], rowOf(t.roomId)["hold_to_win"]]).toEqual([0, 1]);
  });

  it("a settings message without any setting or with a wrong type is BAD_MESSAGE", async () => {
    const t = await table(2);
    t.c[0]!.send({ type: "settings" });
    t.c[0]!.send({ type: "settings", missionDraft: "yes" });
    await t.c[0]!.waitFor(() => (errorsOf(t.c[0]!).length >= 2 ? true : undefined));
    expect(errorsOf(t.c[0]!)).toEqual(["BAD_MESSAGE", "BAD_MESSAGE"]);
  });

  it("are fixed once the game runs (NOT_IN_LOBBY) and are copied into the game rules", async () => {
    const t = await table(2);
    t.c[0]!.send({ type: "settings", missionDraft: true, holdToWin: true });
    await t.c[1]!.nextView((w) => w.missionDraft);
    t.c[0]!.send({ type: "start" });
    const started = await t.c[1]!.nextView((w) => w.status === "playing");
    expect([started.missionDraft, started.holdToWin]).toEqual([true, true]);
    expect(stored(t.roomId).rules).toMatchObject({ missionDraft: true, holdToWin: true });
    t.c[0]!.send({ type: "settings", missionDraft: false });
    await t.c[0]!.waitFor(() => (errorsOf(t.c[0]!).includes("NOT_IN_LOBBY") ? true : undefined));
    expect(stored(t.roomId).rules.missionDraft).toBe(true);
  });
});

describe("two missions, keep one (over the wire)", () => {
  async function drafted(n: number): Promise<Table> {
    const t = await table(n);
    t.c[0]!.send({ type: "settings", missionDraft: true });
    await Promise.all(t.c.map((x) => x.nextView((w) => w.missionDraft)));
    t.c[0]!.send({ type: "start" });
    await Promise.all(t.c.map((x) => x.nextView((w) => w.status === "playing")));
    return t;
  }

  it("everybody gets exactly their own two missions and nobody moves before all have chosen", async () => {
    const t = await drafted(3);
    const views = await Promise.all(t.c.map((x) => x.latestView((w) => w.status === "playing")));
    const offers = views.map((v) => v.game!.secret.missionOffer);
    for (const o of offers) expect(o).toHaveLength(2);
    expect(new Set(offers.flatMap((o) => o!.map((m) => JSON.stringify(m)))).size).toBe(6);
    for (const v of views) {
      expect(v.game!.phase).toBe("missionChoice");
      expect(v.game!.secret.mission).toBeNull();
      expect(v.game!.missionChoice).toEqual({ chosen: [] });
    }
    // nobody sees a foreign offer in any raw message
    t.c.forEach((x, i) => {
      const text = x.raw.join("\n");
      offers.forEach((o, j) => {
        if (i === j) return;
        for (const m of o!) {
          if (offers[i]!.some((own) => JSON.stringify(own) === JSON.stringify(m))) continue;
          expect(text).not.toContain(JSON.stringify(m));
        }
      });
      expect(text).not.toContain("missionOfferDealt");
      expect(text).not.toContain("discardedMission");
    });
    // a move before the end of the choice is refused
    t.c[0]!.send({ type: "action", action: { type: "endPhase" } });
    await t.c[0]!.waitFor(() => (errorsOf(t.c[0]!).includes("WRONG_PHASE") ? true : undefined));
  });

  it("simultaneous choices all get through; the last one starts the first turn; a second choice is ALREADY_CHOSEN", async () => {
    const t = await drafted(3);
    const views = await Promise.all(t.c.map((x) => x.latestView((w) => w.status === "playing")));
    // all three send at the same time
    t.c.forEach((x, i) =>
      x.send({ type: "action", action: { type: "chooseMission", index: i % 2 } }),
    );
    await Promise.all(t.c.map((x) => x.nextView((w) => w.game!.phase === "reinforce")));
    const state = stored(t.roomId);
    expect(state.phase).toBe("reinforce");
    t.ids.forEach((id, i) => {
      expect(state.secret.mission[id.playerId]).toEqual(
        views[i]!.game!.secret.missionOffer![i % 2],
      );
      expect(state.secret.missionOffer[id.playerId]).toBeNull();
    });
    // each client now sees exactly its own chosen mission
    for (let i = 0; i < 3; i++) {
      const v = await t.c[i]!.latestView((w) => w.game!.phase === "reinforce");
      expect(v.game!.secret.mission).toEqual(views[i]!.game!.secret.missionOffer![i % 2]);
      expect(v.game!.secret.missionOffer).toBeNull();
      expect(v.game!.missionChoice).toBeNull();
    }
    t.c[1]!.send({ type: "action", action: { type: "chooseMission", index: 0 } });
    await t.c[1]!.waitFor(() => (errorsOf(t.c[1]!).includes("WRONG_PHASE") ? true : undefined));
  });

  it("while the choice is open: only who chose is public, a second choice is ALREADY_CHOSEN, index 2 is BAD_MESSAGE", async () => {
    const t = await drafted(3);
    t.c[1]!.send({ type: "action", action: { type: "chooseMission", index: 1 } });
    const seen = await Promise.all(
      t.c.map((x) => x.nextView((w) => (w.game!.missionChoice?.chosen.length ?? 0) === 1)),
    );
    for (const v of seen) expect(v.game!.missionChoice).toEqual({ chosen: [t.ids[1]!.playerId] });
    t.c[1]!.send({ type: "action", action: { type: "chooseMission", index: 0 } });
    await t.c[1]!.waitFor(() => (errorsOf(t.c[1]!).includes("ALREADY_CHOSEN") ? true : undefined));
    t.c[2]!.send({ type: "action", action: { type: "chooseMission", index: 2 } });
    await t.c[2]!.waitFor(() => (errorsOf(t.c[2]!).includes("BAD_MESSAGE") ? true : undefined));
    // the others learn nothing of the content of p2's choice
    const text = t.c[0]!.raw.join("\n");
    const chosen = JSON.stringify(stored(t.roomId).secret.mission[t.ids[1]!.playerId]);
    const own = (await t.c[0]!.latestView()).game!.secret.missionOffer!.map((m) =>
      JSON.stringify(m),
    );
    if (!own.includes(chosen)) expect(text).not.toContain(chosen);
  });

  it("the host's skipTurn chooses for everybody still open and starts the game", async () => {
    const t = await drafted(3);
    t.c[2]!.send({ type: "action", action: { type: "chooseMission", index: 0 } });
    await t.c[0]!.nextView((w) => w.game!.missionChoice?.chosen.length === 1);
    t.c[0]!.send({ type: "host", action: { type: "skipTurn", turn: 1 } });
    await Promise.all(t.c.map((x) => x.nextView((w) => w.game!.phase === "reinforce")));
    const state = stored(t.roomId);
    for (const id of t.ids) expect(state.secret.mission[id.playerId]).not.toBeNull();
  });

  it("after the game every client sees all missions, including the ones put away", async () => {
    const t = await drafted(3);
    t.c.forEach((x) => x.send({ type: "action", action: { type: "chooseMission", index: 0 } }));
    await Promise.all(t.c.map((x) => x.nextView((w) => w.game!.phase === "reinforce")));
    const state = stored(t.roomId);
    // before the end nobody sees a discarded mission
    for (const x of t.c) expect(x.raw.join("\n")).not.toContain('"discarded":{');
    await srv!.close();
    srv = undefined;
    clients.splice(0).forEach((c) => c.close());
    const store = new Store(dbPath);
    store.saveGame(
      t.roomId,
      "finished",
      { ...state, winnerId: t.ids[0]!.playerId, winReason: "mission" },
      Date.now(),
    );
    store.close();
    srv = await startServer(dbPath);
    for (const id of t.ids) {
      const c = await connect(id);
      const v = await c.latestView();
      const reveal = v.game!.missions!;
      for (const p of t.ids) {
        expect(reveal[p.playerId]!.mission).toEqual(state.secret.mission[p.playerId]);
        expect(reveal[p.playerId]!.discarded).toEqual(state.secret.discardedMission[p.playerId]);
        expect(reveal[p.playerId]!.discarded).not.toBeNull();
      }
    }
  });
});
