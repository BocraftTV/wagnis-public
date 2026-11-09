import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createSeededRng } from "@wagnis/engine";
import type { GameState, Rng } from "@wagnis/engine";
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
  toPhase3Format,
  unreachableMissions,
} from "./test-helpers.js";

let dir: string;
let dbPath: string;
let srv: TestServer;
const clients: TestClient[] = [];

/** Seeded for setup; in dice mode only the queued faces (int(6)) and a seeded fallback for shuffles. */
const faces: number[] = [];
let diceMode = false;
const seeded = createSeededRng(11);
const rng: Rng = {
  int(max) {
    if (!diceMode || max !== 6) return seeded.int(max);
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

const act = (action: unknown, reqId?: string) => ({ type: "action", reqId, action });

interface Rig {
  ids: Record<string, Identity>;
  clients: Record<string, TestClient>;
}

/**
 * Starts a game with the named players (first is the host), then rewrites the stored state: the first
 * name is active in `phase`, territories as given (rest to `fill`), no reinforcements left.
 */
async function rig(
  names: string[],
  territories: Record<string, [owner: string, armies: number]>,
  fill: string,
  opts: {
    phase?: GameState["phase"];
    mutate?: (s: GameState, id: Record<string, string>) => void;
  } = {},
): Promise<Rig> {
  const host = await createRoom(srv, names[0]!);
  const ids: Record<string, Identity> = { [names[0]!]: host };
  for (const n of names.slice(1)) ids[n] = await joinRoom(srv, host.roomId, n);
  const starter = await TestClient.connect(srv, host);
  for (const n of names.slice(1)) clients.push(await TestClient.connect(srv, ids[n]!));
  starter.send({ type: "start" });
  await starter.nextView((v) => v.status === "playing");
  starter.close();
  clients.splice(0).forEach((c) => c.close());

  const pid = Object.fromEntries(names.map((n) => [n, ids[n]!.playerId]));
  const store = new Store(dbPath);
  const state = JSON.parse(store.getRoom(host.roomId)!.stateJson!) as GameState;
  for (const t of Object.keys(state.territories)) {
    const [owner, armies] = territories[t] ?? [fill, 1];
    state.territories[t] = { ownerId: pid[owner]!, armies };
  }
  state.playerOrder = names.map((n) => pid[n]!);
  state.activePlayerId = pid[names[0]!]!;
  state.phase = opts.phase ?? "attack";
  state.reinforcementsLeft = 0;
  state.secret.hand = Object.fromEntries(names.map((n) => [pid[n]!, []]));
  unreachableMissions(state);
  opts.mutate?.(state, pid);
  store.saveGame(host.roomId, "playing", state, Date.now());
  store.close();
  diceMode = true;

  const out: Record<string, TestClient> = {};
  for (const n of names) out[n] = await connect(ids[n]!);
  return { ids, clients: out };
}

const INF = ["card-eisenfurt", "card-tannenfeld", "card-kupferstadt"];

describe("fortify over the wire", () => {
  async function fortifyRig() {
    return rig(
      ["host", "guest"],
      { eisenfurt: ["host", 5], rabenhain: ["host", 2], tannenfeld: ["host", 3] },
      "guest",
      { phase: "fortify" },
    );
  }

  it("moves armies, ends the turn and gives both players the new snapshot", async () => {
    const { ids, clients: c } = await fortifyRig();
    const view = await c["host"]!.latestView();
    expect(view.game!.fortify).toEqual({
      reach: "connected",
      groups: [["eisenfurt", "rabenhain", "tannenfeld"]],
      movesDone: 0,
      movesMax: 1,
    });
    expect((await c["guest"]!.latestView()).game!.fortify).toBeNull();
    const before = view.version;
    c["host"]!.send(act({ type: "fortify", from: "eisenfurt", to: "tannenfeld", count: 4 }, "f1"));
    const h = await c["host"]!.nextView((v) => v.game!.turn === 2);
    const g = await c["guest"]!.nextView((v) => v.game!.turn === 2);
    expect(h.version).toBe(before + 1);
    expect(g.version).toBe(h.version);
    for (const v of [h, g]) {
      expect(v.game!.territories["eisenfurt"]!.armies).toBe(1);
      expect(v.game!.territories["tannenfeld"]!.armies).toBe(7);
      expect(v.game!.activePlayerId).toBe(ids["guest"]!.playerId);
    }
    // A second fortify by the same player is not their turn any more.
    const sent = c["host"]!.messages.length;
    c["host"]!.send(act({ type: "fortify", from: "eisenfurt", to: "rabenhain", count: 1 }, "f2"));
    const err = await c["host"]!.waitFor(() =>
      c["host"]!.messages.slice(sent).find((m) => m.type === "error"),
    );
    expect(err).toMatchObject({ code: "NOT_YOUR_TURN", reqId: "f2" });
  });

  it("answers the new error codes to the sender only and stores nothing", async () => {
    const { clients: c } = await fortifyRig();
    const version = (await c["host"]!.latestView()).version;
    const sent = c["host"]!.messages.length;
    const sentGuest = c["guest"]!.messages.length;
    const cases: [unknown, string][] = [
      [{ type: "fortify", from: "eisenfurt", to: "eisenfurt", count: 1 }, "SAME_TERRITORY"],
      [{ type: "fortify", from: "eisenfurt", to: "salzmoor", count: 1 }, "NOT_OWNER"],
      [{ type: "fortify", from: "eisenfurt", to: "rabenhain", count: 5 }, "INVALID_COUNT"],
      [{ type: "tradeCards", cardIds: INF }, "WRONG_PHASE"],
    ];
    for (const [action, code] of cases) {
      c["host"]!.send(act(action, code));
      const err = await c["host"]!.waitFor(() =>
        c["host"]!.messages.slice(sent).find((m) => m.type === "error" && m.reqId === code),
      );
      expect(err).toMatchObject({ code });
    }
    expect(c["guest"]!.messages.length).toBe(sentGuest);
    expect((await c["host"]!.latestView()).version).toBe(version);
  });

  it("rejects a malformed trade before the engine", async () => {
    const { clients: c } = await fortifyRig();
    const sent = c["host"]!.messages.length;
    c["host"]!.send(act({ type: "tradeCards", cardIds: ["a", "b"] }, "bad"));
    const err = await c["host"]!.waitFor(() =>
      c["host"]!.messages.slice(sent).find((m) => m.type === "error"),
    );
    expect(err).toMatchObject({ code: "BAD_MESSAGE" });
  });
});

describe("trading over the wire", () => {
  const reinforceRig = (hand: string[]) =>
    rig(["host", "guest"], { eisenfurt: ["host", 2], tannenfeld: ["host", 2] }, "guest", {
      phase: "reinforce",
      mutate: (s, id) => {
        s.secret.hand[id["host"]!] = hand;
        s.secret.deck = ["card-dornental"];
        s.reinforcementsLeft = 3;
      },
    });

  it("locks placing with MUST_TRADE at 5 cards, then trades one set for everyone to see", async () => {
    const hand = [...INF, "card-rabenhain", "card-salzmoor"];
    const { ids, clients: c } = await reinforceRig(hand);
    const own = await c["host"]!.latestView();
    expect(own.game!.secret.mustTrade).toBe(true);
    expect(own.game!.secret.suggestedSets.length).toBeGreaterThan(0);
    const other = await c["guest"]!.latestView();
    expect(other.game!.secret.suggestedSets).toEqual([]);
    expect(other.game!.handCounts).toEqual({
      [ids["host"]!.playerId]: 5,
      [ids["guest"]!.playerId]: 0,
    });

    let sent = c["host"]!.messages.length;
    c["host"]!.send(act({ type: "placeArmies", territoryId: "eisenfurt", count: 1 }, "p"));
    expect(
      await c["host"]!.waitFor(() =>
        c["host"]!.messages.slice(sent).find((m) => m.type === "error"),
      ),
    ).toMatchObject({ code: "MUST_TRADE" });

    c["host"]!.send(act({ type: "tradeCards", cardIds: INF, bonusTerritoryId: "tannenfeld" }));
    const h = await c["host"]!.nextView((v) => v.game!.lastTrade !== null);
    const g = await c["guest"]!.nextView((v) => v.game!.lastTrade !== null);
    expect(h.game!.reinforcementsLeft).toBe(3 + 4);
    expect(h.game!.secret.mustTrade).toBe(false);
    expect(h.game!.secret.hand.map((x) => x.id)).toEqual(["card-rabenhain", "card-salzmoor"]);
    expect(h.game!.territories["tannenfeld"]!.armies).toBe(4);
    expect(h.game!.discardCount).toBe(3);
    for (const v of [h, g]) {
      expect(v.game!.lastTrade).toMatchObject({
        seq: 1,
        playerId: ids["host"]!.playerId,
        armies: 4,
        bonusTerritoryId: "tannenfeld",
      });
      expect(v.game!.lastTrade!.cards.map((x) => x.id)).toEqual(INF);
    }
    // The guest sees the traded cards, but nothing of what stayed in the host's hand.
    const wire = c["guest"]!.raw.join("\n");
    expect(wire).not.toContain("card-rabenhain");
    expect(wire).not.toContain("card-salzmoor");
    expect(wire).not.toContain("card-dornental");
    sent = c["host"]!.messages.length;
    c["host"]!.send(act({ type: "placeArmies", territoryId: "eisenfurt", count: 7 }));
    const placed = await c["host"]!.nextView((v) => v.game!.reinforcementsLeft === 0);
    expect(placed.game!.territories["eisenfurt"]!.armies).toBe(9);
  });

  it("rejects 2 x infantry + cavalry with INVALID_SET and a foreign card with UNKNOWN_CARD", async () => {
    const { clients: c } = await reinforceRig([...INF, "card-rabenhain"]);
    const version = (await c["host"]!.latestView()).version;
    const ask = async (cardIds: string[]) => {
      const sent = c["host"]!.messages.length;
      c["host"]!.send(act({ type: "tradeCards", cardIds }));
      return c["host"]!.waitFor(() =>
        c["host"]!.messages.slice(sent).find((m) => m.type === "error"),
      );
    };
    expect(await ask(["card-eisenfurt", "card-tannenfeld", "card-rabenhain"])).toMatchObject({
      code: "INVALID_SET",
    });
    expect(await ask(["card-eisenfurt", "card-tannenfeld", "card-joker-2"])).toMatchObject({
      code: "UNKNOWN_CARD",
    });
    expect((await c["host"]!.latestView()).version).toBe(version);
  });

  it("keeps the snapshot small for a large hand (11 cards)", async () => {
    const all = [
      ...INF,
      "card-rabenhain",
      "card-salzmoor",
      "card-nebelkueste",
      "card-grauwacht",
      "card-dornental",
      "card-joker-1",
      "card-joker-2",
    ];
    const { clients: c } = await reinforceRig(all);
    const raw = c["host"]!.raw.filter((r) => r.includes('"suggestedSets":[{'));
    expect(raw.length).toBeGreaterThan(0);
    expect(raw.at(-1)!.length).toBeLessThan(20_000);
  });
});

describe("cards never leak to other players", () => {
  const HAND_HOST = "card-eisenfurt";
  const JOKER = "card-joker-1"; // the guest's card, taken over by the host
  const DRAWN = "card-salzmoor"; // top of the deck, drawn by the host at the end of the turn
  const NEXT = "card-dornental"; // drawn by the third player after the restart
  const stored = (roomId: string): GameState => {
    const store = new Store(dbPath);
    const state = JSON.parse(store.getRoom(roomId)!.stateJson!) as GameState;
    store.close();
    return state;
  };
  const sawNone = (c: TestClient, ids: string[]) => {
    const wire = c.raw.join("\n");
    for (const id of ids) expect(wire, id).not.toContain(id);
  };

  it("draw, takeover, reconnect and restart: the observer never sees any of it; the deck order survives", async () => {
    const r = await rig(
      ["host", "guest", "third"],
      { eisenfurt: ["host", 6], rabenhain: ["guest", 1], tannenfeld: ["third", 5] },
      "third",
      {
        mutate: (s, id) => {
          s.secret.hand[id["host"]!] = [HAND_HOST];
          s.secret.hand[id["guest"]!] = [JOKER];
          s.secret.deck = [DRAWN, NEXT, "card-kupferstadt"];
        },
      },
    );
    const { host, guest, third } = r.clients as Record<string, TestClient>;
    const roomId = r.ids["host"]!.roomId;

    // The host conquers the guest's last territory: eliminated, hand taken over, then the turn ends with a draw.
    faces.push(6, 5, 4, 1);
    host!.send(act({ type: "attack", from: "eisenfurt", to: "rabenhain", dice: 3 }));
    await host!.nextView((v) => v.game!.pendingOccupation !== null);
    host!.send(act({ type: "occupy", count: 3 }));
    await host!.nextView((v) => v.game!.pendingOccupation === null);
    host!.send(act({ type: "endPhase" }));
    host!.send(act({ type: "endPhase" }));
    const hv = await host!.nextView((v) => v.game!.turn === 2);
    expect(hv.game!.secret.hand.map((c) => c.id)).toEqual([HAND_HOST, JOKER, DRAWN]);
    const tv = await third!.latestView((v) => v.game!.turn === 2);
    expect(tv.game!.handCounts).toEqual({
      [r.ids["host"]!.playerId]: 3,
      [r.ids["guest"]!.playerId]: 0,
      [r.ids["third"]!.playerId]: 0,
    });
    expect(tv.game!.secret.hand).toEqual([]);
    expect(tv.game!.deckCount).toBe(2);
    sawNone(third!, [HAND_HOST, JOKER, DRAWN, "card-kupferstadt", NEXT]);
    sawNone(guest!, [HAND_HOST, DRAWN, "card-kupferstadt", NEXT]);
    expect(host!.raw.join("\n")).toContain(DRAWN);

    // Reconnect: the new socket gets a snapshot without the cards either.
    third!.close();
    await third!.closed();
    const third2 = await connect(r.ids["third"]!);
    sawNone(third2, [HAND_HOST, JOKER, DRAWN, "card-kupferstadt", NEXT]);

    // Restart: the deck order is unchanged.
    clients.splice(0).forEach((c) => c.close());
    await srv.close();
    expect(stored(roomId).secret.deck).toEqual([NEXT, "card-kupferstadt"]);
    srv = await startServer(dbPath, { rng });
    const hostB = await connect(r.ids["host"]!);
    const thirdB = await connect(r.ids["third"]!);
    sawNone(thirdB, [HAND_HOST, JOKER, DRAWN, "card-kupferstadt", NEXT]);
    expect((await hostB.latestView()).game!.secret.hand.map((c) => c.id)).toEqual([
      HAND_HOST,
      JOKER,
      DRAWN,
    ]);

    // The third player conquers and draws the next card of the same order.
    const start = await thirdB.latestView();
    thirdB.send(
      act({
        type: "placeArmies",
        territoryId: "tannenfeld",
        count: start.game!.reinforcementsLeft,
      }),
    );
    await thirdB.nextView((v) => v.game!.reinforcementsLeft === 0);
    thirdB.send(act({ type: "endPhase" }));
    await thirdB.nextView((v) => v.game!.phase === "attack");
    faces.push(6, 6, 6, 1, 1, 6, 6, 6, 1);
    thirdB.send(act({ type: "blitz", from: "tannenfeld", to: "rabenhain" }));
    const pending = await thirdB.nextView((v) => v.game!.pendingOccupation !== null);
    thirdB.send(act({ type: "occupy", count: pending.game!.pendingOccupation!.min }));
    await thirdB.nextView((v) => v.game!.pendingOccupation === null);
    thirdB.send(act({ type: "endPhase" }));
    thirdB.send(act({ type: "endPhase" }));
    const done = await thirdB.nextView((v) => v.game!.turn === 3);
    expect(done.game!.secret.hand.map((c) => c.id)).toEqual([NEXT]);
    expect(stored(roomId).secret.deck).toEqual(["card-kupferstadt"]);
    // The host (an observer now) did not see the third player's card or the rest of the deck.
    sawNone(hostB, [NEXT, "card-kupferstadt"]);
  });

  it("legacy state without cards: gets one deck, saved once, no version bump", async () => {
    const host = await createRoom(srv);
    const guest = await joinRoom(srv, host.roomId, "Gast");
    const a = await connect(host);
    await connect(guest);
    a.send({ type: "start" });
    await a.nextView((v) => v.status === "playing");
    clients.splice(0).forEach((c) => c.close());
    await srv.close();

    const store = new Store(dbPath);
    const legacy = toPhase3Format(JSON.parse(store.getRoom(host.roomId)!.stateJson!));
    delete legacy["lastTrade"];
    delete legacy["tradeSeq"];
    delete legacy["secret"].deck;
    delete legacy["secret"].discard;
    delete legacy["rules"].fortifyReach;
    delete legacy["rules"].cards;
    store.saveGame(host.roomId, "playing", legacy as unknown as GameState, Date.now());
    const version = store.getRoom(host.roomId)!.version;
    store.close();

    srv = await startServer(dbPath, { rng });
    const h = await connect(host);
    const view = await h.latestView();
    expect(view.game).toMatchObject({ deckCount: 10, discardCount: 0, lastTrade: null });
    expect(view.game!.secret.hand).toEqual([]);
    expect(view.version).toBe(version);
    const first = stored(host.roomId);
    expect(first.secret.deck).toHaveLength(10);
    expect(first.rules.cards.mustTradeAt).toBe(5);
    // Loading again does not reshuffle.
    const h2 = await connect(host);
    await h2.latestView();
    expect(stored(host.roomId).secret.deck).toEqual(first.secret.deck);
    expect(new Store(dbPath).getRoom(host.roomId)!.version).toBe(version);
  });
});
