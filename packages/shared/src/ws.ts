import { z } from "zod";
import { mapIdSchema } from "./http.js";
import { roomViewSchema, victoryModeSchema } from "./view.js";

export const actionSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("placeArmies"),
    territoryId: z.string().min(1).max(64),
    count: z.number().int(),
  }),
  z.strictObject({
    type: z.literal("attack"),
    from: z.string().min(1).max(64),
    to: z.string().min(1).max(64),
    dice: z.number().int().min(1).max(3),
  }),
  z.strictObject({
    type: z.literal("blitz"),
    from: z.string().min(1).max(64),
    to: z.string().min(1).max(64),
  }),
  z.strictObject({ type: z.literal("occupy"), count: z.number().int().min(1) }),
  z.strictObject({
    type: z.literal("fortify"),
    from: z.string().min(1).max(64),
    to: z.string().min(1).max(64),
    count: z.number().int().min(1),
  }),
  z.strictObject({
    type: z.literal("tradeCards"),
    cardIds: z.array(z.string().min(1).max(64)).length(3),
    bonusTerritoryId: z.string().min(1).max(64).optional(),
  }),
  z.strictObject({ type: z.literal("endPhase") }),
]);
export type ActionMessage = z.infer<typeof actionSchema>;

/**
 * Host actions (rules.md 1.6). `skipTurn` and `removePlayer` run through the engine (`applyHostAction`);
 * `transferHost` (question 23, option C) is a room matter the server handles itself, without the engine.
 */
export const hostActionSchema = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("skipTurn"), turn: z.number().int().min(1) }),
  z.strictObject({ type: z.literal("removePlayer"), playerId: z.string().min(1).max(64) }),
  z.strictObject({ type: z.literal("transferHost"), playerId: z.string().min(1).max(64) }),
]);
export type HostActionMessage = z.infer<typeof hostActionSchema>;

export const clientMessageSchema = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("hello"),
    roomId: z.string().min(1).max(32),
    token: z.string().min(1).max(256),
  }),
  z.strictObject({ type: z.literal("start") }),
  z.strictObject({
    type: z.literal("action"),
    reqId: z.string().max(64).optional(),
    action: actionSchema,
  }),
  /** Host only, lobby only: map and/or victory mode (rules.md 10.1). At least one of the two fields. */
  z
    .strictObject({
      type: z.literal("settings"),
      mapId: mapIdSchema.optional(),
      victoryMode: victoryModeSchema.optional(),
    })
    .refine((m) => m.mapId !== undefined || m.victoryMode !== undefined, {
      message: "settings needs mapId or victoryMode",
    }),
  /** Host only (rules.md 1.6): skip a turn, remove a player. */
  z.strictObject({
    type: z.literal("host"),
    reqId: z.string().max(64).optional(),
    action: hostActionSchema,
  }),
  /** Host only, only after the game ended (rules.md 10.3). */
  z.strictObject({ type: z.literal("backToLobby") }),
]);
export type ClientMessage = z.infer<typeof clientMessageSchema>;

/** Close codes used by the server. */
export const WS_CLOSE_HELLO_FAILED = 4001;
export const WS_CLOSE_REPLACED = 4002;
export const WS_CLOSE_RATE_LIMITED = 4003;
/** The host removed this player: the client drops its token and does not reconnect (rules.md 10.2). */
export const WS_CLOSE_REMOVED = 4004;

export const wsErrorCodeSchema = z.enum([
  // protocol
  "BAD_MESSAGE",
  "NOT_AUTHENTICATED",
  "RATE_LIMITED",
  "NOT_HOST",
  "NOT_IN_LOBBY",
  "NOT_IN_GAME",
  "NOT_ENOUGH_PLAYERS",
  "START_FAILED",
  "INTERNAL",
  /** The stored game state has a newer or invalid version and was not loaded (rules.md 1.5). */
  "STATE_UNSUPPORTED",
  /** `backToLobby` before the game has ended (rules.md 10.3). */
  "NOT_FINISHED",
  /** The host cannot remove themselves (rules.md 1.6, question 23). */
  "CANNOT_REMOVE_SELF",
  /** `transferHost` to the player who already is the host (rules.md 1.6). */
  "ALREADY_HOST",
  /** `transferHost` to a player without a connection (question 32). */
  "NOT_PRESENT",
  // engine action errors
  "NOT_YOUR_TURN",
  "WRONG_PHASE",
  "UNKNOWN_TERRITORY",
  "NOT_OWNER",
  "INVALID_COUNT",
  "NOT_ENOUGH_REINFORCEMENTS",
  "REINFORCEMENTS_REMAINING",
  "UNKNOWN_ACTION",
  "UNKNOWN_MAP",
  "INVALID_DICE",
  "NOT_ADJACENT",
  "OWN_TARGET",
  "NOT_ENOUGH_ARMIES",
  "OCCUPY_PENDING",
  "NO_OCCUPY_PENDING",
  "INVALID_OCCUPY_COUNT",
  "GAME_OVER",
  "SAME_TERRITORY",
  "NOT_CONNECTED",
  "MUST_TRADE",
  "INVALID_SET",
  "UNKNOWN_CARD",
  "INVALID_BONUS_TERRITORY",
  // host actions (rules.md 1.6)
  "STALE_TURN",
  "UNKNOWN_PLAYER",
  "PLAYER_REMOVED",
]);
export type WsErrorCode = z.infer<typeof wsErrorCodeSchema>;

export const serverMessageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("snapshot"), view: roomViewSchema }),
  z.object({
    type: z.literal("error"),
    code: wsErrorCodeSchema,
    reqId: z.string().max(64).optional(),
  }),
]);
export type ServerMessage = z.infer<typeof serverMessageSchema>;
