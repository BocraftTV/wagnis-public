import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSeededRng } from "@wagnis/engine";
import type { GameState, Rng } from "@wagnis/engine";
import type { RoomView } from "@wagnis/shared";
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
  toPhase3Format,
  unreachableMissions,
} from "./test-helpers.js";

let dir: string;
let dbPath: string;
let srv: TestServer;
const clients: TestClient[] = [];

/** Seeded for setup; afterwards only the queued die faces, and a test error when they run out. */
const faces: number[] = [];
let diceMode = false;
const seeded = createSeededRng(11);
const rng: Rng = {
  int(max) {
    if (!diceMode) return seeded.int(max);
    if (max !== 6) throw new Error(`unexpected int(${max})`);
    const face = faces.shift();
    if (face === undefined) throw new Error("dice sequence exhausted");
    return face - 1;
  },
};

beforeEach(async () => {
  dir = makeTmpDir();
  dbPath = `${dir}/db.sqlite`;
  diceMode = false;
  faces.length = 0;
  srv = await startServer(dbPath, { rng });
});
afterEach(async () => {
  clients.splice(0).forEach((c) => c.close());
  await srv.close();
  removeDir(dir);
});

async function connect(id: Identity) {
  const c = await TestClient.connect(srv, id);
  clients.push(c);
  await c.latestView();
  return c;
}

interface Rig {
  host: Identity;
  guest: Identity;
}

/** Starts a game, then rewrites the stored state: host (active, attack phase) vs guest on testland. */
async function rigged(
  territories: Record<string, [owner: "host" | "guest", armies: number]>,
  fill: "host" | "guest" = "guest",
  mutate: (s: GameState) => void = () => {},
) {
  const host = await createRoom(srv, "Host");
  const guest = await joinRoom(srv, host.roomId, "Gast");
  const a0 = await connect(host);
  await connect(guest);
  a0.send({ type: "start" });
  await a0.nextView((v) => v.status === "playing");
  clients.splice(0).forEach((c) => c.close());

  const store = new Store(dbPath);
  const state = JSON.parse(store.getRoom(host.roomId)!.stateJson!) as GameState;
  const id = { host: host.playerId, guest: guest.playerId };
  for (const t of Object.keys(state.territories)) {
    const [owner, armies] = territories[t] ?? [fill, 1];
    state.territories[t] = { ownerId: id[owner], armies };
  }
  state.playerOrder = [id.host, id.guest];
  state.activePlayerId = id.host;
  state.phase = "attack";
  state.reinforcementsLeft = 0;
  unreachableMissions(state);
  mutate(state);
  store.saveGame(host.roomId, "playing", state, Date.now());
  store.close();
  diceMode = true;

  const a = await connect(host);
  const b = await connect(guest);
  const rig: Rig = { host, guest };
  return { ...rig, a, b };
}

const attackAction = (dice: number) => ({
  type: "action",
  action: { type: "attack", from: "eisenfurt", to: "rabenhain", dice },
});

describe("attack over the wire", () => {
  it("delivers the dice to every player in the snapshot, one version bump", async () => {
    const { host, guest, a, b } = await rigged({ eisenfurt: ["host", 5], rabenhain: ["guest", 4] });
    const before = await a.latestView();
    faces.push(3, 6, 1, 5, 3); // attacker 6-3-1, defender 5-3
    a.send(attackAction(3));
    const va = await a.nextView((v) => v.game!.lastCombat !== null);
    const vb = await b.nextView((v) => v.game!.lastCombat !== null);
    expect(va.version).toBe(before.version + 1);
    expect(vb.version).toBe(va.version);
    for (const v of [va, vb]) {
      expect(v.game!.lastCombat).toEqual({
        seq: 1,
        attackerId: host.playerId,
        defenderId: guest.playerId,
        from: "eisenfurt",
        to: "rabenhain",
        rolls: [
          { attackerDice: [6, 3, 1], defenderDice: [5, 3], attackerLosses: 1, defenderLosses: 1 },
        ],
        summary: { rollCount: 1, attackerLosses: 1, defenderLosses: 1, conquered: false },
      });
      expect(v.game!.territories["eisenfurt"]).toEqual({
        ownerId: host.playerId,
        armies: 4,
        maxAttackDice: 3,
        maxMove: 3,
      });
    }
  });

  it("passes the new error codes to the sender only, with the reqId, and stores nothing", async () => {
    const { a, b } = await rigged({
      eisenfurt: ["host", 3],
      rabenhain: ["guest", 4],
      tannenfeld: ["host", 1],
    });
    const version = (await a.latestView()).version;
    const sent = a.messages.length;
    const sentB = b.messages.length;
    const cases: [unknown, string][] = [
      [{ type: "attack", from: "eisenfurt", to: "rabenhain", dice: 3 }, "INVALID_DICE"],
      [{ type: "attack", from: "eisenfurt", to: "nebelkueste", dice: 1 }, "NOT_ADJACENT"],
      [{ type: "attack", from: "eisenfurt", to: "eisenfurt", dice: 1 }, "OWN_TARGET"],
      [{ type: "blitz", from: "tannenfeld", to: "grauwacht" }, "NOT_ENOUGH_ARMIES"],
      [{ type: "occupy", count: 1 }, "NO_OCCUPY_PENDING"],
    ];
    for (const [i, [action, code]] of cases.entries()) {
      a.send({ type: "action", reqId: `r${i}`, action });
      await a.waitFor(() =>
        a.messages.find((m) => m.type === "error" && m.code === code && m.reqId === `r${i}`),
      );
    }
    expect(a.messages.slice(sent).every((m) => m.type === "error")).toBe(true);
    expect(b.messages.length).toBe(sentB);
    const store = new Store(dbPath);
    expect(store.getRoom((await a.latestView()).roomId)!.version).toBe(version);
    store.close();
  });

  it("runs a blitz as one action: one version bump and one snapshot per player", async () => {
    const { a, b } = await rigged({ eisenfurt: ["host", 6], rabenhain: ["guest", 3] });
    const before = await a.latestView();
    const countA = a.views().length;
    const countB = b.views().length;
    // Roll 1: 6,6,6 vs 1,1 (defender 3 -> 1). Roll 2: 5,5,5 vs 2 -> conquered with 3 dice.
    faces.push(6, 6, 6, 1, 1, 5, 5, 5, 2);
    a.send({ type: "action", action: { type: "blitz", from: "eisenfurt", to: "rabenhain" } });
    const va = await a.nextView((v) => v.game!.lastCombat !== null);
    await b.nextView((v) => v.game!.lastCombat !== null);
    expect(va.version).toBe(before.version + 1);
    expect(a.views().length).toBe(countA + 1);
    expect(b.views().length).toBe(countB + 1);
    expect(va.game!.lastCombat!.summary).toEqual({
      rollCount: 2,
      attackerLosses: 0,
      defenderLosses: 3,
      conquered: true,
    });
    expect(va.game!.pendingOccupation).toEqual({
      from: "eisenfurt",
      to: "rabenhain",
      min: 3,
      max: 5,
    });
    expect(va.game!.conqueredThisTurn).toBe(true);
    expect(faces).toEqual([]);
  });

  it("enforces occupy and keeps lastCombat across it", async () => {
    const { a, b } = await rigged({ eisenfurt: ["host", 5], rabenhain: ["guest", 1] });
    faces.push(6, 5, 4, 1);
    a.send(attackAction(3));
    const won = await a.nextView((v) => v.game!.pendingOccupation !== null);
    expect(won.game!.pendingOccupation).toEqual({
      from: "eisenfurt",
      to: "rabenhain",
      min: 3,
      max: 4,
    });
    a.send({ type: "action", reqId: "e", action: { type: "endPhase" } });
    await a.waitFor(() =>
      a.messages.find((m) => m.type === "error" && m.code === "OCCUPY_PENDING"),
    );
    a.send({ type: "action", reqId: "o", action: { type: "occupy", count: 2 } });
    await a.waitFor(() =>
      a.messages.find((m) => m.type === "error" && m.code === "INVALID_OCCUPY_COUNT"),
    );
    a.send({ type: "action", action: { type: "occupy", count: 4 } });
    const done = await a.nextView((v) => v.game!.pendingOccupation === null);
    expect(done.game!.lastCombat).toEqual(won.game!.lastCombat);
    expect(done.game!.territories["rabenhain"]!.armies).toBe(4);
    const seenByB = await b.latestView(
      (v) => v.game!.pendingOccupation === null && v.game!.lastCombat !== null,
    );
    expect(seenByB.game!.lastCombat!.seq).toBe(1);
  });

  it("keeps seq stable across disconnect and a new hello", async () => {
    const { host, a, b } = await rigged({ eisenfurt: ["host", 5], rabenhain: ["guest", 4] });
    faces.push(3, 6, 1, 5, 3);
    a.send(attackAction(3));
    const first = await a.nextView((v) => v.game!.lastCombat !== null);
    a.close();
    await a.closed();
    await b.nextView((v) => !v.players.find((p) => p.id === host.playerId)!.connected);
    const again = await connect(host);
    const second = await again.latestView();
    expect(second.game!.lastCombat!.seq).toBe(first.game!.lastCombat!.seq);
    expect(second).toEqual(first);
    // another combat gets the next number
    faces.push(6, 1, 1);
    again.send(attackAction(1));
    const next = await again.nextView((v) => v.game!.lastCombat!.seq === 2);
    expect(next.game!.lastCombat!.seq).toBe(2);
  });

  it("clears lastCombat at the turn change but keeps counting", async () => {
    const { a } = await rigged({ eisenfurt: ["host", 5], rabenhain: ["guest", 4] });
    faces.push(3, 6, 1, 5, 3);
    a.send(attackAction(3));
    await a.nextView((v) => v.game!.lastCombat !== null);
    a.send({ type: "action", action: { type: "endPhase" } });
    await a.nextView();
    a.send({ type: "action", action: { type: "endPhase" } });
    const turn2 = await a.nextView((v) => v.game!.turn === 2);
    expect(turn2.game!.lastCombat).toBeNull();
    expect(turn2.game!.conqueredThisTurn).toBe(false);
  });
});

describe("game end", () => {
  const finalBlow = () => rigged({ eisenfurt: ["host", 5], rabenhain: ["guest", 1] }, "host");

  it("sets the room to finished, refuses actions, but lets players connect and see the result", async () => {
    const { host, guest, a, b } = await finalBlow();
    faces.push(6, 1);
    a.send(attackAction(1));
    const va = await a.nextView((v) => v.status === "finished");
    const vb = await b.nextView((v) => v.status === "finished");
    expect(va.game!.winnerId).toBe(host.playerId);
    expect(vb.game!.winnerId).toBe(host.playerId);
    expect(vb.game!.lastCombat!.summary.conquered).toBe(true);

    const store = new Store(dbPath);
    const stored = store.getRoom(host.roomId)!;
    expect(stored.status).toBe("finished");
    const storedJson = stored.stateJson;

    // every action, from either player, is NOT_IN_GAME and changes nothing
    const actions = [
      { type: "endPhase" },
      { type: "occupy", count: 1 },
      { type: "attack", from: "eisenfurt", to: "rabenhain", dice: 1 },
      { type: "blitz", from: "eisenfurt", to: "rabenhain" },
      { type: "placeArmies", territoryId: "eisenfurt", count: 1 },
    ];
    for (const [client, who] of [
      [a, "host"],
      [b, "guest"],
    ] as const) {
      for (const [i, action] of actions.entries()) {
        client.send({ type: "action", reqId: `${who}${i}`, action });
        await client.waitFor(() =>
          client.messages.find(
            (m) => m.type === "error" && m.code === "NOT_IN_GAME" && m.reqId === `${who}${i}`,
          ),
        );
      }
    }
    expect(store.getRoom(host.roomId)!.stateJson).toBe(storedJson);
    expect(store.getRoom(host.roomId)!.version).toBe(va.version);
    store.close();

    // hello still works and shows the finished game
    a.close();
    await a.closed();
    const again = await connect(host);
    const view: RoomView = await again.latestView();
    expect(view.status).toBe("finished");
    expect(view.version).toBe(va.version);
    expect(view.game!.winnerId).toBe(host.playerId);
    expect(view.game!.lastCombat!.seq).toBe(1);
    const lateGuest = await connect(guest);
    expect((await lateGuest.latestView()).status).toBe("finished");
  });

  it("does not let anyone join a finished room or start it again", async () => {
    const { host, a } = await finalBlow();
    faces.push(6, 1);
    a.send(attackAction(1));
    await a.nextView((v) => v.status === "finished");
    const join = await post(`${srv.base}/api/rooms/${host.roomId}/join`, { name: "Spaet" });
    expect(join.status).toBe(409);
    expect(join.body.error.code).toBe("ROOM_NOT_JOINABLE");
    a.send({ type: "start" });
    await a.waitFor(() => a.messages.find((m) => m.type === "error" && m.code === "NOT_IN_LOBBY"));
  });

  it("a blitz that wins also finishes the room", async () => {
    const { host, a } = await finalBlow();
    faces.push(6, 5, 4, 1);
    a.send({ type: "action", action: { type: "blitz", from: "eisenfurt", to: "rabenhain" } });
    const v = await a.nextView((x) => x.status === "finished");
    expect(v.game!.winnerId).toBe(host.playerId);
  });
});

describe("leaks", () => {
  it("shows no secrets, no combatSeq and no rules on the wire during an attack", async () => {
    const MARK = "GEHEIM-ANGRIFF-5d21";
    const { host, guest, a, b } = await rigged(
      { eisenfurt: ["host", 5], rabenhain: ["guest", 1] },
      "guest",
      (s) => {
        s.secret.mission = Object.fromEntries(
          Object.keys(s.secret.mission).map((p) => [
            p,
            {
              type: "conquerContinents" as const,
              continentIds: [`${MARK}-${p}`],
              extraContinents: 0,
            },
          ]),
        );
        s.secret.hand = {
          [s.playerOrder[0]!]: ["card-joker-1"],
          [s.playerOrder[1]!]: ["card-joker-2"],
        };
      },
    );
    faces.push(6, 5, 4, 1);
    a.send(attackAction(3));
    await a.nextView((v) => v.game!.pendingOccupation !== null);
    await b.nextView((v) => v.game!.pendingOccupation !== null);
    const wireA = a.raw.join("\n");
    const wireB = b.raw.join("\n");
    expect(wireA).toContain(`${MARK}-${host.playerId}`);
    expect(wireA).not.toContain(`${MARK}-${guest.playerId}`);
    expect(wireA).not.toContain("card-joker-2"); // the guest's card
    expect(wireB).not.toContain(`${MARK}-${host.playerId}`);
    expect(wireB).not.toContain("card-joker-1"); // the host's card
    for (const wire of [wireA, wireB]) {
      expect(wire).not.toContain("combatSeq");
      expect(wire).not.toContain('"rules"');
      expect(wire).not.toContain("tokenHash");
    }
  });
});

describe("restart with a phase 1 state", () => {
  it("fills the new fields when loading and plays on", async () => {
    const { host, guest, a } = await rigged({ eisenfurt: ["host", 5], rabenhain: ["guest", 4] });
    clients.splice(0).forEach((c) => c.close());
    await srv.close();

    // Rewrite the stored state the way phase 1 saved it: without any attack field.
    const store = new Store(dbPath);
    const legacy = toPhase3Format(JSON.parse(store.getRoom(host.roomId)!.stateJson!));
    for (const k of [
      "pendingOccupation",
      "conqueredThisTurn",
      "winnerId",
      "lastCombat",
      "combatSeq",
    ])
      delete legacy[k];
    store.saveGame(host.roomId, "playing", legacy as unknown as GameState, Date.now());
    store.close();
    void a;

    srv = await startServer(dbPath, { rng });
    const g = await connect(guest);
    const view = await g.latestView();
    expect(view.game).toMatchObject({
      pendingOccupation: null,
      conqueredThisTurn: false,
      winnerId: null,
      lastCombat: null,
    });
    expect(view.game!.territories["eisenfurt"]!.maxAttackDice).toBe(3);

    const h = await connect(host);
    faces.push(3, 6, 1, 5, 3);
    h.send(attackAction(3));
    const played = await h.nextView((v) => v.game!.lastCombat !== null);
    expect(played.game!.lastCombat!.seq).toBe(1);
    const check = new Store(dbPath);
    const saved = JSON.parse(check.getRoom(host.roomId)!.stateJson!) as GameState;
    check.close();
    expect(saved.combatSeq).toBe(1);
    expect(saved.winnerId).toBeNull();
  });

  it("keeps an attack state through a restart: seq, pending occupation and winner", async () => {
    const { host, guest, a } = await rigged({ eisenfurt: ["host", 5], rabenhain: ["guest", 1] });
    faces.push(6, 5, 4, 1);
    a.send(attackAction(3));
    const before = await a.nextView((v) => v.game!.pendingOccupation !== null);
    clients.splice(0).forEach((c) => c.close());
    await srv.close();

    srv = await startServer(dbPath, { rng });
    const h = await connect(host);
    const after = await h.latestView();
    expect(after).toEqual({
      ...before,
      players: before.players.map((p) => ({ ...p, connected: p.id === host.playerId })),
    });
    void guest;
  });
});
