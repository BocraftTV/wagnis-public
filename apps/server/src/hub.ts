import type { WebSocket } from "ws";
import { teamOf, viewFor } from "@wagnis/engine";
import { serverMessageSchema, WS_CLOSE_REPLACED } from "@wagnis/shared";
import type { MapId, RoomView, ServerMessage } from "@wagnis/shared";
import { loadState, logRejectedState } from "./state.js";
import type { StateLog } from "./state.js";
import type { Store } from "./store.js";

export interface Conn {
  socket: WebSocket;
  roomId: string;
  playerId: string;
  missedPongs: number;
}

/** Sends a message; every outgoing message passes through the wire schema (strips unknown fields). */
export function send(socket: WebSocket, message: ServerMessage): void {
  if (socket.readyState !== socket.OPEN) return;
  socket.send(JSON.stringify(serverMessageSchema.parse(message)));
}

/** Tracks live connections per room and builds per-player snapshots. */
export class Hub {
  private readonly rooms = new Map<string, Map<string, Conn>>();

  private closed = false;

  constructor(
    private readonly store: Store,
    private readonly log?: StateLog,
    /** Origin for the lobby QR code (`WAGNIS_PUBLIC_URL`, already normalised); public, no token. */
    private readonly publicUrl?: string,
  ) {}

  /** Stops all outgoing traffic; called before the database closes. */
  shutdown(): void {
    this.closed = true;
  }

  /** Registers a connection; a previous one for the same identity is replaced and closed. */
  register(conn: Conn): void {
    let room = this.rooms.get(conn.roomId);
    if (!room) this.rooms.set(conn.roomId, (room = new Map()));
    const old = room.get(conn.playerId);
    room.set(conn.playerId, conn);
    if (old && old !== conn) old.socket.close(WS_CLOSE_REPLACED);
  }

  /** Removes the connection if it is still the current one. Returns whether presence changed. */
  unregister(conn: Conn): boolean {
    const room = this.rooms.get(conn.roomId);
    if (!room || room.get(conn.playerId) !== conn) return false;
    room.delete(conn.playerId);
    if (room.size === 0) this.rooms.delete(conn.roomId);
    return true;
  }

  /** Ids of the rooms with at least one connection. */
  connectedRoomIds(): string[] {
    return [...this.rooms.keys()];
  }

  /** Whether anybody is connected to the room (a room with a connection is never idle, rules.md 10.4). */
  hasConnections(roomId: string): boolean {
    return (this.rooms.get(roomId)?.size ?? 0) > 0;
  }

  /** Whether `shutdown` was called (the database is about to close). */
  isClosed(): boolean {
    return this.closed;
  }

  /**
   * Drops the player's connection from the hub first (so no further snapshot reaches it and its close does not count
   * as a presence change), then closes the socket with `code`.
   */
  disconnectPlayer(roomId: string, playerId: string, code: number): void {
    const room = this.rooms.get(roomId);
    const conn = room?.get(playerId);
    if (!room || !conn) return;
    room.delete(playerId);
    if (room.size === 0) this.rooms.delete(roomId);
    conn.socket.close(code);
  }

  all(): Conn[] {
    return [...this.rooms.values()].flatMap((room) => [...room.values()]);
  }

  /** Whether the player has a live connection to the room. */
  isConnected(roomId: string, playerId: string): boolean {
    return this.rooms.get(roomId)?.has(playerId) ?? false;
  }

  /** The only way room data leaves the server: state is filtered through viewFor. */
  buildView(roomId: string, playerId: string): RoomView | "STATE_UNSUPPORTED" | undefined {
    const room = this.store.getRoom(roomId);
    if (!room) return undefined;
    const players = this.store.getPlayers(roomId);
    const me = players.find((p) => p.id === playerId);
    // A removed player gets nothing (their token is worthless, this is the second lock)
    if (!me || me.removed) return undefined;
    const loaded = loadState(this.store, room);
    if (!loaded.ok) {
      logRejectedState(this.log, loaded);
      return "STATE_UNSUPPORTED";
    }
    const state = loaded.state;
    return {
      roomId,
      status: room.status,
      // Lobby: the map chosen at creation; running game: the one in its stored state (same value).
      mapId: (state?.mapId ?? room.mapId) as MapId,
      version: room.version,
      you: { playerId, isHost: me.isHost },
      players: players.map((p) => ({
        id: p.id,
        name: p.name,
        seat: p.seat,
        isHost: p.isHost,
        connected: this.isConnected(roomId, p.id),
        // Running game: the mark from the game state; the lobby has no removed rows
        removed: state ? state.removedPlayerIds.includes(p.id) : p.removed,
        // Running game: the team from the game state; the lobby: the host's assignment
        team: state ? teamOf(state, p.id) : p.team,
      })),
      // Lobby: the host's choice (column); running game: the value in its state (the same, fixed at the start)
      victoryMode: state?.rules.victoryMode ?? room.victoryMode,
      fortifyMoves: state?.rules.fortifyMoves ?? room.fortifyMoves,
      missionDraft: state?.rules.missionDraft ?? room.missionDraft,
      holdToWin: state?.rules.holdToWin ?? room.holdToWin,
      roundLimit: state?.rules.roundLimit ?? room.roundLimit,
      worldEvents: state?.rules.worldEvents ?? room.worldEvents,
      teams: state?.rules.teams ?? room.teams,
      gameNo: room.gameNo,
      // Only the lobby needs the address (QR code); the same for everybody, never a path, room code or token.
      publicUrl: room.status === "lobby" ? (this.publicUrl ?? null) : null,
      game: state ? viewFor(state, playerId) : null,
    };
  }

  sendSnapshot(conn: Conn): void {
    if (this.closed) return;
    const view = this.buildView(conn.roomId, conn.playerId);
    if (view === "STATE_UNSUPPORTED") send(conn.socket, { type: "error", code: view });
    else if (view) send(conn.socket, { type: "snapshot", view });
  }

  /** Sends every connected player of the room their own snapshot. */
  broadcast(roomId: string): void {
    if (this.closed) return;
    for (const conn of this.rooms.get(roomId)?.values() ?? []) {
      try {
        this.sendSnapshot(conn);
      } catch {
        // One recipient's failure (e.g. a snapshot that fails the wire schema) must not starve the others.
      }
    }
  }
}
