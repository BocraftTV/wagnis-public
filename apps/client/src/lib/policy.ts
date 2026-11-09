import { WS_CLOSE_HELLO_FAILED, WS_CLOSE_REMOVED, WS_CLOSE_REPLACED } from "@wagnis/shared";
import type { RoomView } from "@wagnis/shared";

/** Reconnect delay: 0.5 s, doubling, capped at 5 s. Unlimited attempts. */
export function backoffDelay(attempt: number): number {
  return Math.min(500 * 2 ** attempt, 5000);
}

export type CloseAction = "reconnect" | "rejected" | "replaced" | "removed";

export function actionForClose(code: number): CloseAction {
  if (code === WS_CLOSE_HELLO_FAILED) return "rejected"; // token invalid: stop, forget it
  if (code === WS_CLOSE_REMOVED) return "removed"; // the host removed this player: forget the token, never reconnect
  if (code === WS_CLOSE_REPLACED) return "replaced"; // another window took over: do not fight
  return "reconnect"; // includes rate-limit close 4003: keep backing off
}

/** Snapshots carry a version; presence changes repeat it, so equal versions are accepted. */
export function acceptSnapshot(current: RoomView | null, incoming: RoomView): boolean {
  return (
    current === null || current.roomId !== incoming.roomId || incoming.version >= current.version
  );
}
