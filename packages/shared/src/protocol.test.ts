import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import type { Action, ActionErrorCode, GameView, HostAction } from "@wagnis/engine";
import {
  ROOM_ID_ALPHABET,
  clientMessageSchema,
  createRoomRequestSchema,
  formatRoomId,
  gameViewSchema,
  isValidRoomId,
  joinRoomRequestSchema,
  normalizeRoomId,
  roomViewSchema,
  serverMessageSchema,
  WS_CLOSE_REMOVED,
  wsErrorCodeSchema,
} from "./index.js";
import type { ActionMessage, GameViewMessage, HostActionMessage, WsErrorCode } from "./index.js";

// Compile-time checks: the wire schema and the engine types must not drift apart.
type Equal<A, B> =
  (<T>() => T extends A ? 1 : 2) extends <T>() => T extends B ? 1 : 2 ? true : false;
const viewMatchesEngine: Equal<GameViewMessage, GameView> = true;
const engineErrorsCovered: ActionErrorCode extends WsErrorCode ? true : false = true;
// Every wire action is a valid engine action.
const actionsMatchEngine: ActionMessage extends Action ? true : false = true;
// transferHost is a server-only room action: every other host message is an engine host action
const hostActionsMatchEngine: Exclude<
  HostActionMessage,
  { type: "transferHost" }
> extends HostAction
  ? true
  : false = true;

const view = {
  roomId: "K7M2XQ",
  status: "playing",
  mapId: "testland",
  version: 3,
  you: { playerId: "p1", isHost: true },
  players: [{ id: "p1", name: "Jakob", seat: 0, isHost: true, connected: true, removed: false }],
  victoryMode: "missions",
  fortifyMoves: 1,
  missionDraft: false,
  holdToWin: false,
  gameNo: 1,
  publicUrl: null,
  game: {
    mapId: "testland",
    phase: "reinforce",
    turn: 1,
    activePlayerId: "p1",
    playerOrder: ["p1", "p2"],
    removedPlayerIds: [],
    reinforcementsLeft: 3,
    territories: { eisenfurt: { ownerId: "p1", armies: 2, maxAttackDice: 1, maxMove: 1 } },
    pendingOccupation: null,
    conqueredThisTurn: false,
    conquestsThisTurn: 0,
    victoryPending: false,
    missionChoice: null,
    winnerId: null,
    winReason: null,
    victoryMode: "missions",
    missions: null,
    lastCombat: null,
    lastTrade: null,
    deckCount: 10,
    discardCount: 0,
    fortify: null,
    secret: {
      mission: null,
      missionReplaced: false,
      missionOffer: null,
      victoryPending: false,
      missionProgress: null,
      hand: [],
      suggestedSets: [],
      mustTrade: false,
    },
    handCounts: { p1: 0, p2: 0 },
  },
};

const protocolDoc = readFileSync(new URL("../../../docs/protocol.md", import.meta.url), "utf8");

describe("protocol examples in docs/protocol.md", () => {
  const blocks = [...protocolDoc.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]!);
  const jsonLines = blocks
    .flatMap((b) => b.split("\n"))
    .filter((l) => l.startsWith('{ "type": "'))
    .map((l) => JSON.parse(l) as unknown);

  it("has client and server examples, including the attack, fortify and trade actions", () => {
    const types = jsonLines.map((m) => (m as { action?: { type: string } }).action?.type);
    for (const t of ["attack", "blitz", "occupy", "fortify", "tradeCards"])
      expect(types).toContain(t);
  });

  it("are all accepted by the schemas", () => {
    for (const m of jsonLines) {
      const ok =
        clientMessageSchema.safeParse(m).success || serverMessageSchema.safeParse(m).success;
      expect(ok, JSON.stringify(m)).toBe(true);
    }
  });

  it("includes a snapshot example that the schema accepts and that shows the new fields", () => {
    const snapshot = blocks.find((b) => b.includes('"type": "snapshot"'))!;
    const json = snapshot.slice(0, snapshot.indexOf("\n}\n") + 2);
    const parsed = serverMessageSchema.parse(JSON.parse(json));
    if (parsed.type !== "snapshot") throw new Error("not a snapshot");
    const game = parsed.view.game!;
    expect(game.pendingOccupation).toEqual({ from: "eisenfurt", to: "rabenhain", min: 3, max: 4 });
    expect(game.lastCombat!.seq).toBe(7);
    expect(game.territories["eisenfurt"]!.maxAttackDice).toBe(3);
  });
});

describe("attack protocol", () => {
  const act = (action: unknown) =>
    clientMessageSchema.safeParse({ type: "action", action }).success;

  it("accepts attack, blitz and occupy", () => {
    expect(act({ type: "attack", from: "a", to: "b", dice: 1 })).toBe(true);
    expect(act({ type: "attack", from: "a", to: "b", dice: 3 })).toBe(true);
    expect(act({ type: "blitz", from: "a", to: "b" })).toBe(true);
    expect(act({ type: "occupy", count: 1 })).toBe(true);
    expect(act({ type: "occupy", count: 12 })).toBe(true);
  });

  it("rejects bad dice and counts", () => {
    for (const dice of [0, 4, 1.5, -1, "2", null, Number.NaN])
      expect(act({ type: "attack", from: "a", to: "b", dice }), String(dice)).toBe(false);
    for (const count of [0, -2, 1.5, "1", null])
      expect(act({ type: "occupy", count }), String(count)).toBe(false);
  });

  it("rejects missing, empty and extra fields", () => {
    expect(act({ type: "attack", from: "a", to: "b" })).toBe(false);
    expect(act({ type: "attack", from: "", to: "b", dice: 1 })).toBe(false);
    expect(act({ type: "blitz", from: "a" })).toBe(false);
    expect(act({ type: "blitz", from: "a", to: "b", dice: 3 })).toBe(false);
    expect(act({ type: "occupy" })).toBe(false);
    expect(act({ type: "occupy", count: 1, from: "a" })).toBe(false);
  });

  it("knows every new error code on the wire", () => {
    for (const code of [
      "INVALID_DICE",
      "NOT_ADJACENT",
      "OWN_TARGET",
      "NOT_ENOUGH_ARMIES",
      "OCCUPY_PENDING",
      "NO_OCCUPY_PENDING",
      "INVALID_OCCUPY_COUNT",
      "GAME_OVER",
    ])
      expect(wsErrorCodeSchema.safeParse(code).success, code).toBe(true);
  });

  it("accepts snapshots with an open occupation, a combat and a winner", () => {
    const game = {
      ...view.game,
      pendingOccupation: { from: "eisenfurt", to: "rabenhain", min: 3, max: 4 },
      conqueredThisTurn: true,
      winnerId: "p1",
      lastCombat: {
        seq: 1,
        attackerId: "p1",
        defenderId: "p2",
        from: "eisenfurt",
        to: "rabenhain",
        rolls: [{ attackerDice: [6], defenderDice: [1], attackerLosses: 0, defenderLosses: 1 }],
        summary: { rollCount: 1, attackerLosses: 0, defenderLosses: 1, conquered: true },
      },
    };
    expect(gameViewSchema.safeParse(game).success).toBe(true);
    expect(gameViewSchema.safeParse({ ...game, winnerId: undefined }).success).toBe(false);
  });

  it("strips fields the schema does not know from outgoing messages", () => {
    const parsed = serverMessageSchema.parse({
      type: "snapshot",
      view: { ...view, game: { ...view.game, combatSeq: 9, rules: {} } },
    });
    expect(JSON.stringify(parsed)).not.toContain("combatSeq");
  });
});

describe("fortify and card protocol", () => {
  const act = (action: unknown) =>
    clientMessageSchema.safeParse({ type: "action", action }).success;
  const ids = ["card-a", "card-b", "card-c"];

  it("accepts fortify and tradeCards", () => {
    expect(act({ type: "fortify", from: "a", to: "b", count: 1 })).toBe(true);
    expect(act({ type: "fortify", from: "a", to: "b", count: 12 })).toBe(true);
    expect(act({ type: "tradeCards", cardIds: ids })).toBe(true);
    expect(act({ type: "tradeCards", cardIds: ids, bonusTerritoryId: "eisenfurt" })).toBe(true);
  });

  it("rejects bad counts, missing and extra fields for fortify", () => {
    for (const count of [0, -1, 1.5, "1", null, Number.NaN])
      expect(act({ type: "fortify", from: "a", to: "b", count }), String(count)).toBe(false);
    expect(act({ type: "fortify", from: "a", to: "b" })).toBe(false);
    expect(act({ type: "fortify", from: "", to: "b", count: 1 })).toBe(false);
    expect(act({ type: "fortify", from: "a", to: "", count: 1 })).toBe(false);
    expect(act({ type: "fortify", from: "a".repeat(65), to: "b", count: 1 })).toBe(false);
    expect(act({ type: "fortify", from: "a", to: "b", count: 1, dice: 2 })).toBe(false);
  });

  it("rejects cardIds with other than 3 entries and malformed ids for tradeCards", () => {
    expect(act({ type: "tradeCards", cardIds: [] })).toBe(false);
    expect(act({ type: "tradeCards", cardIds: ids.slice(0, 2) })).toBe(false);
    expect(act({ type: "tradeCards", cardIds: [...ids, "card-d"] })).toBe(false);
    expect(act({ type: "tradeCards", cardIds: ["a", "", "c"] })).toBe(false);
    expect(act({ type: "tradeCards", cardIds: ["a", "b", "c".repeat(65)] })).toBe(false);
    expect(act({ type: "tradeCards", cardIds: ["a", "b", 3] })).toBe(false);
    expect(act({ type: "tradeCards" })).toBe(false);
    expect(act({ type: "tradeCards", cardIds: ids, bonusTerritoryId: "" })).toBe(false);
    expect(act({ type: "tradeCards", cardIds: ids, bonusTerritoryId: 7 })).toBe(false);
    expect(act({ type: "tradeCards", cardIds: ids, extra: 1 })).toBe(false);
  });

  it("knows every new error code on the wire", () => {
    for (const code of [
      "SAME_TERRITORY",
      "NOT_CONNECTED",
      "MUST_TRADE",
      "INVALID_SET",
      "UNKNOWN_CARD",
      "INVALID_BONUS_TERRITORY",
    ])
      expect(wsErrorCodeSchema.safeParse(code).success, code).toBe(true);
  });

  it("accepts every snapshot example in protocol.md and shows the phase 3 fields in the second", () => {
    const blocks = [...protocolDoc.matchAll(/```json\n([\s\S]*?)```/g)]
      .map((m) => m[1]!)
      .filter((b) => b.includes('"type": "snapshot"'));
    expect(blocks.length).toBeGreaterThanOrEqual(2);
    const games = blocks.map((b) => {
      // A block may carry further one-line messages after the snapshot.
      const parsed = serverMessageSchema.parse(JSON.parse(b.slice(0, b.indexOf("\n}\n") + 2)));
      if (parsed.type !== "snapshot") throw new Error("not a snapshot");
      return parsed.view.game!;
    });
    const g = games[1]!;
    expect(g.secret.mustTrade).toBe(true);
    expect(g.secret.hand).toHaveLength(5);
    expect(g.secret.suggestedSets).toHaveLength(2);
    expect(g.lastTrade!.cards).toHaveLength(3);
    expect(g.deckCount).toBe(1);
    expect(g.territories["eisenfurt"]!.maxMove).toBe(1);
  });

  it("accepts both fortify views and rejects an unknown reach", () => {
    const base = view.game;
    const ok = (fortify: unknown) => gameViewSchema.safeParse({ ...base, fortify }).success;
    expect(ok(null)).toBe(true);
    const moves = { movesDone: 0, movesMax: 1 };
    expect(ok({ reach: "connected", groups: [["a", "b"]], ...moves })).toBe(true);
    expect(ok({ reach: "adjacent", targets: { a: ["b"] }, ...moves })).toBe(true);
    expect(ok({ reach: "teleport", groups: [], ...moves })).toBe(false);
    expect(ok({ reach: "connected", targets: {}, ...moves })).toBe(false);
  });

  it("fortify views carry movesDone and movesMax in both variants (1 and 2)", () => {
    const base = view.game;
    const parse = (fortify: unknown) => gameViewSchema.safeParse({ ...base, fortify });
    for (const reach of [
      { reach: "connected", groups: [] },
      { reach: "adjacent", targets: {} },
    ]) {
      for (const [movesDone, movesMax] of [
        [0, 1],
        [0, 2],
        [1, 2],
      ]) {
        expect(parse({ ...reach, movesDone, movesMax }).success, JSON.stringify(reach)).toBe(true);
      }
      // both fields are required; the setting is 1 or 2 only
      expect(parse({ ...reach }).success).toBe(false);
      expect(parse({ ...reach, movesDone: 0 }).success).toBe(false);
      expect(parse({ ...reach, movesMax: 1 }).success).toBe(false);
      for (const movesMax of [0, 3, "2", null, true])
        expect(parse({ ...reach, movesDone: 0, movesMax }).success, String(movesMax)).toBe(false);
      for (const movesDone of [-1, 1.5, "0", null])
        expect(parse({ ...reach, movesDone, movesMax: 2 }).success, String(movesDone)).toBe(false);
    }
  });

  it("strips deck and discard if they ever slipped into a view", () => {
    const game = {
      ...view.game,
      deck: ["card-x"],
      discard: ["card-y"],
      secret: { ...view.game.secret, deck: ["card-x"], discard: ["card-y"] },
    };
    const wire = JSON.stringify(
      serverMessageSchema.parse({ type: "snapshot", view: { ...view, game } }),
    );
    expect(wire).not.toContain("card-x");
    expect(wire).not.toContain("card-y");
  });
});

describe("protocol", () => {
  it("keeps wire schema and engine types in sync", () => {
    expect(
      viewMatchesEngine && engineErrorsCovered && actionsMatchEngine && hostActionsMatchEngine,
    ).toBe(true);
    for (const code of ["NOT_YOUR_TURN", "WRONG_PHASE"])
      expect(wsErrorCodeSchema.safeParse(code).success).toBe(true);
  });

  it("accepts valid client messages", () => {
    for (const m of [
      { type: "hello", roomId: "K7M2XQ", token: "abc" },
      { type: "start" },
      {
        type: "action",
        reqId: "a1",
        action: { type: "placeArmies", territoryId: "eisenfurt", count: 1 },
      },
      { type: "action", action: { type: "endPhase" } },
    ]) {
      expect(clientMessageSchema.safeParse(m).success, JSON.stringify(m)).toBe(true);
    }
  });

  it("rejects invalid client messages", () => {
    for (const m of [
      {},
      { type: "hello", roomId: "K7M2XQ" },
      { type: "start", extra: 1 },
      { type: "action", action: { type: "placeArmies", territoryId: "x", count: 1.5 } },
      { type: "action", action: { type: "launchMissiles" } },
      { type: "action", action: { type: "endPhase", playerId: "p2" } },
      "hello",
    ]) {
      expect(clientMessageSchema.safeParse(m).success, JSON.stringify(m)).toBe(false);
    }
  });

  it("accepts server messages", () => {
    expect(serverMessageSchema.safeParse({ type: "snapshot", view }).success).toBe(true);
    expect(
      serverMessageSchema.safeParse({ type: "error", code: "NOT_YOUR_TURN", reqId: "a1" }).success,
    ).toBe(true);
    expect(serverMessageSchema.safeParse({ type: "error", code: "NOPE" }).success).toBe(false);
    expect(gameViewSchema.safeParse(view.game).success).toBe(true);
  });

  it("validates names", () => {
    const ok = (name: string) => joinRoomRequestSchema.safeParse({ name }).success;
    expect(ok("Jakob")).toBe(true);
    expect(ok("  Jo  ")).toBe(true);
    expect(ok("")).toBe(false);
    expect(ok("   ")).toBe(false);
    expect(ok("a".repeat(16))).toBe(true);
    expect(ok("a".repeat(17))).toBe(false);
    expect(ok("😀".repeat(16))).toBe(true);
    expect(ok("a\nb")).toBe(false);
    expect(joinRoomRequestSchema.parse({ name: "  Jo " }).name).toBe("Jo");
    expect(createRoomRequestSchema.safeParse({ createCode: "x", hostName: "Jo" }).success).toBe(
      true,
    );
    expect(createRoomRequestSchema.safeParse({ createCode: "x" }).success).toBe(false);
  });

  it("normalizes and formats room ids", () => {
    expect(ROOM_ID_ALPHABET).toHaveLength(31);
    expect(normalizeRoomId("  k7m-2xq ")).toBe("K7M2XQ");
    expect(normalizeRoomId("k7m 2xq")).toBe("K7M2XQ");
    expect(formatRoomId("K7M2XQ")).toBe("K7M-2XQ");
    expect(formatRoomId("bad")).toBe("bad");
    expect(isValidRoomId("K7M2XQ")).toBe(true);
    for (const bad of [
      "K7M2X",
      "K7M2XQQ",
      "K7M2X0",
      "K7M2XI",
      "K7M2XL",
      "K7M2XO",
      "K7M2X1",
      "k7m2xq",
    ]) {
      expect(isValidRoomId(bad), bad).toBe(false);
    }
  });
});

describe("phase 4 protocol: neutral owner, missions, resolution", () => {
  const examples = Object.fromEntries(
    [...protocolDoc.matchAll(/```json\n(\{\s*"example"[\s\S]*?)```/g)]
      .map((m) => JSON.parse(m[1]!) as { example: string; game: Record<string, unknown> })
      .map((b) => [b.example, b.game]),
  );
  const parse = (name: string) => {
    const r = gameViewSchema.safeParse({ ...view.game, ...examples[name] });
    expect(r.success, `${name}: ${JSON.stringify(r.error?.issues)}`).toBe(true);
    return r.data!;
  };

  it("protocol.md has every phase 4 example and the schemas accept them", () => {
    for (const name of [
      "neutral",
      "mission-conquerContinents",
      "mission-holdTerritories",
      "mission-eliminatePlayer",
      "mission-replaced",
      "resolution",
      "resolution-self-target",
    ])
      expect(examples[name], name).toBeDefined();
    const neutral = parse("neutral");
    expect(neutral.territories["rabenhain"]!.ownerId).toBeNull();
    expect(neutral.lastCombat!.defenderId).toBeNull();
    expect(parse("mission-conquerContinents").secret.mission!.type).toBe("conquerContinents");
    expect(parse("mission-holdTerritories").secret.mission!.type).toBe("holdTerritories");
    expect(parse("mission-eliminatePlayer").secret.mission!.type).toBe("eliminatePlayer");
    expect(parse("mission-replaced").secret.missionReplaced).toBe(true);
  });

  it("the resolution shows the original mission only where it was replaced", () => {
    for (const name of ["resolution", "resolution-self-target"]) {
      const g = parse(name);
      expect(g.winReason).toBe("mission");
      const m = g.missions!;
      expect(m["6f1c…"]!.originalMission).toBeNull();
      expect(m["9a2e…"]!.originalMission).toEqual({
        type: "eliminatePlayer",
        targetPlayerId: "9a2e…",
      });
    }
  });

  it("rejects a mission with an unknown type, a missing field or a wrong value type", () => {
    const secret = (mission: unknown) => ({ ...view.game.secret, mission });
    const ok = (mission: unknown) =>
      gameViewSchema.safeParse({ ...view.game, secret: secret(mission) }).success;
    expect(ok({ type: "holdTerritories", count: 3, minArmies: 1 })).toBe(true);
    expect(ok({ type: "conquerAll" })).toBe(false);
    expect(ok({ type: "holdTerritories", count: 3 })).toBe(false);
    expect(ok({ type: "eliminatePlayer", targetPlayerId: 7 })).toBe(false);
    expect(ok({ type: "conquerContinents", continentIds: "nordreich", extraContinents: 0 })).toBe(
      false,
    );
    expect(ok("eliminate everyone")).toBe(false);
  });

  it("rejects bad resolution and win fields", () => {
    const g = (extra: object) => gameViewSchema.safeParse({ ...view.game, ...extra }).success;
    expect(g({ winReason: "timeout" })).toBe(false);
    expect(g({ victoryMode: "chaos" })).toBe(false);
    expect(g({ missions: { p1: { mission: null, originalMission: null } } })).toBe(false);
    expect(
      g({ missions: { p1: { mission: { type: "holdTerritories", count: 1, minArmies: 1 } } } }),
    ).toBe(false);
    expect(g({ winReason: undefined })).toBe(false);
  });

  it("a hand card needs bonusEligible, a public trade card has none", () => {
    const card = { id: "card-eisenfurt", kind: "infantry", territoryId: "eisenfurt" };
    const withHand = (hand: unknown[]) =>
      gameViewSchema.safeParse({ ...view.game, secret: { ...view.game.secret, hand } }).success;
    expect(withHand([{ ...card, bonusEligible: true }])).toBe(true);
    expect(withHand([card])).toBe(false);
    const trade = {
      seq: 1,
      playerId: "p1",
      cards: [card, card, card],
      armies: 4,
      bonusTerritoryId: null,
    };
    expect(gameViewSchema.safeParse({ ...view.game, lastTrade: trade }).success).toBe(true);
    const wire = JSON.stringify(
      serverMessageSchema.parse({
        type: "snapshot",
        view: {
          ...view,
          game: {
            ...view.game,
            lastTrade: { ...trade, cards: [{ ...card, bonusEligible: true }] },
          },
        },
      }),
    );
    expect(wire).not.toContain("bonusEligible");
  });

  it("strips originalMission and stateVersion if they ever slipped into a view", () => {
    const wire = JSON.stringify(
      serverMessageSchema.parse({
        type: "snapshot",
        view: {
          ...view,
          game: {
            ...view.game,
            stateVersion: 4,
            originalMission: { type: "holdTerritories", count: 1, minArmies: 1 },
            secret: {
              ...view.game.secret,
              originalMission: { type: "holdTerritories", count: 1, minArmies: 1 },
            },
          },
        },
      }),
    );
    expect(wire).not.toContain("originalMission");
    expect(wire).not.toContain("stateVersion");
  });

  it("knows STATE_UNSUPPORTED as a wire error", () => {
    expect(wsErrorCodeSchema.safeParse("STATE_UNSUPPORTED").success).toBe(true);
    expect(
      serverMessageSchema.safeParse({ type: "error", code: "STATE_UNSUPPORTED" }).success,
    ).toBe(true);
  });
});

describe("map choice (phase 5)", () => {
  const base = { createCode: "x", hostName: "Jo" };

  it("defaults to the world map, accepts testland and rejects other ids", () => {
    expect(createRoomRequestSchema.parse(base).mapId).toBe("welt");
    expect(createRoomRequestSchema.parse({ ...base, mapId: "testland" }).mapId).toBe("testland");
    expect(createRoomRequestSchema.parse({ ...base, mapId: "welt" }).mapId).toBe("welt");
    expect(createRoomRequestSchema.safeParse({ ...base, mapId: "nirgendwo" }).success).toBe(false);
    expect(createRoomRequestSchema.safeParse({ ...base, mapId: "" }).success).toBe(false);
    expect(createRoomRequestSchema.safeParse({ ...base, extra: 1 }).success).toBe(false);
  });

  it("puts the public mapId into the room view and requires it", () => {
    expect(roomViewSchema.parse(view).mapId).toBe("testland");
    const { mapId: _omitted, ...without } = view;
    expect(roomViewSchema.safeParse(without).success).toBe(false);
    expect(roomViewSchema.safeParse({ ...view, mapId: "nirgendwo" }).success).toBe(false);
  });

  it("documents the map id in the create example and in every snapshot example", () => {
    const create = protocolDoc.match(/```json\n(\{ "createCode"[^\n]*\})\n```/);
    expect(createRoomRequestSchema.parse(JSON.parse(create![1]!)).mapId).toBe("welt");
    const blocks = [...protocolDoc.matchAll(/```json\n([\s\S]*?)```/g)]
      .map((m) => m[1]!)
      .filter((b) => b.includes('"type": "snapshot"'));
    for (const b of blocks) {
      const parsed = serverMessageSchema.parse(JSON.parse(b.slice(0, b.indexOf("\n}\n") + 2)));
      if (parsed.type !== "snapshot") throw new Error("not a snapshot");
      expect(parsed.view.mapId).toBe("testland");
    }
  });
});

describe("host protocol (phase 6a)", () => {
  const blocks = [...protocolDoc.matchAll(/```json\n([\s\S]*?)```/g)].map((m) => m[1]!);
  const snapshots = blocks
    .filter((b) => b.includes('"type": "snapshot"'))
    .map((b) => serverMessageSchema.parse(JSON.parse(b.slice(0, b.indexOf("\n}\n") + 2))));

  it("accepts settings, both host actions and backToLobby", () => {
    for (const m of [
      { type: "settings", mapId: "welt", victoryMode: "domination" },
      { type: "settings", mapId: "testland" },
      { type: "settings", victoryMode: "missions" },
      { type: "settings", fortifyMoves: 1 },
      { type: "settings", fortifyMoves: 2 },
      { type: "settings", mapId: "welt", victoryMode: "domination", fortifyMoves: 2 },
      { type: "settings", mapId: "testland", fortifyMoves: 1 },
      { type: "settings", victoryMode: "missions", fortifyMoves: 2 },
      { type: "host", reqId: "h1", action: { type: "skipTurn", turn: 12 } },
      { type: "host", action: { type: "removePlayer", playerId: "9a2e" } },
      { type: "host", reqId: "t1", action: { type: "transferHost", playerId: "9a2e" } },
      { type: "backToLobby" },
    ]) {
      expect(clientMessageSchema.safeParse(m).success, JSON.stringify(m)).toBe(true);
    }
  });

  it("rejects settings without a field, with an unknown map or mode, and extra fields", () => {
    for (const m of [
      { type: "settings" },
      { type: "settings", mapId: "nirgendwo" },
      { type: "settings", victoryMode: "chaos" },
      { type: "settings", mapId: "welt", extra: 1 },
      { type: "settings", fortifyMoves: 0 },
      { type: "settings", fortifyMoves: 3 },
      { type: "settings", fortifyMoves: "2" },
      { type: "settings", fortifyMoves: true },
      { type: "settings", fortifyMoves: null },
      { type: "settings", fortifyMoves: 1.5 },
      { type: "settings", fortifyMoves: 2, extra: 1 },
      { type: "settings", mapId: "welt", fortifyMoves: 3 },
      { type: "host", action: { type: "skipTurn" } },
      { type: "host", action: { type: "skipTurn", turn: 0 } },
      { type: "host", action: { type: "skipTurn", turn: 1.5 } },
      { type: "host", action: { type: "removePlayer", playerId: "" } },
      { type: "host", action: { type: "removePlayer", playerId: "x".repeat(65) } },
      { type: "host", action: { type: "transferHost" } },
      { type: "host", action: { type: "transferHost", playerId: "" } },
      { type: "host", action: { type: "transferHost", playerId: "p2", extra: 1 } },
      { type: "host", action: { type: "launch" } },
      { type: "host", action: { type: "skipTurn", turn: 1, playerId: "p2" } },
      { type: "host", action: { type: "skipTurn", turn: 1 }, extra: 1 },
      { type: "host" },
      { type: "backToLobby", extra: 1 },
    ]) {
      expect(clientMessageSchema.safeParse(m).success, JSON.stringify(m)).toBe(false);
    }
  });

  it("knows the new error codes and the close code", () => {
    for (const code of [
      "STALE_TURN",
      "UNKNOWN_PLAYER",
      "PLAYER_REMOVED",
      "NOT_FINISHED",
      "CANNOT_REMOVE_SELF",
      "ALREADY_HOST",
      "NOT_PRESENT",
    ]) {
      expect(wsErrorCodeSchema.safeParse(code).success, code).toBe(true);
    }
    expect(WS_CLOSE_REMOVED).toBe(4004);
    for (const code of [
      "STALE_TURN",
      "UNKNOWN_PLAYER",
      "PLAYER_REMOVED",
      "NOT_FINISHED",
      "CANNOT_REMOVE_SELF",
    ]) {
      expect(protocolDoc, code).toContain(`\`${code}\``);
    }
    expect(protocolDoc).toContain("| 4004");
  });

  it("the doc has a snapshot with a removed player and a lobby snapshot after the return (gameNo 2)", () => {
    const removed = snapshots.find(
      (m) => m.type === "snapshot" && m.view.game?.removedPlayerIds.length,
    )!;
    if (removed.type !== "snapshot") throw new Error("not a snapshot");
    expect(removed.view.players.find((p) => p.removed)!.name).toBe("Cleo");
    expect(removed.view.game!.removedPlayerIds).toEqual(["4d7b…"]);
    expect(removed.view.game!.territories["kupferstadt"]!.ownerId).toBeNull();
    const lobby = snapshots.find((m) => m.type === "snapshot" && m.view.gameNo === 2)!;
    if (lobby.type !== "snapshot") throw new Error("not a snapshot");
    expect(lobby.view.status).toBe("lobby");
    expect(lobby.view.game).toBeNull();
    expect(lobby.view.players.every((p) => !p.removed)).toBe(true);
    expect(lobby.view.victoryMode).toBe("domination");
  });

  it("accepts publicUrl as a string or null and requires the field", () => {
    expect(roomViewSchema.safeParse({ ...view, publicUrl: "http://192.0.2.10:3000" }).success).toBe(
      true,
    );
    expect(roomViewSchema.safeParse({ ...view, publicUrl: null }).success).toBe(true);
    expect(roomViewSchema.safeParse({ ...view, publicUrl: 3000 }).success).toBe(false);
    const { publicUrl: _p, ...noUrl } = view;
    expect(roomViewSchema.safeParse(noUrl).success).toBe(false);
  });

  it("the doc has a lobby snapshot with the public address and playing snapshots with null", () => {
    const lobby = snapshots.find((m) => m.type === "snapshot" && m.view.status === "lobby")!;
    if (lobby.type !== "snapshot") throw new Error("not a snapshot");
    expect(lobby.view.publicUrl).toBe("http://192.0.2.10:3000");
    const playing = snapshots.filter((m) => m.type === "snapshot" && m.view.status === "playing");
    expect(playing.length).toBeGreaterThan(0);
    for (const m of playing) if (m.type === "snapshot") expect(m.view.publicUrl).toBeNull();
  });

  it("requires fortifyMoves (1 or 2) in the room view", () => {
    expect(roomViewSchema.safeParse({ ...view, fortifyMoves: 2 }).success).toBe(true);
    const { fortifyMoves: _f, ...noMoves } = view;
    expect(roomViewSchema.safeParse(noMoves).success).toBe(false);
    for (const bad of [0, 3, "2", null, true])
      expect(roomViewSchema.safeParse({ ...view, fortifyMoves: bad }).success).toBe(false);
  });

  it("requires removed, victoryMode and gameNo in the room view", () => {
    expect(roomViewSchema.safeParse(view).success).toBe(true);
    const { victoryMode: _a, ...noMode } = view;
    const { gameNo: _b, ...noNo } = view;
    expect(roomViewSchema.safeParse(noMode).success).toBe(false);
    expect(roomViewSchema.safeParse(noNo).success).toBe(false);
    expect(roomViewSchema.safeParse({ ...view, gameNo: 0 }).success).toBe(false);
    expect(roomViewSchema.safeParse({ ...view, victoryMode: "x" }).success).toBe(false);
    const { removed: _c, ...rowNoRemoved } = view.players[0]!;
    expect(roomViewSchema.safeParse({ ...view, players: [rowNoRemoved] }).success).toBe(false);
  });

  it("strips tokens and hashes if they ever slipped into a player row", () => {
    const wire = JSON.stringify(
      serverMessageSchema.parse({
        type: "snapshot",
        view: { ...view, players: [{ ...view.players[0]!, tokenHash: "abc", lastActivityAt: 5 }] },
      }),
    );
    expect(wire).not.toContain("tokenHash");
    expect(wire).not.toContain("lastActivityAt");
  });
});
