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
import type { Action, GameState, Rng, TeamId } from "@wagnis/engine";
import {
  MAX_PLAYERS,
  WS_CLOSE_HELLO_FAILED,
  WS_CLOSE_RATE_LIMITED,
  WS_CLOSE_REMOVED,
  clientMessageSchema,
  normalizeRoomId,
} from "@wagnis/shared";
import type { ClientMessage, HostActionMessage, WsErrorCode } from "@wagnis/shared";
import type { WebSocket } from "ws";
import { hashToken } from "./crypto.js";
import { secretsEqual } from "./crypto.js";
import { Hub, send } from "./hub.js";
import type { Conn } from "./hub.js";
import { clientIp } from "./ip.js";
import type { FailureLimiter } from "./rate-limit.js";
import { loadState, logRejectedState } from "./state.js";
import type { StateLog } from "./state.js";
import { pickRuleSettings } from "./store.js";
import type { LobbySettings, PlayerRow, RoomRow, Store } from "./store.js";

/** The `settings` message: only the given fields change. */
type SettingsPatch = { [K in keyof LobbySettings]?: LobbySettings[K] | undefined };

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

/** What every handler needs; `log` is the app logger (codes and version numbers only). */
interface WsContext {
  store: Store;
  hub: Hub;
  rng: Rng;
  now: () => number;
  log: StateLog;
}

const fail = (socket: WebSocket, code: WsErrorCode, reqId?: string) =>
  send(socket, reqId === undefined ? { type: "error", code } : { type: "error", code, reqId });

/** The room status that goes with a game state: a winner ends the game. */
const statusOf = (state: GameState): "playing" | "finished" =>
  state.winnerId === null ? "playing" : "finished";

/** Authenticates a hello message. Returns the player id or undefined. */
function authenticate(store: Store, roomId: string, token: string): string | undefined {
  const players = store.getPlayers(normalizeRoomId(roomId));
  const hash = hashToken(token);
  let found: string | undefined;
  // A removed player cannot authenticate: skipped here, and their stored hash is empty anyway
  for (const p of players) if (!p.removed && secretsEqual(p.tokenHash, hash)) found = p.id;
  return found;
}

/** Records activity for the cleanup; never lets a closing database break a socket handler. */
function touch(ctx: WsContext, roomId: string): void {
  if (ctx.hub.isClosed()) return;
  try {
    ctx.store.touchRoom(roomId, ctx.now());
  } catch {
    // the room or the database is gone: nothing to record
  }
}

/**
 * Host check for every host message: the row of the sender (the authenticated connection, never a value from the
 * message) is read fresh from the store. Answers the error itself and returns undefined.
 */
function hostContext(ctx: WsContext, conn: Conn, reqId?: string) {
  const room = ctx.store.getRoom(conn.roomId);
  const players = ctx.store.getPlayers(conn.roomId);
  if (!room) return void fail(conn.socket, "INTERNAL", reqId);
  const me = players.find((p) => p.id === conn.playerId);
  if (!me || me.removed || !me.isHost) return void fail(conn.socket, "NOT_HOST", reqId);
  return { room, players };
}

/** The host check, and the room must be in the lobby. */
function lobbyHostContext(ctx: WsContext, conn: Conn) {
  const host = hostContext(ctx, conn);
  if (!host) return undefined;
  if (host.room.status !== "lobby") return void fail(conn.socket, "NOT_IN_LOBBY");
  return host;
}

/**
 * Loads the room's game state; a state this server cannot read is logged and answered with STATE_UNSUPPORTED (and
 * never thrown away). Returns undefined when it has answered.
 */
function loadGame(
  ctx: WsContext,
  conn: Conn,
  room: RoomRow,
  reqId?: string,
): { state: GameState | null } | undefined {
  const loaded = loadState(ctx.store, room, ctx.rng);
  if (loaded.ok) return { state: loaded.state };
  logRejectedState(ctx.log, loaded);
  return void fail(conn.socket, "STATE_UNSUPPORTED", reqId);
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

function handleStart(ctx: WsContext, conn: Conn): void {
  const host = lobbyHostContext(ctx, conn);
  if (!host) return;
  const { room, players } = host;
  if (players.length < 2 || players.length > MAX_PLAYERS)
    return fail(conn.socket, "NOT_ENOUGH_PLAYERS");
  // Map, rule values and mission list of the room's map; all three are registered together.
  const map = getMap(room.mapId);
  const baseRules = map && getRules(map.id);
  const rules = baseRules && { ...baseRules, ...pickRuleSettings(room) };
  // Teams (plan 014 C): the assignment of the lobby; the engine checks that it fits the layout.
  const teams = room.teams ? teamsOf(players) : undefined;
  const missions = map && getMissionSet(map.id);
  if (!map || !rules || !missions) return fail(conn.socket, "INTERNAL");
  const result = createGame({
    map,
    rules,
    playerIds: players.map((p) => p.id),
    rng: ctx.rng,
    // The mission list of the map (the mode is the room's choice, set in the rules above)
    missions,
    teams,
  });
  if (!result.ok) {
    return fail(conn.socket, result.code === "INVALID_TEAMS" ? "INVALID_TEAMS" : "START_FAILED");
  }
  ctx.store.saveGame(conn.roomId, "playing", result.state, ctx.now());
  ctx.hub.broadcast(conn.roomId);
}

function handleSettings(ctx: WsContext, conn: Conn, patch: SettingsPatch): void {
  if (!lobbyHostContext(ctx, conn)) return;
  if (!ctx.store.setSettings(conn.roomId, patch, ctx.now()))
    return fail(conn.socket, "NOT_IN_LOBBY");
  ctx.hub.broadcast(conn.roomId);
}

/** `team`: the host puts one player into a team or takes them out (lobby only). */
function handleTeam(ctx: WsContext, conn: Conn, playerId: string, team: TeamId | null): void {
  const host = lobbyHostContext(ctx, conn);
  if (!host) return;
  const sizes = teamSizes(host.room.teams);
  // A team letter must exist in the chosen layout; without a layout there is nothing to assign
  if (!sizes || (team !== null && TEAM_IDS.indexOf(team) >= sizes.length))
    return fail(conn.socket, "INVALID_TEAMS");
  if (!ctx.store.setPlayerTeam(conn.roomId, playerId, team, ctx.now()))
    return fail(conn.socket, "UNKNOWN_PLAYER");
  ctx.hub.broadcast(conn.roomId);
}

/** `randomTeams`: everybody into a team at random, in the sizes of the layout (lobby only). */
function handleRandomTeams(ctx: WsContext, conn: Conn): void {
  const host = lobbyHostContext(ctx, conn);
  if (!host) return;
  const sizes = teamSizes(host.room.teams);
  const ids = host.players.map((p) => p.id);
  if (!sizes || ids.length !== sizes.reduce((a, b) => a + b, 0))
    return fail(conn.socket, "INVALID_TEAMS");
  // Fisher-Yates over the injected Rng
  for (let i = ids.length - 1; i > 0; i--) {
    const j = ctx.rng.int(i + 1);
    [ids[i], ids[j]] = [ids[j]!, ids[i]!];
  }
  const assignment: Record<string, TeamId> = {};
  let at = 0;
  sizes.forEach((size, t) => {
    for (const id of ids.slice(at, at + size)) assignment[id] = TEAM_IDS[t]!;
    at += size;
  });
  ctx.store.setTeams(conn.roomId, assignment, ctx.now());
  ctx.hub.broadcast(conn.roomId);
}

/** `transferHost`: a room matter, any room status (question 33): the role moves, the game state is not touched. */
function transferHost(
  ctx: WsContext,
  conn: Conn,
  players: PlayerRow[],
  playerId: string,
  reqId?: string,
): void {
  const target = players.find((p) => p.id === playerId);
  if (!target) return fail(conn.socket, "UNKNOWN_PLAYER", reqId);
  if (target.removed) return fail(conn.socket, "PLAYER_REMOVED", reqId);
  if (target.isHost) return fail(conn.socket, "ALREADY_HOST", reqId);
  // "Present" means connected right now (question 32)
  if (!ctx.hub.isConnected(conn.roomId, target.id)) return fail(conn.socket, "NOT_PRESENT", reqId);
  const done = ctx.store.transferHost(conn.roomId, conn.playerId, target.id, ctx.now());
  if (done !== "OK") return fail(conn.socket, done, reqId);
  ctx.hub.broadcast(conn.roomId);
}

/** `removePlayer` in the lobby: no game state, the row is deleted and the seat and name become free. */
function removeLobbyPlayer(
  ctx: WsContext,
  conn: Conn,
  players: PlayerRow[],
  playerId: string,
  reqId?: string,
): void {
  if (!players.some((p) => p.id === playerId)) return fail(conn.socket, "UNKNOWN_PLAYER", reqId);
  if (playerId === conn.playerId) return fail(conn.socket, "CANNOT_REMOVE_SELF", reqId);
  if (!ctx.store.removeLobbyPlayer(conn.roomId, playerId, ctx.now()))
    return fail(conn.socket, "INTERNAL", reqId);
  ctx.hub.disconnectPlayer(conn.roomId, playerId, WS_CLOSE_REMOVED);
  ctx.hub.broadcast(conn.roomId);
}

function handleHost(ctx: WsContext, conn: Conn, action: HostActionMessage, reqId?: string): void {
  const host = hostContext(ctx, conn, reqId);
  if (!host) return;
  const { room, players } = host;
  if (action.type === "transferHost")
    return transferHost(ctx, conn, players, action.playerId, reqId);
  if (action.type === "removePlayer" && room.status === "lobby")
    return removeLobbyPlayer(ctx, conn, players, action.playerId, reqId);
  if (room.status !== "playing" || !room.stateJson) return fail(conn.socket, "NOT_IN_GAME", reqId);
  if (action.type === "removePlayer") {
    const target = players.find((p) => p.id === action.playerId);
    if (!target) return fail(conn.socket, "UNKNOWN_PLAYER", reqId);
    if (target.id === conn.playerId) return fail(conn.socket, "CANNOT_REMOVE_SELF", reqId);
    if (target.removed) return fail(conn.socket, "PLAYER_REMOVED", reqId);
  }
  const loaded = loadGame(ctx, conn, room, reqId);
  if (!loaded) return;
  if (!loaded.state) return fail(conn.socket, "NOT_IN_GAME", reqId);
  const result = applyHostAction(loaded.state, action, ctx.rng);
  if (!result.ok) return fail(conn.socket, result.code, reqId);
  const status = statusOf(result.state);
  if (action.type === "removePlayer") {
    // State and the `removed` row are written together; then the connection of the removed player ends
    ctx.store.removeGamePlayer(conn.roomId, action.playerId, status, result.state, ctx.now());
    ctx.hub.disconnectPlayer(conn.roomId, action.playerId, WS_CLOSE_REMOVED);
  } else {
    ctx.store.saveGame(conn.roomId, status, result.state, ctx.now());
  }
  ctx.hub.broadcast(conn.roomId);
}

function handleBackToLobby(ctx: WsContext, conn: Conn): void {
  const host = hostContext(ctx, conn);
  if (!host) return;
  if (host.room.status !== "finished") return fail(conn.socket, "NOT_FINISHED");
  // A state this server cannot read (newer version) is never thrown away
  if (!loadGame(ctx, conn, host.room)) return;
  if (!ctx.store.resetToLobby(conn.roomId, ctx.now())) return fail(conn.socket, "NOT_FINISHED");
  ctx.hub.broadcast(conn.roomId);
}

function handleAction(ctx: WsContext, conn: Conn, action: Action, reqId?: string): void {
  const room = ctx.store.getRoom(conn.roomId);
  if (!room) return fail(conn.socket, "INTERNAL", reqId);
  if (room.status !== "playing" || !room.stateJson) return fail(conn.socket, "NOT_IN_GAME", reqId);
  const loaded = loadGame(ctx, conn, room, reqId);
  if (!loaded) return;
  if (!loaded.state) return fail(conn.socket, "NOT_IN_GAME", reqId);
  const result = applyAction(loaded.state, conn.playerId, action, ctx.rng);
  if (!result.ok) return fail(conn.socket, result.code, reqId);
  // One accepted action (a blitz included) is one write and one broadcast; a win ends the game.
  ctx.store.saveGame(conn.roomId, statusOf(result.state), result.state, ctx.now());
  ctx.hub.broadcast(conn.roomId);
}

/** A message of an authenticated connection. */
function dispatch(ctx: WsContext, conn: Conn, msg: ClientMessage): void {
  switch (msg.type) {
    case "hello":
      return fail(conn.socket, "BAD_MESSAGE");
    case "start":
      return handleStart(ctx, conn);
    case "action":
      return handleAction(ctx, conn, msg.action, msg.reqId);
    case "settings":
      return handleSettings(ctx, conn, {
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
      return handleTeam(ctx, conn, msg.playerId, msg.team);
    case "randomTeams":
      return handleRandomTeams(ctx, conn);
    case "host":
      return handleHost(ctx, conn, msg.action, msg.reqId);
    case "backToLobby":
      return handleBackToLobby(ctx, conn);
  }
}

/** Pings every connection; one that missed two pongs in a row is cut off. */
function startHeartbeat(app: FastifyInstance, hub: Hub, intervalMs: number): void {
  const heartbeat = setInterval(() => {
    for (const conn of hub.all()) {
      if (conn.missedPongs >= MAX_MISSED_PONGS) {
        conn.socket.terminate();
      } else {
        conn.missedPongs += 1;
        conn.socket.ping();
      }
    }
  }, intervalMs);
  heartbeat.unref();
  app.addHook("onClose", async () => {
    clearInterval(heartbeat);
  });
}

export async function registerWebSocket(app: FastifyInstance, deps: WsDeps): Promise<void> {
  const { store, hub, joinLimiter } = deps;
  const ctx: WsContext = { store, hub, rng: deps.rng, now: deps.now, log: app.log };
  await app.register(websocket, { options: { maxPayload: 16 * 1024 } });
  startHeartbeat(app, hub, deps.heartbeatIntervalMs);

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
        const playerId = authenticate(store, roomId, parsed.data.token);
        if (playerId === undefined) return rejectHello();
        clearTimeout(helloTimer);
        conn = { socket, roomId, playerId, missedPongs: 0 };
        hub.register(conn);
        touch(ctx, roomId); // a connection counts as activity (the idle clock restarts when it ends)
        hub.broadcast(roomId); // snapshot for this player, presence update for the others
        return;
      }

      if (!parsed.success) return fail(socket, "BAD_MESSAGE");
      dispatch(ctx, conn, parsed.data);
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
        touch(ctx, conn.roomId);
        hub.broadcast(conn.roomId);
      }
    });
    socket.on("error", () => socket.terminate());
  });
}
