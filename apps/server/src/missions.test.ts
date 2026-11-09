import { afterEach, describe, expect, it } from "vitest";
import {
  createGame,
  createSeededRng,
  testland,
  testlandMissions,
  testlandRules,
} from "@wagnis/engine";
import type { GameState, Mission, Rng } from "@wagnis/engine";
import { serverMessageSchema } from "@wagnis/shared";
import type { RoomView } from "@wagnis/shared";
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

const MARK_B = "GEHEIM-KONTINENT-B-81d0";
const FALLBACK = JSON.stringify(testlandMissions.fallback);
const hold = (count: number, minArmies: number): Mission => ({
  type: "holdTerritories",
  count,
  minArmies,
});
const kill = (targetPlayerId: string): Mission => ({ type: "eliminatePlayer", targetPlayerId });

interface Env {
  dir: string;
  dbPath: string;
  srv: TestServer;
  rng: Rng;
  faces: number[];
  clients: TestClient[];
}
const envs: Env[] = [];

/** Seeded for setup; once `dice` is on, only the queued die faces (and a test error when they run out). */
async function newEnv(seed = 11): Promise<Env> {
  const dir = makeTmpDir();
  const seeded = createSeededRng(seed);
  const env = {
    dir,
    dbPath: `${dir}/db.sqlite`,
    faces: [] as number[],
    clients: [] as TestClient[],
  } as Env;
  let dice = false;
  env.rng = {
    int(max) {
      if (!dice) return seeded.int(max);
      if (max !== 6) throw new Error(`unexpected int(${max})`);
      const f = env.faces.shift();
      if (f === undefined) throw new Error("dice sequence exhausted");
      return f - 1;
    },
  };
  (env as Env & { diceOn: () => void }).diceOn = () => (dice = true);
  env.srv = await startServer(env.dbPath, { rng: env.rng });
  envs.push(env);
  return env;
}
const diceOn = (env: Env) => (env as Env & { diceOn: () => void }).diceOn();

afterEach(async () => {
  for (const env of envs.splice(0)) {
    env.clients.splice(0).forEach((c) => c.close());
    await env.srv.close();
    removeDir(env.dir);
  }
});

async function connect(env: Env, id: Identity): Promise<TestClient> {
  const c = await TestClient.connect(env.srv, id);
  env.clients.push(c);
  await c.latestView();
  return c;
}

interface Rig {
  env: Env;
  ids: Record<string, Identity>;
  c: Record<string, TestClient>;
}

/** Creates a room, starts the game, then rewrites the board and the missions (host active, attack phase). */
async function rig(
  env: Env,
  names: string[],
  territories: Record<string, [owner: string, armies: number]>,
  fill: string,
  missions: (pid: Record<string, string>) => Record<string, Mission>,
): Promise<Rig> {
  const host = await createRoom(env.srv, names[0]!);
  const ids: Record<string, Identity> = { [names[0]!]: host };
  for (const n of names.slice(1)) ids[n] = await joinRoom(env.srv, host.roomId, n);
  const starter = await TestClient.connect(env.srv, host);
  for (const n of names.slice(1)) env.clients.push(await TestClient.connect(env.srv, ids[n]!));
  starter.send({ type: "start" });
  await starter.nextView((v) => v.status === "playing");
  starter.close();
  env.clients.splice(0).forEach((x) => x.close());

  const pid = Object.fromEntries(names.map((n) => [n, ids[n]!.playerId]));
  const store = new Store(env.dbPath);
  const state = JSON.parse(store.getRoom(host.roomId)!.stateJson!) as GameState;
  for (const t of Object.keys(state.territories)) {
    const [owner, armies] = territories[t] ?? [fill, 1];
    state.territories[t] = { ownerId: pid[owner]!, armies };
  }
  state.playerOrder = names.map((n) => pid[n]!);
  state.activePlayerId = pid[names[0]!]!;
  state.phase = "attack";
  state.reinforcementsLeft = 0;
  state.secret.hand = Object.fromEntries(names.map((n) => [pid[n]!, []]));
  const m = missions(pid);
  for (const n of names) {
    state.secret.mission[pid[n]!] = m[n]!;
    state.secret.originalMission[pid[n]!] = structuredClone(m[n]!);
    state.secret.missionReplaced[pid[n]!] = false;
  }
  store.saveGame(host.roomId, "playing", state, Date.now());
  store.close();
  diceOn(env);
  const c: Record<string, TestClient> = {};
  for (const n of names) c[n] = await connect(env, ids[n]!);
  return { env, ids, c };
}

const act = (action: unknown) => ({ type: "action", action });
const strike = act({ type: "attack", from: "eisenfurt", to: "rabenhain", dice: 3 });
const STRIKE_FACES = [6, 5, 4, 1];

/** host attacks and eliminates the guest (the guest's only territory is rabenhain); third holds the rest. */
const threeBoard = { eisenfurt: ["host", 5], rabenhain: ["guest", 1] } as Record<
  string,
  [string, number]
>;

describe("start and persistence", () => {
  it("a started game deals exactly one mission per player; views show only the own one", async () => {
    const env = await newEnv();
    const host = await createRoom(env.srv, "Host");
    const g = await joinRoom(env.srv, host.roomId, "Gast");
    const t = await joinRoom(env.srv, host.roomId, "Dritter");
    const cs = [await connect(env, host), await connect(env, g), await connect(env, t)];
    cs[0]!.send({ type: "start" });
    const views = await Promise.all(cs.map((c) => c.nextView((v) => v.status === "playing")));
    const missions = views.map((v) => v.game!.secret.mission);
    expect(missions.every((m) => m !== null)).toBe(true);
    const mine = views.map((v) => JSON.stringify(v.game!.secret.mission));
    for (let i = 0; i < 3; i++) {
      const wire = cs[i]!.raw.join("\n");
      // another player's mission never shows up in this connection, unless it happens to be identical
      for (let j = 0; j < 3; j++) {
        if (i === j || mine[j] === mine[i]) continue;
        if (views[j]!.game!.secret.missionReplaced) continue; // the fallback may equal a map mission
        expect(wire, `${i} sees ${j}`).not.toContain(mine[j]!);
      }
      for (const key of ["originalMission", "stateVersion", '"victoryMode":"domination"']) {
        expect(wire).not.toContain(key);
      }
      expect(views[i]!.game!.missions).toBeNull();
      expect(views[i]!.game!.victoryMode).toBe("missions");
    }
    const stored = JSON.parse(new Store(env.dbPath).getRoom(host.roomId)!.stateJson!) as GameState;
    expect(stored.stateVersion).toBe(6);
    expect(Object.keys(stored.secret.originalMission)).toHaveLength(3);
  });

  it("2 players: a neutral owner exists, no eliminate mission, and it all survives a restart", async () => {
    const env = await newEnv(3);
    const host = await createRoom(env.srv, "Host");
    const g = await joinRoom(env.srv, host.roomId, "Gast");
    const a = await connect(env, host);
    const b = await connect(env, g);
    a.send({ type: "start" });
    const va = await a.nextView((v) => v.status === "playing");
    const vb = await b.latestView((v) => v.status === "playing");
    const neutral = Object.values(va.game!.territories).filter((t) => t.ownerId === null);
    expect(neutral).toHaveLength(2);
    expect(Object.keys(va.game!.handCounts)).toHaveLength(2);
    for (const v of [va, vb]) expect(v.game!.secret.mission!.type).not.toBe("eliminatePlayer");
    env.clients.splice(0).forEach((c) => c.close());
    await env.srv.close();
    const before = JSON.parse(new Store(env.dbPath).getRoom(host.roomId)!.stateJson!) as GameState;
    env.srv = await startServer(env.dbPath, { rng: env.rng });
    const a2 = await connect(env, host);
    const b2 = await connect(env, g);
    const ra = a2.views().at(-1)!;
    const rb = b2.views().at(-1)!;
    expect(ra.game).toEqual(va.game);
    expect(rb.game).toEqual(vb.game);
    const after = JSON.parse(new Store(env.dbPath).getRoom(host.roomId)!.stateJson!) as GameState;
    expect(after).toEqual(before);
    expect(after.stateVersion).toBe(6);
    expect(after.secret.originalMission).toEqual(before.secret.originalMission);
    expect(Object.values(after.territories).filter((t) => t.ownerId === null)).toHaveLength(2);
  });

  it("a replaced mission survives a restart, only in the holder's view", async () => {
    const env = await newEnv();
    const r = await rig(env, ["host", "guest", "third"], threeBoard, "third", (p) => ({
      host: hold(6, 3),
      guest: { type: "conquerContinents", continentIds: [MARK_B], extraContinents: 0 },
      third: kill(p["guest"]!),
    }));
    env.faces.push(...STRIKE_FACES);
    r.c["host"]!.send(strike);
    await r.c["third"]!.latestView((v) => v.game!.secret.missionReplaced);
    Object.values(r.c).forEach((c) => c.close());
    await env.srv.close();
    const stored = JSON.parse(
      new Store(env.dbPath).getRoom(r.ids["host"]!.roomId)!.stateJson!,
    ) as GameState;
    const third = r.ids["third"]!.playerId;
    expect(stored.secret.mission[third]).toEqual(testlandMissions.fallback);
    expect(stored.secret.originalMission[third]).toEqual(kill(r.ids["guest"]!.playerId));
    env.srv = await startServer(env.dbPath, { rng: env.rng });
    const t2 = await connect(env, r.ids["third"]!);
    const h2 = await connect(env, r.ids["host"]!);
    expect(t2.views().at(-1)!.game!.secret).toMatchObject({
      mission: testlandMissions.fallback,
      missionReplaced: true,
    });
    expect(h2.views().at(-1)!.game!.secret.missionReplaced).toBe(false);
    expect(h2.raw.join("\n")).not.toContain(FALLBACK);
  });
});

describe("secrecy over the wire (leak test)", () => {
  it("another player's mission and the switch to the fallback never reach a third connection", async () => {
    const env = await newEnv();
    const r = await rig(env, ["host", "guest", "third"], threeBoard, "third", (p) => ({
      host: hold(6, 3),
      guest: { type: "conquerContinents", continentIds: [MARK_B], extraContinents: 0 },
      third: kill(p["guest"]!), // aimed at the guest, who is eliminated by the host
    }));
    env.faces.push(...STRIKE_FACES);
    r.c["host"]!.send(strike);
    const last = await r.c["third"]!.latestView((v) => v.game!.secret.missionReplaced);
    expect(last.game!.secret.mission).toEqual(testlandMissions.fallback);
    await r.c["host"]!.latestView((v) => v.game!.pendingOccupation !== null);
    r.c["host"]!.send(act({ type: "occupy", count: 3 }));
    await r.c["host"]!.nextView((v) => v.game!.pendingOccupation === null);
    r.c["host"]!.send(act({ type: "endPhase" }));
    r.c["host"]!.send(act({ type: "endPhase" }));
    await r.c["third"]!.latestView((v) => v.game!.turn === 2);

    const wire = (n: string) => r.c[n]!.raw.join("\n");
    for (const n of ["host", "guest", "third"]) {
      const w = wire(n);
      expect(w, `${n}: originalMission`).not.toContain("originalMission");
      expect(w, `${n}: stateVersion`).not.toContain("stateVersion");
      expect(w, `${n}: no resolution`).not.toContain('"missions":{');
      expect(
        r.c[n]!.messages.every((m) => m.type === "snapshot"),
        `${n}: only snapshots`,
      ).toBe(true);
      for (const m of r.c[n]!.messages) expect(serverMessageSchema.parse(m)).toEqual(m);
    }
    // the host and the guest never see the switch: no fallback, no replaced flag, no eliminate mission
    for (const n of ["host", "guest"]) {
      expect(wire(n)).not.toContain('"missionReplaced":true');
      expect(wire(n)).not.toContain(FALLBACK);
      expect(wire(n)).not.toContain("eliminatePlayer");
    }
    // nobody sees the guest's mission except the guest, nobody sees the host's except the host
    expect(wire("host")).not.toContain(MARK_B);
    expect(wire("third")).not.toContain(MARK_B);
    expect(wire("guest")).toContain(MARK_B);
    const hostMission = JSON.stringify(hold(6, 3));
    expect(wire("guest")).not.toContain(hostMission);
    expect(wire("third")).not.toContain(hostMission);
    // the third player (the holder) sees the fallback and the flag, but not what it was before
    expect(wire("third")).toContain(FALLBACK);
    expect(wire("third")).toContain('"missionReplaced":true');
    // nobody sees a missions block before the game ends
    for (const n of ["host", "guest", "third"]) {
      for (const v of r.c[n]!.views().filter((x) => x.game)) {
        expect(v.game!.missions).toBeNull();
        expect(v.game!.winReason).toBeNull();
      }
    }
  });

  it("differential: everything the host and the guest receive is byte-identical with or without the hunter", async () => {
    const run = async (hunter: boolean) => {
      const env = await newEnv();
      const r = await rig(env, ["host", "guest", "third"], threeBoard, "third", (p) => ({
        host: hold(6, 3),
        guest: hold(6, 3),
        third: hunter ? kill(p["guest"]!) : hold(6, 2),
      }));
      env.faces.push(...STRIKE_FACES);
      r.c["host"]!.send(strike);
      await r.c["third"]!.latestView((v) => v.game!.pendingOccupation !== null);
      await r.c["host"]!.latestView((v) => v.game!.pendingOccupation !== null);
      r.c["host"]!.send(act({ type: "occupy", count: 3 }));
      await r.c["host"]!.nextView((v) => v.game!.pendingOccupation === null);
      r.c["host"]!.send(act({ type: "endPhase" }));
      r.c["host"]!.send(act({ type: "endPhase" }));
      await r.c["third"]!.latestView((v) => v.game!.turn === 2);
      await r.c["host"]!.latestView((v) => v.game!.turn === 2);
      await r.c["guest"]!.latestView((v) => v.game!.turn === 2);
      const norm = (text: string): string => {
        let out = text.split(r.ids["host"]!.roomId).join("<ROOM>");
        for (const n of ["host", "guest", "third"]) {
          out = out.split(r.ids[n]!.playerId).join(`<${n}>`);
        }
        return out;
      };
      // Only what follows the attack (version 5 on): before it come presence updates of the reconnects,
      // whose order depends on the old sockets closing, not on the game.
      const after = (n: string) =>
        r.c[n]!.raw.filter((t) => (JSON.parse(t) as { view: RoomView }).view.version >= 5);
      const wires = Object.fromEntries(
        ["host", "guest", "third"].map((n) => [n, after(n).map(norm)]),
      );
      const thirdOwn = r.c["third"]!.views()
        .filter((v) => v.version >= 5)
        .map((v) => ({ ...v.game!.secret }));
      return {
        wires,
        thirdOwn,
        sizes: Object.fromEntries(Object.entries(wires).map(([k, w]) => [k, w.length])),
      };
    };
    const hunted = await run(true);
    const control = await run(false);
    expect(hunted.wires["host"]).toEqual(control.wires["host"]);
    expect(hunted.wires["guest"]).toEqual(control.wires["guest"]);
    // same number and order of messages for the holder too; only the holder's own secret differs
    expect(hunted.sizes).toEqual(control.sizes);
    const strip = (lines: string[]) =>
      lines.map((l) => {
        const m = JSON.parse(l) as { view: { game?: { secret?: unknown } } };
        if (m.view.game) delete m.view.game.secret;
        return m;
      });
    expect(strip(hunted.wires["third"]!)).toEqual(strip(control.wires["third"]!));
    expect(hunted.thirdOwn).not.toEqual(control.thirdOwn);
    expect(hunted.thirdOwn.some((s) => s.missionReplaced)).toBe(true);
    expect(control.thirdOwn.some((s) => s.missionReplaced)).toBe(false);
  });
});

describe("after the game: the resolution", () => {
  const finish = async (env: Env) => {
    const r = await rig(env, ["host", "guest", "third"], threeBoard, "third", (p) => ({
      host: kill(p["guest"]!), // the holder eliminates his own target: wins at once
      guest: hold(6, 3),
      third: kill(p["guest"]!), // aimed at the same player: replaced, but the host wins first
    }));
    env.faces.push(...STRIKE_FACES);
    const before = r.c["host"]!.views().at(-1)!;
    expect(before.game!.missions).toBeNull();
    r.c["host"]!.send(strike);
    const done = await r.c["third"]!.nextView((v) => v.status === "finished");
    return { r, done };
  };
  const expectResolution = (v: RoomView, r: Rig) => {
    const [h, g, t] = ["host", "guest", "third"].map((n) => r.ids[n]!.playerId) as [
      string,
      string,
      string,
    ];
    expect(v.status).toBe("finished");
    expect(v.game!.winnerId).toBe(h);
    expect(v.game!.winReason).toBe("mission");
    expect(v.game!.missions).toEqual({
      [h]: { mission: kill(g), originalMission: null },
      [g]: { mission: hold(6, 3), originalMission: null },
      [t]: { mission: testlandMissions.fallback, originalMission: kill(g) },
    });
  };

  it("all missions, including the original of a replaced one, are visible to everyone at the end", async () => {
    const env = await newEnv();
    const { r, done } = await finish(env);
    expectResolution(done, r);
    for (const n of ["host", "guest"]) {
      expectResolution(await r.c[n]!.latestView((v) => v.status === "finished"), r);
    }
  });

  it("hello after the end and after a restart delivers the same resolution", async () => {
    const env = await newEnv();
    const { r } = await finish(env);
    Object.values(r.c).forEach((c) => c.close());
    await env.srv.close();
    env.srv = await startServer(env.dbPath, { rng: env.rng });
    for (const n of ["host", "guest", "third"]) {
      const c = await connect(env, r.ids[n]!);
      expectResolution(c.views().at(-1)!, r);
    }
    // the room stays finished: actions are refused
    const c = await connect(env, r.ids["host"]!);
    c.send(act({ type: "endPhase" }));
    const err = await c.waitFor(() => c.messages.find((m) => m.type === "error"));
    expect(err).toMatchObject({ code: "NOT_IN_GAME" });
  });
});

describe("self target at the start (question 22)", () => {
  /** A seed for which exactly one of three players draws the mission against himself; the seat of that player. */
  function findSeed(): { seed: number; seat: number } {
    for (let seed = 1; seed <= 200; seed++) {
      const r = createGame({
        map: testland,
        rules: testlandRules,
        playerIds: ["s0", "s1", "s2"],
        rng: createSeededRng(seed),
      });
      if (!r.ok) throw new Error(r.code);
      const replaced = ["s0", "s1", "s2"].filter((p) => r.state.secret.missionReplaced[p]);
      if (replaced.length === 1) return { seed, seat: Number(replaced[0]!.slice(1)) };
    }
    throw new Error("no seed found");
  }

  it("the holder gets the fallback and the flag, nobody else sees anything of it; the resolution shows the original", async () => {
    const { seed, seat } = findSeed();
    const env = await newEnv(seed);
    const names = ["Host", "Gast", "Dritter"];
    const host = await createRoom(env.srv, names[0]!);
    const ids = [
      host,
      await joinRoom(env.srv, host.roomId, names[1]!),
      await joinRoom(env.srv, host.roomId, names[2]!),
    ];
    const cs = [] as TestClient[];
    for (const id of ids) cs.push(await connect(env, id));
    cs[0]!.send({ type: "start" });
    const views = await Promise.all(cs.map((c) => c.nextView((v) => v.status === "playing")));
    views.forEach((v, i) => {
      const own = v.game!.secret;
      if (i === seat) {
        expect(own.missionReplaced).toBe(true);
        expect(own.mission).toEqual(testlandMissions.fallback);
      } else {
        expect(own.missionReplaced).toBe(false);
      }
    });
    for (let i = 0; i < 3; i++) {
      const w = cs[i]!.raw.join("\n");
      expect(w).not.toContain("originalMission");
      // the holder was not told what he drew: his own wire has no eliminate mission at all
      if (i === seat) expect(w).not.toContain('"eliminatePlayer"');
      if (i !== seat) expect(w).not.toContain('"missionReplaced":true');
      for (const m of cs[i]!.messages) expect(serverMessageSchema.parse(m)).toEqual(m);
    }
    // prepare the end: the active player eliminates the only other player left, the third has no territory
    cs.forEach((c) => c.close());
    env.clients.splice(0);
    await env.srv.close();
    const store = new Store(env.dbPath);
    const state = JSON.parse(store.getRoom(host.roomId)!.stateJson!) as GameState;
    const order = state.playerOrder;
    const active = state.activePlayerId;
    const [victim, gone] = order.filter((p) => p !== active);
    for (const t of Object.keys(state.territories))
      state.territories[t] = { ownerId: active, armies: 1 };
    state.territories["eisenfurt"] = { ownerId: active, armies: 5 };
    state.territories["rabenhain"] = { ownerId: victim!, armies: 1 };
    state.phase = "attack";
    state.reinforcementsLeft = 0;
    void gone;
    store.saveGame(host.roomId, "playing", state, Date.now());
    store.close();
    env.srv = await startServer(env.dbPath, { rng: env.rng });
    diceOn(env);
    const byId = new Map<string, TestClient>();
    for (const id of ids) byId.set(id.playerId, await connect(env, id));
    env.faces.push(...STRIKE_FACES);
    byId.get(active)!.send(strike);
    const end = await byId
      .get(order[0] === active ? active : active)!
      .nextView((v) => v.status === "finished");
    const holder = ids[seat]!.playerId;
    for (const id of ids) {
      const v = (await byId.get(id.playerId)!.latestView((x) => x.status === "finished")).game!;
      expect(v.missions![holder]!.originalMission).toEqual(kill(holder));
      expect(v.missions![holder]!.mission).toEqual(testlandMissions.fallback);
    }
    expect(end.game!.missions).not.toBeNull();
  });
});
