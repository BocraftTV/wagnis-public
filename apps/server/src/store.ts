import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import Database from "better-sqlite3";
import { defaultFortifyMoves } from "@wagnis/engine";
import type { GameState } from "@wagnis/engine";
import { MAX_PLAYERS } from "@wagnis/shared";
import type { MapId, RoomStatus } from "@wagnis/shared";

export type VictoryMode = "missions" | "domination";

export interface RoomRow {
  id: string;
  status: RoomStatus;
  /** Map chosen when the room was created; a running game uses the one in its state. */
  mapId: MapId;
  /** Victory mode chosen in the lobby; a running game uses the one in its state. */
  victoryMode: VictoryMode;
  /** Fortify moves per turn chosen in the lobby (1 or 2); a running game uses the one in its state. */
  fortifyMoves: 1 | 2;
  /** Mission options chosen in the lobby (plan 013); a running game uses the values in its state. */
  missionDraft: boolean;
  holdToWin: boolean;
  /** Number of the game in this room, from 1; rises with every "back to the lobby". */
  gameNo: number;
  stateJson: string | null;
  version: number;
  createdAt: number;
  updatedAt: number;
  /** Last activity for the cleanup (rules.md 10.4); never leaves the server. */
  lastActivityAt: number;
}

export interface PlayerRow {
  id: string;
  roomId: string;
  name: string;
  tokenHash: string;
  seat: number;
  isHost: boolean;
  /** Marked as removed by the host (running game only; the token hash is then empty). */
  removed: boolean;
}

export type AddPlayerResult =
  | { ok: true }
  | { ok: false; code: "ROOM_NOT_FOUND" | "ROOM_NOT_JOINABLE" | "ROOM_FULL" | "NAME_TAKEN" };

const SCHEMA = `
CREATE TABLE IF NOT EXISTS rooms (
  id TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('lobby','playing','finished')),
  state_json TEXT,
  map_id TEXT NOT NULL DEFAULT 'testland',
  version INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  victory_mode TEXT NOT NULL DEFAULT 'missions',
  game_no INTEGER NOT NULL DEFAULT 1,
  last_activity_at INTEGER NOT NULL DEFAULT 0,
  fortify_moves INTEGER NOT NULL DEFAULT 1,
  mission_draft INTEGER NOT NULL DEFAULT 0,
  hold_to_win INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS players (
  id TEXT PRIMARY KEY,
  room_id TEXT NOT NULL REFERENCES rooms(id),
  name TEXT NOT NULL,
  token_hash TEXT NOT NULL,
  seat INTEGER NOT NULL,
  is_host INTEGER NOT NULL DEFAULT 0,
  removed INTEGER NOT NULL DEFAULT 0,
  UNIQUE (room_id, seat)
);
CREATE UNIQUE INDEX IF NOT EXISTS players_room_name ON players (room_id, lower(name));
CREATE TABLE IF NOT EXISTS schema_meta (version INTEGER NOT NULL);
`;

const SCHEMA_VERSION = 5;

export class Store {
  private readonly db: Database.Database;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 5000");
    this.db.exec(SCHEMA);
    this.db.transaction(() => this.upgrade())();
  }

  /**
   * Schema version 2 (phase 5) added `rooms.map_id` (old rows: `testland`, the map every room of that time was
   * played on). Version 3 (phase 6a) adds `rooms.victory_mode` (old rows: `missions`, the default every room
   * started with), `rooms.game_no` (1), `rooms.last_activity_at` (filled once from `updated_at`) and
   * `players.removed` (0). All in one transaction; rows are not rewritten otherwise, and opening an up-to-date
   * database changes nothing. Version 4 (plan 011) adds `rooms.fortify_moves` (old rows: 1, the one fortify move per
   * turn every room had until then). Version 5 (plan 013) adds `rooms.mission_draft` and `rooms.hold_to_win` (old rows: 0,
   * both options off).
   */
  private upgrade(): void {
    const has = (table: string, column: string): boolean =>
      (this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(
        (c) => c.name === column,
      );
    if (!has("rooms", "map_id")) {
      this.db.exec("ALTER TABLE rooms ADD COLUMN map_id TEXT NOT NULL DEFAULT 'testland'");
    }
    if (!has("rooms", "victory_mode")) {
      this.db.exec("ALTER TABLE rooms ADD COLUMN victory_mode TEXT NOT NULL DEFAULT 'missions'");
    }
    if (!has("rooms", "game_no")) {
      this.db.exec("ALTER TABLE rooms ADD COLUMN game_no INTEGER NOT NULL DEFAULT 1");
    }
    if (!has("rooms", "last_activity_at")) {
      this.db.exec("ALTER TABLE rooms ADD COLUMN last_activity_at INTEGER NOT NULL DEFAULT 0");
      this.db.exec("UPDATE rooms SET last_activity_at = updated_at");
    }
    if (!has("rooms", "fortify_moves")) {
      this.db.exec("ALTER TABLE rooms ADD COLUMN fortify_moves INTEGER NOT NULL DEFAULT 1");
    }
    if (!has("rooms", "mission_draft")) {
      this.db.exec("ALTER TABLE rooms ADD COLUMN mission_draft INTEGER NOT NULL DEFAULT 0");
    }
    if (!has("rooms", "hold_to_win")) {
      this.db.exec("ALTER TABLE rooms ADD COLUMN hold_to_win INTEGER NOT NULL DEFAULT 0");
    }
    if (!has("players", "removed")) {
      this.db.exec("ALTER TABLE players ADD COLUMN removed INTEGER NOT NULL DEFAULT 0");
    }
    if (this.db.prepare("SELECT 1 FROM schema_meta").get() === undefined) {
      this.db.prepare("INSERT INTO schema_meta (version) VALUES (?)").run(SCHEMA_VERSION);
    } else {
      this.db
        .prepare("UPDATE schema_meta SET version = ? WHERE version < ?")
        .run(SCHEMA_VERSION, SCHEMA_VERSION);
    }
  }

  close(): void {
    this.db.close();
  }

  roomExists(id: string): boolean {
    return this.db.prepare("SELECT 1 FROM rooms WHERE id = ?").get(id) !== undefined;
  }

  getRoom(id: string): RoomRow | undefined {
    const r = this.db.prepare("SELECT * FROM rooms WHERE id = ?").get(id) as
      Record<string, unknown> | undefined;
    if (!r) return undefined;
    return {
      id: r["id"] as string,
      status: r["status"] as RoomStatus,
      mapId: r["map_id"] as MapId,
      victoryMode: r["victory_mode"] as VictoryMode,
      fortifyMoves: r["fortify_moves"] as 1 | 2,
      missionDraft: r["mission_draft"] === 1,
      holdToWin: r["hold_to_win"] === 1,
      gameNo: r["game_no"] as number,
      stateJson: r["state_json"] as string | null,
      version: r["version"] as number,
      createdAt: r["created_at"] as number,
      updatedAt: r["updated_at"] as number,
      lastActivityAt: r["last_activity_at"] as number,
    };
  }

  getPlayers(roomId: string): PlayerRow[] {
    const rows = this.db
      .prepare("SELECT * FROM players WHERE room_id = ? ORDER BY seat")
      .all(roomId) as Record<string, unknown>[];
    return rows.map((r) => ({
      id: r["id"] as string,
      roomId: r["room_id"] as string,
      name: r["name"] as string,
      tokenHash: r["token_hash"] as string,
      seat: r["seat"] as number,
      isHost: r["is_host"] === 1,
      removed: r["removed"] === 1,
    }));
  }

  createRoom(
    roomId: string,
    mapId: MapId,
    host: Omit<PlayerRow, "roomId" | "seat" | "isHost" | "removed">,
    now: number,
  ): void {
    this.db.transaction(() => {
      this.db
        .prepare(
          "INSERT INTO rooms (id, status, state_json, map_id, version, created_at, updated_at, last_activity_at, fortify_moves) VALUES (?, 'lobby', NULL, ?, 0, ?, ?, ?, ?)",
        )
        .run(roomId, mapId, now, now, now, defaultFortifyMoves);
      this.db
        .prepare(
          "INSERT INTO players (id, room_id, name, token_hash, seat, is_host) VALUES (?, ?, ?, ?, 0, 1)",
        )
        .run(host.id, roomId, host.name, host.tokenHash);
    })();
  }

  /** Adds a non-host player to a lobby and bumps the room version, atomically. */
  addPlayer(
    roomId: string,
    player: Omit<PlayerRow, "roomId" | "seat" | "isHost" | "removed">,
    now: number,
  ): AddPlayerResult {
    return this.db.transaction((): AddPlayerResult => {
      const room = this.getRoom(roomId);
      if (!room) return { ok: false, code: "ROOM_NOT_FOUND" };
      if (room.status !== "lobby") return { ok: false, code: "ROOM_NOT_JOINABLE" };
      const players = this.getPlayers(roomId);
      if (players.length >= MAX_PLAYERS) return { ok: false, code: "ROOM_FULL" };
      const key = player.name.toLowerCase();
      if (players.some((p) => p.name.toLowerCase() === key))
        return { ok: false, code: "NAME_TAKEN" };
      // The lowest free seat: a seat freed by removing a lobby player is used again
      let seat = 0;
      while (players.some((p) => p.seat === seat)) seat++;
      this.db
        .prepare(
          "INSERT INTO players (id, room_id, name, token_hash, seat, is_host) VALUES (?, ?, ?, ?, ?, 0)",
        )
        .run(player.id, roomId, player.name, player.tokenHash, seat);
      this.db
        .prepare(
          "UPDATE rooms SET version = version + 1, updated_at = ?, last_activity_at = ? WHERE id = ?",
        )
        .run(now, now, roomId);
      return { ok: true };
    })();
  }

  /** Replaces the stored state without touching status or version (migration of an outdated state). */
  rewriteState(roomId: string, state: GameState): void {
    this.db
      .prepare("UPDATE rooms SET state_json = ? WHERE id = ?")
      .run(JSON.stringify(state), roomId);
  }

  /** Persists the game state and bumps the version; also counts as activity. */
  saveGame(roomId: string, status: RoomStatus, state: GameState, now: number): void {
    this.db
      .prepare(
        "UPDATE rooms SET status = ?, state_json = ?, version = version + 1, updated_at = ?, last_activity_at = ? WHERE id = ?",
      )
      .run(status, JSON.stringify(state), now, now, roomId);
  }

  /**
   * Cleanup (rules.md 10.4): deletes the rooms whose `last_activity_at` is before `cutoff`, except `keepRoomIds`,
   * players first and then the room, in one transaction. Returns the number of deleted rooms.
   */
  deleteIdleRooms(cutoff: number, keepRoomIds: string[]): number {
    return this.db.transaction((): number => {
      const keep = new Set(keepRoomIds);
      const ids = (
        this.db.prepare("SELECT id FROM rooms WHERE last_activity_at < ?").all(cutoff) as {
          id: string;
        }[]
      )
        .map((r) => r.id)
        .filter((id) => !keep.has(id));
      for (const id of ids) {
        this.db.prepare("DELETE FROM players WHERE room_id = ?").run(id);
        this.db.prepare("DELETE FROM rooms WHERE id = ?").run(id);
      }
      return ids.length;
    })();
  }

  /**
   * Host handover (rules.md 1.6): `is_host` moves from `fromId` to `toId` in ONE transaction, so there is always exactly
   * one host. Returns an error code instead if the target is unknown, removed or already the host, or if `fromId` is
   * not the host any more; nothing is written then.
   */
  transferHost(
    roomId: string,
    fromId: string,
    toId: string,
    now: number,
  ): "OK" | "NOT_HOST" | "UNKNOWN_PLAYER" | "PLAYER_REMOVED" | "ALREADY_HOST" {
    return this.db.transaction(
      (): "OK" | "NOT_HOST" | "UNKNOWN_PLAYER" | "PLAYER_REMOVED" | "ALREADY_HOST" => {
        const players = this.getPlayers(roomId);
        if (!players.find((p) => p.id === fromId)?.isHost) return "NOT_HOST";
        const target = players.find((p) => p.id === toId);
        if (!target) return "UNKNOWN_PLAYER";
        if (target.removed) return "PLAYER_REMOVED";
        if (target.isHost) return "ALREADY_HOST";
        this.db
          .prepare("UPDATE players SET is_host = 0 WHERE id = ? AND room_id = ?")
          .run(fromId, roomId);
        this.db
          .prepare("UPDATE players SET is_host = 1 WHERE id = ? AND room_id = ?")
          .run(toId, roomId);
        this.db
          .prepare(
            "UPDATE rooms SET version = version + 1, updated_at = ?, last_activity_at = ? WHERE id = ?",
          )
          .run(now, now, roomId);
        return "OK";
      },
    )();
  }

  /** Records activity (a connection opened or ended) without touching the version. */
  touchRoom(roomId: string, now: number): void {
    this.db.prepare("UPDATE rooms SET last_activity_at = ? WHERE id = ?").run(now, roomId);
  }

  /** Lobby choice of map, victory mode and/or fortify moves. Returns false unless the room is in the lobby. */
  setSettings(
    roomId: string,
    patch: {
      mapId?: MapId | undefined;
      victoryMode?: VictoryMode | undefined;
      fortifyMoves?: 1 | 2 | undefined;
      missionDraft?: boolean | undefined;
      holdToWin?: boolean | undefined;
    },
    now: number,
  ): boolean {
    return this.db.transaction((): boolean => {
      if (this.getRoom(roomId)?.status !== "lobby") return false;
      if (patch.mapId !== undefined)
        this.db.prepare("UPDATE rooms SET map_id = ? WHERE id = ?").run(patch.mapId, roomId);
      if (patch.victoryMode !== undefined)
        this.db
          .prepare("UPDATE rooms SET victory_mode = ? WHERE id = ?")
          .run(patch.victoryMode, roomId);
      if (patch.fortifyMoves !== undefined)
        this.db
          .prepare("UPDATE rooms SET fortify_moves = ? WHERE id = ?")
          .run(patch.fortifyMoves, roomId);
      if (patch.missionDraft !== undefined)
        this.db
          .prepare("UPDATE rooms SET mission_draft = ? WHERE id = ?")
          .run(patch.missionDraft ? 1 : 0, roomId);
      if (patch.holdToWin !== undefined)
        this.db
          .prepare("UPDATE rooms SET hold_to_win = ? WHERE id = ?")
          .run(patch.holdToWin ? 1 : 0, roomId);
      this.db
        .prepare(
          "UPDATE rooms SET version = version + 1, updated_at = ?, last_activity_at = ? WHERE id = ?",
        )
        .run(now, now, roomId);
      return true;
    })();
  }

  /** Lobby only: deletes the player's row (seat and name become free) and bumps the version. */
  removeLobbyPlayer(roomId: string, playerId: string, now: number): boolean {
    return this.db.transaction((): boolean => {
      if (this.getRoom(roomId)?.status !== "lobby") return false;
      const gone = this.db
        .prepare("DELETE FROM players WHERE id = ? AND room_id = ?")
        .run(playerId, roomId);
      if (gone.changes === 0) return false;
      this.db
        .prepare(
          "UPDATE rooms SET version = version + 1, updated_at = ?, last_activity_at = ? WHERE id = ?",
        )
        .run(now, now, roomId);
      return true;
    })();
  }

  /**
   * Running game: saves the state after `removePlayer` and marks the row as removed with an empty token hash, in
   * ONE transaction, so state and row never disagree (rules.md 10.2).
   */
  removeGamePlayer(
    roomId: string,
    playerId: string,
    status: RoomStatus,
    state: GameState,
    now: number,
  ): void {
    this.db.transaction(() => {
      this.saveGame(roomId, status, state, now);
      this.db
        .prepare("UPDATE players SET removed = 1, token_hash = '' WHERE id = ? AND room_id = ?")
        .run(playerId, roomId);
    })();
  }

  /**
   * After the end of a game: removed players lose their row, the game state is deleted, the room is a lobby again
   * with the next game number. The version keeps counting (clients only accept a version that is not lower).
   * Returns false unless the room is `finished`.
   */
  resetToLobby(roomId: string, now: number): boolean {
    return this.db.transaction((): boolean => {
      if (this.getRoom(roomId)?.status !== "finished") return false;
      this.db.prepare("DELETE FROM players WHERE room_id = ? AND removed = 1").run(roomId);
      this.db
        .prepare(
          "UPDATE rooms SET state_json = NULL, status = 'lobby', game_no = game_no + 1, version = version + 1, updated_at = ?, last_activity_at = ? WHERE id = ?",
        )
        .run(now, now, roomId);
      return true;
    })();
  }
}
