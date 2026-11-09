import { z } from "zod";

export const MAX_PLAYERS = 6;
export const MAX_NAME_LENGTH = 16;

const hasControlChars = (s: string) => /\p{Cc}/u.test(s);

/** 1-16 code points after trimming, no control characters. */
export const playerNameSchema = z
  .string()
  .trim()
  .refine(
    (s) => [...s].length >= 1 && [...s].length <= MAX_NAME_LENGTH,
    "name must be 1-16 characters",
  )
  .refine((s) => !hasControlChars(s), "name must not contain control characters");

/** IDs of the playable maps; the engine registry has exactly these (checked by a server test). */
export const mapIdSchema = z.enum(["welt", "testland"]);
export type MapId = z.infer<typeof mapIdSchema>;
export const DEFAULT_MAP_ID: MapId = "welt";

export const createRoomRequestSchema = z.strictObject({
  createCode: z.string().min(1).max(200),
  hostName: playerNameSchema,
  /** Map of the room, fixed at creation; without it the world map. */
  mapId: mapIdSchema.default(DEFAULT_MAP_ID),
});
/** What a client sends (`mapId` optional); the parsed value always has it. */
export type CreateRoomRequest = z.input<typeof createRoomRequestSchema>;

export const joinRoomRequestSchema = z.strictObject({ name: playerNameSchema });
export type JoinRoomRequest = z.infer<typeof joinRoomRequestSchema>;

export const joinResponseSchema = z.object({ playerId: z.string(), playerToken: z.string() });
export type JoinResponse = z.infer<typeof joinResponseSchema>;

export const createRoomResponseSchema = joinResponseSchema.extend({ roomId: z.string() });
export type CreateRoomResponse = z.infer<typeof createRoomResponseSchema>;

export const httpErrorCodeSchema = z.enum([
  "VALIDATION",
  "BAD_CREATE_CODE",
  "ROOM_NOT_FOUND",
  "ROOM_NOT_JOINABLE",
  "ROOM_FULL",
  "NAME_TAKEN",
  "RATE_LIMITED",
  "NOT_FOUND",
  "INTERNAL",
]);
export type HttpErrorCode = z.infer<typeof httpErrorCodeSchema>;

export const httpErrorSchema = z.object({
  error: z.object({ code: httpErrorCodeSchema, message: z.string() }),
});
export type HttpError = z.infer<typeof httpErrorSchema>;
