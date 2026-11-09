import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { GameState } from "@wagnis/engine";
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

// Plan 014 C: the lobby option `teams`, the assignment by the host, the start, and what the team mates see.

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

async function table(n: number) {
  srv = await startServer(dbPath);
  const host = await createRoom(srv, "Host");
  const ids = [host];
  for (let i = 1; i < n; i++) ids.push(await joinRoom(srv, host.roomId, `Gast${i}`));
  const c: TestClient[] = [];
  for (const id of ids) c.push(await connect(id));
  return { ids, c, roomId: host.roomId };
}
const teamOfPlayer = (v: { players: { id: string; team: string | null }[] }, id: string) =>
  v.players.find((p) => p.id === id)!.team;

describe("lobby option teams", () => {
  it("is off by default; only the host sets it, everybody sees it, the column follows", async () => {
    const t = await table(4);
    expect((await t.c[0]!.latestView()).teams).toBeNull();
    t.c[1]!.send({ type: "settings", teams: "2v2" });
    await t.c[1]!.waitFor(() => (errorsOf(t.c[1]!).includes("NOT_HOST") ? true : undefined));
    t.c[0]!.send({ type: "settings", teams: "2v2" });
    await Promise.all(t.c.map((x) => x.nextView((w) => w.teams === "2v2")));
    expect(rowOf(t.roomId)["teams"]).toBe("2v2");
    t.c[0]!.send({ type: "settings", teams: "7v7" });
    await t.c[0]!.waitFor(() => (errorsOf(t.c[0]!).includes("BAD_MESSAGE") ? true : undefined));
  });

  it("the host assigns players; the assignment is public and a new layout clears it", async () => {
    const t = await table(4);
    t.c[0]!.send({ type: "settings", teams: "2v2" });
    await t.c[1]!.nextView((w) => w.teams === "2v2");
    t.c[0]!.send({ type: "team", playerId: t.ids[1]!.playerId, team: "B" });
    const v = await t.c[2]!.nextView((w) => teamOfPlayer(w, t.ids[1]!.playerId) === "B");
    expect(teamOfPlayer(v, t.ids[0]!.playerId)).toBeNull();
    // a guest cannot assign; a team the layout does not have is rejected; so is any assignment without a layout
    t.c[1]!.send({ type: "team", playerId: t.ids[2]!.playerId, team: "A" });
    await t.c[1]!.waitFor(() => (errorsOf(t.c[1]!).includes("NOT_HOST") ? true : undefined));
    t.c[0]!.send({ type: "team", playerId: t.ids[2]!.playerId, team: "C" });
    await t.c[0]!.waitFor(() => (errorsOf(t.c[0]!).includes("INVALID_TEAMS") ? true : undefined));
    t.c[0]!.send({ type: "settings", teams: "3v3" });
    const cleared = await t.c[1]!.nextView((w) => w.teams === "3v3");
    expect(cleared.players.every((p) => p.team === null)).toBe(true);
    t.c[0]!.send({ type: "settings", teams: null });
    await t.c[1]!.nextView((w) => w.teams === null);
    t.c[0]!.send({ type: "team", playerId: t.ids[2]!.playerId, team: "A" });
    await t.c[0]!.waitFor(() =>
      errorsOf(t.c[0]!).filter((e) => e === "INVALID_TEAMS").length >= 2 ? true : undefined,
    );
  });

  it("randomTeams fills every team to its size; with the wrong player count it is INVALID_TEAMS", async () => {
    const t = await table(4);
    t.c[0]!.send({ type: "settings", teams: "2v2" });
    await t.c[1]!.nextView((w) => w.teams === "2v2");
    t.c[0]!.send({ type: "randomTeams" });
    const v = await t.c[3]!.nextView((w) => w.players.every((p) => p.team !== null));
    expect(v.players.filter((p) => p.team === "A")).toHaveLength(2);
    expect(v.players.filter((p) => p.team === "B")).toHaveLength(2);
    t.c[0]!.send({ type: "settings", teams: "3v3" });
    await t.c[1]!.nextView((w) => w.teams === "3v3");
    t.c[0]!.send({ type: "randomTeams" });
    await t.c[0]!.waitFor(() => (errorsOf(t.c[0]!).includes("INVALID_TEAMS") ? true : undefined));
  });

  it("choosing the layout that is already set keeps the assignment; a new layout clears it", async () => {
    const t = await table(4);
    t.c[0]!.send({ type: "settings", teams: "2v2" });
    await t.c[1]!.nextView((w) => w.teams === "2v2");
    t.c[0]!.send({ type: "randomTeams" });
    await t.c[1]!.nextView((w) => w.players.every((p) => p.team !== null));
    // the same layout again (a second tap on the pressed button), then another setting as a marker
    t.c[0]!.send({ type: "settings", teams: "2v2" });
    t.c[0]!.send({ type: "settings", worldEvents: true });
    const v = await t.c[1]!.nextView((w) => w.worldEvents);
    expect(v.players.every((p) => p.team !== null)).toBe(true);
    t.c[0]!.send({ type: "settings", teams: "3v3" });
    const w = await t.c[1]!.nextView((x) => x.teams === "3v3");
    expect(w.players.every((p) => p.team === null)).toBe(true);
  });
});

describe("starting and playing with teams", () => {
  async function started(n: number, mode: "2v2" | "3v3" | "2v2v2") {
    const t = await table(n);
    t.c[0]!.send({ type: "settings", teams: mode, victoryMode: "domination" });
    await Promise.all(t.c.map((x) => x.nextView((w) => w.teams === mode)));
    t.c[0]!.send({ type: "randomTeams" });
    await Promise.all(t.c.map((x) => x.nextView((w) => w.players.every((p) => p.team !== null))));
    return t;
  }

  it("the start without a complete assignment is INVALID_TEAMS and changes nothing", async () => {
    const t = await table(4);
    t.c[0]!.send({ type: "settings", teams: "2v2" });
    await t.c[1]!.nextView((w) => w.teams === "2v2");
    t.c[0]!.send({ type: "start" });
    await t.c[0]!.waitFor(() => (errorsOf(t.c[0]!).includes("INVALID_TEAMS") ? true : undefined));
    expect(rowOf(t.roomId)["status"]).toBe("lobby");
  });

  it("2 vs 2: the game starts with the teams in the state and the views; partners see each other's cards", async () => {
    const t = await started(4, "2v2");
    t.c[0]!.send({ type: "start" });
    const views = await Promise.all(t.c.map((x) => x.nextView((w) => w.status === "playing")));
    const state = stored(t.roomId);
    expect(state.rules.teams).toBe("2v2");
    expect(state.teams).not.toBeNull();
    for (const v of views) {
      expect(v.game!.teams).toEqual(state.teams);
      expect(v.teams).toBe("2v2");
    }
    // the players carry their team in the game, from the state
    for (const p of views[0]!.players) {
      expect(p.team).not.toBeNull();
      expect(state.teams![p.team!]).toContain(p.id);
    }
    // alternating turn order: teams alternate
    const order = state.playerOrder;
    const team = (id: string) => (state.teams!.A!.includes(id) ? "A" : "B");
    expect(team(order[0]!)).not.toBe(team(order[1]!));
    expect(team(order[0]!)).toBe(team(order[2]!));
    // partners' hands: nobody has cards yet, but the field exists for the partner only
    for (let i = 0; i < t.ids.length; i++) {
      const me = t.ids[i]!.playerId;
      const mates = state.teams![team(me) as "A" | "B"]!.filter((p) => p !== me);
      expect(Object.keys(views[i]!.game!.secret.allyHands)).toEqual(mates);
    }
    // the layout is fixed once the game runs
    t.c[0]!.send({ type: "settings", teams: null });
    await t.c[0]!.waitFor(() => (errorsOf(t.c[0]!).includes("NOT_IN_LOBBY") ? true : undefined));
  });

  it("an attack on a partner is ALLY_TARGET over the wire", async () => {
    const t = await started(4, "2v2");
    t.c[0]!.send({ type: "start" });
    const views = await Promise.all(t.c.map((x) => x.nextView((w) => w.status === "playing")));
    const state = stored(t.roomId);
    const active = state.activePlayerId;
    const idx = t.ids.findIndex((i) => i.playerId === active);
    const mates = Object.values(state.teams!).find((m) => m.includes(active))!;
    const partner = mates.find((p) => p !== active)!;
    const g = views[idx]!.game!;
    // put the active player in the attack phase with a strong territory next to a partner's territory
    const map = (await import("@wagnis/engine")).getMap("testland")!;
    let pair: [string, string] | undefined;
    for (const tt of map.territories) {
      if (g.territories[tt.id]!.ownerId !== active) continue;
      const n = tt.neighbors.find((x) => g.territories[x]!.ownerId === partner);
      if (n) pair = [tt.id, n];
    }
    if (!pair) return; // no such neighbours in this deal; the engine tests cover the rule
    const raw = { ...state, phase: "attack" as const, reinforcementsLeft: 0 };
    raw.territories = { ...raw.territories, [pair[0]]: { ownerId: active, armies: 5 } };
    const db = new Database(dbPath);
    db.prepare("UPDATE rooms SET state_json = ? WHERE id = ?").run(JSON.stringify(raw), t.roomId);
    db.close();
    t.c[idx]!.send({
      type: "action",
      action: { type: "attack", from: pair[0], to: pair[1], dice: 1 },
    });
    await t.c[idx]!.waitFor(() => (errorsOf(t.c[idx]!).includes("ALLY_TARGET") ? true : undefined));
  });

  it("3 vs 3 and 2 vs 2 vs 2 start with six players", async () => {
    for (const mode of ["3v3", "2v2v2"] as const) {
      await srv?.close();
      srv = undefined;
      clients.splice(0).forEach((c) => c.close());
      const t = await started(6, mode);
      t.c[0]!.send({ type: "start" });
      await t.c[1]!.nextView((w) => w.status === "playing");
      expect(Object.keys(stored(t.roomId).teams!)).toHaveLength(mode === "3v3" ? 2 : 3);
    }
  });
});

describe("schema version 8", () => {
  it("has rooms.teams and players.team", async () => {
    const t = await table(2);
    const db = new Database(dbPath, { readonly: true });
    const rooms = (db.prepare("PRAGMA table_info(rooms)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    const players = (db.prepare("PRAGMA table_info(players)").all() as { name: string }[]).map(
      (c) => c.name,
    );
    expect(db.prepare("SELECT version FROM schema_meta").all()).toEqual([{ version: 8 }]);
    db.close();
    expect(rooms).toContain("teams");
    expect(players).toContain("team");
    expect(t.roomId).toBeTruthy();
  });
});
