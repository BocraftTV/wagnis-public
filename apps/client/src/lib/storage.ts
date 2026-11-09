export interface StoredIdentity {
  playerId: string;
  token: string;
}

const key = (roomId: string) => `wagnis:room:${roomId}`;

function storage(): Storage | undefined {
  try {
    return globalThis.localStorage;
  } catch {
    return undefined; // access can throw (private mode, blocked storage)
  }
}

export function loadIdentity(
  roomId: string,
  store: Storage | undefined = storage(),
): StoredIdentity | null {
  try {
    const raw = store?.getItem(key(roomId));
    if (!raw) return null;
    const v = JSON.parse(raw) as Partial<StoredIdentity>;
    return typeof v.playerId === "string" && typeof v.token === "string"
      ? { playerId: v.playerId, token: v.token }
      : null;
  } catch {
    return null;
  }
}

export function saveIdentity(
  roomId: string,
  identity: StoredIdentity,
  store: Storage | undefined = storage(),
): void {
  try {
    store?.setItem(key(roomId), JSON.stringify(identity));
  } catch {
    /* app keeps working for this session without persistence */
  }
}

export function clearIdentity(roomId: string, store: Storage | undefined = storage()): void {
  try {
    store?.removeItem(key(roomId));
  } catch {
    /* ignore */
  }
}
