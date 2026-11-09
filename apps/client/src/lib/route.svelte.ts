import { isValidRoomId, normalizeRoomId } from "@wagnis/shared";

function roomFromPath(path: string): string | null {
  const match = /^\/r\/([^/]+)\/?$/.exec(path);
  if (!match?.[1]) return null;
  const id = normalizeRoomId(decodeURIComponent(match[1]));
  return isValidRoomId(id) ? id : null;
}

export const route = $state({ roomId: roomFromPath(globalThis.location?.pathname ?? "/") });

export function navigate(roomId: string | null): void {
  history.pushState(null, "", roomId ? `/r/${roomId}` : "/");
  route.roomId = roomId;
}

globalThis.addEventListener?.("popstate", () => {
  route.roomId = roomFromPath(location.pathname);
});
