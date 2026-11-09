import type { Hub } from "./hub.js";
import type { Store } from "./store.js";

/** A room idle for longer than this is deleted (rules.md 10.4). A constant, not an environment variable. */
export const IDLE_MS = 48 * 60 * 60 * 1000;
/** The cleanup runs at the start and then once an hour. */
export const SWEEP_INTERVAL_MS = 60 * 60 * 1000;

export interface SweepDeps {
  store: Store;
  hub: Pick<Hub, "connectedRoomIds">;
  /** The server's clock (injectable; the engine has none). */
  now: () => number;
  maxIdleMs: number;
}

/**
 * Deletes every room whose last activity is more than `maxIdleMs` ago, whatever its state (lobby, running,
 * finished), except rooms with at least one connection: those are never idle. Players first, then the room, in one
 * transaction; final. Returns the number of deleted rooms.
 */
export function sweepIdleRooms(deps: SweepDeps): number {
  return deps.store.deleteIdleRooms(deps.now() - deps.maxIdleMs, deps.hub.connectedRoomIds());
}

/**
 * Sweeps once right away (before the first request) and then every `intervalMs`. The timer does not keep the process
 * alive. `onSwept` gets only the number of deleted rooms (the one thing that may be logged: no codes, names, tokens).
 */
export function startSweeper(
  deps: SweepDeps & { intervalMs: number; onSwept?: (deleted: number) => void },
): { stop: () => void } {
  const run = (): void => {
    const deleted = sweepIdleRooms(deps);
    if (deleted > 0) deps.onSwept?.(deleted);
  };
  run();
  const timer = setInterval(run, deps.intervalMs);
  timer.unref();
  return { stop: () => clearInterval(timer) };
}
