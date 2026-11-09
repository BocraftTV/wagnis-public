import type { FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import {
  applyAction,
  applyHostAction,
  createGame,
  getMap,
  getMissionSet,
  getRules,
  TEAM_IDS,
  teamSizes,
} from "@wagnis/engine";
import type { Rng, RoundLimit, TeamId, TeamMode } from "@wagnis/engine";
import {
  MAX_PLAYERS,
  WS_CLOSE_HELLO_FAILED,
  WS_CLOSE_RATE_LIMITED,
  WS_CLOSE_REMOVED,
  clientMessageSchema,
  normalizeRoomId,
} from "@wagnis/shared";
import type { HostActionMessage, MapId, WsErrorCode } from "@wagnis/shared";
import type { WebSocket } from "ws";
import { hashToken } from "./crypto.js";
import { secretsEqual } from "./crypto.js";
import { Hub, send } from "./hub.js";
import type { Conn } from "./hub.js";
import { clientIp } from "./ip.js";
import type { FailureLimiter } from "./rate-limit.js";
import { loadState, logRejectedState } from "./state.js";
import type { PlayerRow, Store } from "./store.js";

export interface WsDeps {
  store: Store;
  hub: Hub;
  rng: Rng;
  now: () => number;
  joinLimiter: FailureLimiter;
  trustProxyHeader: string | undefined;
  helloTimeoutMs: number;
  heartbeatIntervalMs: number;
}

const MAX_MISSED_PONGS = 2;

export async function registerWebSocket(app: FastifyInstance, deps: WsDeps): Promise<void> {
  const { store, hub, rng, now, joinLimiter } = deps;
  await app.register(websocket, { options: { maxPayload: 16 * 1024 } });

  const heartbeat = setInterval(() => {
    for (const conn of hub.all()) {
      if (conn.missedPongs >= MAX_MISSED_PONGS) {
        conn.socket.terminate();
      } else {
        conn.missedPongs += 1;
        conn.socket.ping();
      }
    }
  }, deps.heartbeatIntervalMs);
  heartbeat.unref();
  app.addHook("onClose", async () => {
    clearInterval(heartbeat);
  });

  const fail = (socket: WebSocket, code: WsErrorCode, reqId?: string) =>
    send(socket, reqId === undefined ? { type: "error", code } : { type: "error", code, reqId });

  /** Authenticates a hello message. Returns the player id or undefined. */
  function authenticate(roomId: string, token: string): string | undefined {
    const players = store.getPlayers(normalizeRoomId(roomId));
    const hash = hashToken(token);
    let found: string | undefined;
    // A removed player cannot authenticate: skipped here, and their stored hash is empty anyway
    for (const p of players) if (!p.removed && secretsEqual(p.tokenHash, hash)) found = p.id;
    return found;
  }

  /** Records activity for the cleanup; never lets a closing database break a socket handler. */
  function touch(roomId: string): void {
    if (hub.isClosed()) return;
    try {
      store.touchRoom(roomId, now());
    } catch {
      // the room or the database is gone: nothing to record
    }
  }

  /**
   * Host check for every host message: the row of the sender (the authenticated connection, never a value from the
   * message) is read fresh from the store.
   */
  function hostContext(conn: Conn, reqId?: string) {
    const room = store.getRoom(conn.roomId);
    const players = store.getPlayers(conn.roomId);
    if (!room) return void fail(conn.socket, "INTERNAL", reqId);
    const me = players.find((p) => p.id === conn.playerId);
    if (!me || me.removed || !me.isHost) return void fail(conn.socket, "NOT_HOST", reqId);
    return { room, players };
  }

  function handleStart(conn: Conn): void {
    const ctx = hostContext(conn);
    if (!ctx) return;
    const { room, players } = ctx;
    if (room.status !== "lobby") return fail(conn.socket, "NOT_IN_LOBBY");
    if (players.length < 2 || players.length > MAX_PLAYERS)
      return fail(conn.socket, "NOT_ENOUGH_PLAYERS");
    // Map, rule values and mission list of the room's map; all three are registered together.
    const map = getMap(room.mapId);
    const baseRules = map && getRules(map.id);
    const rules = baseRules && {
      ...baseRules,
      victoryMode: room.victoryMode,
      fortifyMoves: room.fortifyMoves,
      missionDraft: room.missionDraft,
      holdToWin: room.holdToWin,
      roundLimit: room.roundLimit,
      worldEvents: room.worldEvents,
      teams: room.teams,
    };
    // Teams (plan 014 C): the assignment of the lobby; the engine checks that it fits the layout.
    const teams = room.teams ? teamsOf(players) : undefined;
    const missions = map && getMissionSet(map.id);
    if (!map || !rules || !missions) return fail(conn.socket, "INTERNAL");
    const result = createGame({
      map,
      rules,
      playerIds: players.map((p) => p.id),
      rng,
      // The mission list of the map (the mode is the room's choice, set in the rules above)
      missions,
      teams,
    });
    if (!result.ok) {
      return fail(conn.socket, result.code === "INVALID_TEAMS" ? "INVALID_TEAMS" : "START_FAILED");
    }
    store.saveGame(conn.roomId, "playing", result.state, now());
    hub.broadcast(conn.roomId);
  }

  function handleSettings(
    conn: Conn,
    patch: {
      mapId?: MapId | undefined;
      victoryMode?: "missions" | "domination" | undefined;
      fortifyMoves?: 1 | 2 | undefined;
      missionDraft?: boolean | undefined;
      holdToWin?: boolean | undefined;
      roundLimit?: RoundLimit | undefined;
      worldEvents?: boolean | undefined;
      teams?: TeamMode | undefined;
    },
  ): void {
    const ctx = hostContext(conn);
    if (!ctx) return;
    if (ctx.room.status !== "lobby") return fail(conn.socket, "NOT_IN_LOBBY");
    if (!store.setSettings(conn.roomId, patch, now())) return fail(conn.socket, "NOT_IN_LOBBY");
    hub.broadcast(conn.roomId);
  }

  /** The lobby assignment as the engine wants it: team letter to the players in seat order. */
  function teamsOf(players: PlayerRow[]): Record<TeamId, string[]> {
    const out: Record<TeamId, string[]> = { A: [], B: [], C: [] };
    for (const p of players) if (p.team) out[p.team].push(p.id);
    // An unused team stays out, so a 2v2 layout does not see an empty third team as "too many"
    return Object.fromEntries(Object.entries(out).filter(([, ids]) => ids.length > 0)) as Record<
      TeamId,
      string[]
    >;
  }

  /** `team`: the host puts one player into a team or takes them out (lobby only). */
  function handleTeam(conn: Conn, playerId: string, team: TeamId | null): void {
    const ctx = hostContext(conn);
    if (!ctx) return;
    if (ctx.room.status !== "lobby") return fail(conn.socket, "NOT_IN_LOBBY");
    const sizes = teamSizes(ctx.room.teams);
    // A team letter must exist in the chosen layout; without a layout there is nothing to assign
    if (!sizes || (team !== null && TEAM_IDS.indexOf(team) >= sizes.length))
      return fail(conn.socket, "INVALID_TEAMS");
    if (!store.setPlayerTeam(conn.roomId, playerId, team, now()))
      return fail(conn.socket, "UNKNOWN_PLAYER");
    hub.broadcast(conn.roomId);
  }

  /** `randomTeams`: everybody into a team at random, in the sizes of the layout (lobby only). */
  function handleRandomTeams(conn: Conn): void {
    const ctx = hostContext(conn);
    if (!ctx) return;
    if (ctx.room.status !== "lobby") return fail(conn.socket, "NOT_IN_LOBBY");
    const sizes = teamSizes(ctx.room.teams);
    const ids = ctx.players.map((p) => p.id);
    if (!sizes || ids.length !== sizes.reduce((a, b) => a + b, 0))
      return fail(conn.socket, "INVALID_TEAMS");
    // Fisher-Yates over the injected Rng
    for (let i = ids.length - 1; i > 0; i--) {
      const j = rng.int(i + 1);
      [ids[i], ids[j]] = [ids[j]!, ids[i]!];
    }
    const assignment: Record<string, TeamId> = {};
    let at = 0;
    sizes.forEach((size, t) => {
      for (const id of ids.slice(at, at + size)) assignment[id] = TEAM_IDS[t]!;
      at += size;
    });
    store.setTeams(conn.roomId, assignment, now());
    hub.broadcast(conn.roomId);
  }

  function handleHost(conn: Conn, action: HostActionMessage, reqId?: string): void {
    const ctx = hostContext(conn, reqId);
    if (!ctx) return;
    const { room, players } = ctx;
    if (action.type === "transferHost") {
      // A room matter, any room status (question 33): the role moves, the game state is not touched.
      const target = players.find((p) => p.id === action.playerId);
      if (!target) return fail(conn.socket, "UNKNOWN_PLAYER", reqId);
      if (target.removed) return fail(conn.socket, "PLAYER_REMOVED", reqId);
      if (target.isHost) return fail(conn.socket, "ALREADY_HOST", reqId);
      // "Present" means connected right now (question 32)
      if (!hub.isConnected(conn.roomId, target.id)) return fail(conn.socket, "NOT_PRESENT", reqId);
      const done = store.transferHost(conn.roomId, conn.playerId, target.id, now());
      if (done !== "OK") return fail(conn.socket, done, reqId);
      hub.broadcast(conn.roomId);
      return;
    }
    if (action.type === "removePlayer" && room.status === "lobby") {
      // Lobby: no game state, the row is deleted and the seat and name become free
      if (!players.some((p) => p.id === action.playerId))
        return fail(conn.socket, "UNKNOWN_PLAYER", reqId);
      if (action.playerId === conn.playerId) return fail(conn.socket, "CANNOT_REMOVE_SELF", reqId);
      if (!store.removeLobbyPlayer(conn.roomId, action.playerId, now()))
        return fail(conn.socket, "INTERNAL", reqId);
      hub.disconnectPlayer(conn.roomId, action.playerId, WS_CLOSE_REMOVED);
      hub.broadcast(conn.roomId);
      return;
    }
    if (room.status !== "playing" || !room.stateJson)
      return fail(conn.socket, "NOT_IN_GAME", reqId);
    if (action.type === "removePlayer") {
      const target = players.find((p) => p.id === action.playerId);
      if (!target) return fail(conn.socket, "UNKNOWN_PLAYER", reqId);
      if (target.id === conn.playerId) return fail(conn.socket, "CANNOT_REMOVE_SELF", reqId);
      if (target.removed) return fail(conn.socket, "PLAYER_REMOVED", reqId);
    }
    const loaded = loadState(store, room, rng);
    if (!loaded.ok) {
      logRejectedState(app.log, loaded);
      return fail(conn.socket, "STATE_UNSUPPORTED", reqId);
    }
    if (!loaded.state) return fail(conn.socket, "NOT_IN_GAME", reqId);
    const result = applyHostAction(loaded.state, action, rng);
    if (!result.ok) return fail(conn.socket, result.code, reqId);
    const status = result.state.winnerId === null ? "playing" : "finished";
    if (action.type === "removePlayer") {
      // State and the `removed` row are written together; then the connection of the removed player ends
      store.removeGamePlayer(conn.roomId, action.playerId, status, result.state, now());
      hub.disconnectPlayer(conn.roomId, action.playerId, WS_CLOSE_REMOVED);
    } else {
      store.saveGame(conn.roomId, status, result.state, now());
    }
    hub.broadcast(conn.roomId);
  }

  function handleBackToLobby(conn: Conn): void {
    const ctx = hostContext(conn);
    if (!ctx) return;
    if (ctx.room.status !== "finished") return fail(conn.socket, "NOT_FINISHED");
    // A state this server cannot read (newer version) is never thrown away
    const loaded = loadState(store, ctx.room, rng);
    if (!loaded.ok) {
      logRejectedState(app.log, loaded);
      return fail(conn.socket, "STATE_UNSUPPORTED");
    }
    if (!store.resetToLobby(conn.roomId, now())) return fail(conn.socket, "NOT_FINISHED");
    hub.broadcast(conn.roomId);
  }

  function handleAction(
    conn: Conn,
    action: Parameters<typeof applyAction>[2],
    reqId?: string,
  ): void {
    const room = store.getRoom(conn.roomId);
    if (!room) return fail(conn.socket, "INTERNAL", reqId);
    if (room.status !== "playing" || !room.stateJson)
      return fail(conn.socket, "NOT_IN_GAME", reqId);
    const loaded = loadState(store, room, rng);
    if (!loaded.ok) {
      logRejectedState(app.log, loaded);
      return fail(conn.socket, "STATE_UNSUPPORTED", reqId);
    }
    const state = loaded.state;
    if (!state) return fail(conn.socket, "NOT_IN_GAME", reqId);
    const result = applyAction(state, conn.playerId, action, rng);
    if (!result.ok) return fail(conn.socket, result.code, reqId);
    // One accepted action (a blitz included) is one write and one broadcast; a win ends the game.
    store.saveGame(
      conn.roomId,
      result.state.winnerId === null ? "playing" : "finished",
      result.state,
      now(),
    );
    hub.broadcast(conn.roomId);
  }

  app.get("/ws", { websocket: true }, (socket, request) => {
    const ip = clientIp(request.headers, request.ip, deps.trustProxyHeader);
    let conn: Conn | undefined;

    const rejectHello = (): void => {
      joinLimiter.recordFailure(ip);
      fail(socket, "NOT_AUTHENTICATED");
      socket.close(WS_CLOSE_HELLO_FAILED);
    };

    if (joinLimiter.isBlocked(ip)) {
      fail(socket, "RATE_LIMITED");
      socket.close(WS_CLOSE_RATE_LIMITED);
      return;
    }

    const helloTimer = setTimeout(() => {
      if (!conn) rejectHello();
    }, deps.helloTimeoutMs);

    socket.on("pong", () => {
      if (conn) conn.missedPongs = 0;
    });

    const onMessage = (data: Buffer, isBinary: boolean): void => {
      let json: unknown;
      try {
        json = isBinary ? undefined : JSON.parse(data.toString());
      } catch {
        json = undefined;
      }
      const parsed = clientMessageSchema.safeParse(json);

      if (!conn) {
        if (!parsed.success || parsed.data.type !== "hello") return rejectHello();
        const roomId = normalizeRoomId(parsed.data.roomId);
        const playerId = authenticate(roomId, parsed.data.token);
        if (playerId === undefined) return rejectHello();
        clearTimeout(helloTimer);
        conn = { socket, roomId, playerId, missedPongs: 0 };
        hub.register(conn);
        touch(roomId); // a connection counts as activity (the idle clock restarts when it ends)
        hub.broadcast(roomId); // snapshot for this player, presence update for the others
        return;
      }

      if (!parsed.success) return fail(socket, "BAD_MESSAGE");
      const msg = parsed.data;
      switch (msg.type) {
        case "hello":
          return fail(socket, "BAD_MESSAGE");
        case "start":
          return handleStart(conn);
        case "action":
          return handleAction(conn, msg.action, msg.reqId);
        case "settings":
          return handleSettings(conn, {
            mapId: msg.mapId,
            victoryMode: msg.victoryMode,
            fortifyMoves: msg.fortifyMoves,
            missionDraft: msg.missionDraft,
            holdToWin: msg.holdToWin,
            roundLimit: msg.roundLimit,
            worldEvents: msg.worldEvents,
            teams: msg.teams,
          });
        case "team":
          return handleTeam(conn, msg.playerId, msg.team);
        case "randomTeams":
          return handleRandomTeams(conn);
        case "host":
          return handleHost(conn, msg.action, msg.reqId);
        case "backToLobby":
          return handleBackToLobby(conn);
      }
    };

    socket.on("message", (data: Buffer, isBinary: boolean) => {
      try {
        onMessage(data, isBinary);
      } catch (err) {
        // Never let a handler error escape into the process; log identifiers only, no message text.
        app.log.error({ name: (err as Error).name }, "websocket handler error");
        fail(socket, "INTERNAL");
      }
    });

    socket.on("close", () => {
      clearTimeout(helloTimer);
      if (conn && hub.unregister(conn)) {
        touch(conn.roomId);
        hub.broadcast(conn.roomId);
      }
    });
    socket.on("error", () => socket.terminate());
  });
}
