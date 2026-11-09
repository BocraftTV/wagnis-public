import { STATE_VERSION, migrateState } from "@wagnis/engine";
import type { GameState, MigrateErrorCode, Rng } from "@wagnis/engine";
import { cryptoRng } from "./crypto.js";
import type { RoomRow, Store } from "./store.js";

export type LoadResult =
  /** `state` is null while the room has no game yet. */
  | { ok: true; state: GameState | null }
  /** The stored state was not touched. `found` is the stored version if it is a number, else null. */
  | { ok: false; code: MigrateErrorCode; found: number | null };

/** Logger with the one method used here; the log line carries codes and version numbers only. */
export interface StateLog {
  warn(obj: Record<string, unknown>, msg: string): void;
}

/**
 * Loads a room's game state through the migration chain (rules.md 1.5). A migrated state is written back once,
 * so a state that needed the `rng` (phase 2: freshly shuffled deck) stays the same on every later load. A state
 * with a newer or invalid version is rejected and never written; nothing but the code and the version
 * numbers leaves this function.
 */
export function loadState(store: Store, room: RoomRow, rng: Rng = cryptoRng): LoadResult {
  if (!room.stateJson) return { ok: true, state: null };
  const raw = JSON.parse(room.stateJson) as unknown;
  const result = migrateState(raw, rng);
  if (!result.ok) {
    const v = (raw as { stateVersion?: unknown } | null)?.stateVersion;
    return { ok: false, code: result.code, found: typeof v === "number" ? v : null };
  }
  if (result.migrated) store.rewriteState(room.id, result.state);
  return { ok: true, state: result.state };
}

/** Logs a rejected state: code and the two version numbers, never state contents, ids or tokens. */
export function logRejectedState(
  log: StateLog | undefined,
  result: LoadResult & { ok: false },
): void {
  log?.warn(
    { code: result.code, found: result.found, supported: STATE_VERSION },
    "stored game state rejected",
  );
}
