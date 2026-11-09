import { createRoomResponseSchema, httpErrorSchema, joinResponseSchema } from "@wagnis/shared";
import type { CreateRoomResponse, JoinResponse, MapId } from "@wagnis/shared";
import type { ClientHttpError } from "./messages.js";

export type ApiResult<T> = { ok: true; data: T } | { ok: false; code: ClientHttpError };

async function post<T>(
  url: string,
  body: unknown,
  parse: (json: unknown) => T | undefined,
): Promise<ApiResult<T>> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const json: unknown = await res.json().catch(() => undefined);
    if (res.ok) {
      const data = parse(json);
      return data === undefined ? { ok: false, code: "INTERNAL" } : { ok: true, data };
    }
    const err = httpErrorSchema.safeParse(json);
    return { ok: false, code: err.success ? err.data.error.code : "INTERNAL" };
  } catch {
    return { ok: false, code: "NETWORK" };
  }
}

/** `mapId` is left out in the production build; the server then uses its default, the world map. */
export const createRoom = (createCode: string, hostName: string, mapId?: MapId) =>
  post<CreateRoomResponse>(
    "/api/rooms",
    { createCode, hostName, ...(mapId ? { mapId } : {}) },
    (j) => {
      const r = createRoomResponseSchema.safeParse(j);
      return r.success ? r.data : undefined;
    },
  );

export const joinRoom = (roomId: string, name: string) =>
  post<JoinResponse>(`/api/rooms/${encodeURIComponent(roomId)}/join`, { name }, (j) => {
    const r = joinResponseSchema.safeParse(j);
    return r.success ? r.data : undefined;
  });
