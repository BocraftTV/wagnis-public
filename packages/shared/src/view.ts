import { z } from "zod";
import { mapIdSchema } from "./http.js";

export const phaseSchema = z.enum(["reinforce", "attack", "fortify"]);

/** `"missions"`: secret missions; `"domination"`: no missions, the last player wins (rules.md 1.1, 10.1). */
export const victoryModeSchema = z.enum(["missions", "domination"]);

const rollRecordSchema = z.object({
  attackerDice: z.array(z.number().int()),
  defenderDice: z.array(z.number().int()),
  attackerLosses: z.number().int(),
  defenderLosses: z.number().int(),
});

/** Secret win condition: data only, the client makes the texts (rules.md 1.1). */
export const missionSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("conquerContinents"),
    continentIds: z.array(z.string()),
    extraContinents: z.number().int(),
  }),
  z.object({
    type: z.literal("holdTerritories"),
    count: z.number().int(),
    minArmies: z.number().int(),
  }),
  z.object({ type: z.literal("eliminatePlayer"), targetPlayerId: z.string() }),
]);

export const combatRecordSchema = z.object({
  seq: z.number().int(),
  attackerId: z.string(),
  /** `null`: the defender was neutral. */
  defenderId: z.string().nullable(),
  from: z.string(),
  to: z.string(),
  rolls: z.array(rollRecordSchema),
  summary: z.object({
    rollCount: z.number().int(),
    attackerLosses: z.number().int(),
    defenderLosses: z.number().int(),
    conquered: z.boolean(),
  }),
});

export const cardKindSchema = z.enum(["infantry", "cavalry", "artillery", "joker"]);

export const cardSchema = z.object({
  id: z.string(),
  kind: cardKindSchema,
  territoryId: z.string().nullable(),
});

/** A card in the owner's own hand only; public cards (`lastTrade`) use `cardSchema`. */
export const handCardSchema = cardSchema.extend({ bonusEligible: z.boolean() });

const suggestedSetSchema = z.object({
  cardIds: z.array(z.string()),
  value: z.number().int(),
  bonusTerritoryId: z.string().nullable(),
});

export const tradeRecordSchema = z.object({
  seq: z.number().int(),
  playerId: z.string(),
  cards: z.array(cardSchema),
  armies: z.number().int(),
  bonusTerritoryId: z.string().nullable(),
});

const fortifyViewSchema = z.discriminatedUnion("reach", [
  z.object({ reach: z.literal("connected"), groups: z.array(z.array(z.string())) }),
  z.object({ reach: z.literal("adjacent"), targets: z.record(z.string(), z.array(z.string())) }),
]);

export const gameViewSchema = z.object({
  mapId: z.string(),
  phase: phaseSchema,
  turn: z.number().int(),
  activePlayerId: z.string(),
  playerOrder: z.array(z.string()),
  /** Players the host removed (rules.md 1.6); public. */
  removedPlayerIds: z.array(z.string()),
  reinforcementsLeft: z.number().int(),
  territories: z.record(
    z.string(),
    z.object({
      /** `null`: neutral owner (rules.md 1.3). */
      ownerId: z.string().nullable(),
      armies: z.number().int(),
      maxAttackDice: z.number().int(),
      maxMove: z.number().int(),
    }),
  ),
  pendingOccupation: z
    .object({
      from: z.string(),
      to: z.string(),
      min: z.number().int(),
      max: z.number().int(),
    })
    .nullable(),
  conqueredThisTurn: z.boolean(),
  winnerId: z.string().nullable(),
  winReason: z.enum(["lastPlayer", "mission"]).nullable(),
  victoryMode: victoryModeSchema,
  /** The resolution, only once `winnerId` is set. `originalMission` is set only if the mission was replaced. */
  missions: z
    .record(
      z.string(),
      z.object({ mission: missionSchema, originalMission: missionSchema.nullable() }),
    )
    .nullable(),
  lastCombat: combatRecordSchema.nullable(),
  lastTrade: tradeRecordSchema.nullable(),
  deckCount: z.number().int(),
  discardCount: z.number().int(),
  fortify: fortifyViewSchema.nullable(),
  secret: z.object({
    mission: missionSchema.nullable(),
    missionReplaced: z.boolean(),
    hand: z.array(handCardSchema),
    suggestedSets: z.array(suggestedSetSchema),
    mustTrade: z.boolean(),
  }),
  handCounts: z.record(z.string(), z.number().int()),
});
export type GameViewMessage = z.infer<typeof gameViewSchema>;

export const roomStatusSchema = z.enum(["lobby", "playing", "finished"]);
export type RoomStatus = z.infer<typeof roomStatusSchema>;

export const roomViewSchema = z.object({
  roomId: z.string(),
  status: roomStatusSchema,
  /** Map of the room (public; the same as `game.mapId` once the game runs). */
  mapId: mapIdSchema,
  /** Counts persisted changes only; presence changes keep the version. */
  version: z.number().int().nonnegative(),
  you: z.object({ playerId: z.string(), isHost: z.boolean() }),
  players: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      seat: z.number().int().nonnegative(),
      isHost: z.boolean(),
      connected: z.boolean(),
      /** Removed by the host (rules.md 1.6); in the lobby always false, because removed rows are deleted there. */
      removed: z.boolean(),
    }),
  ),
  /** Victory mode of the room: the lobby choice, once the game runs the one in the game state (public, same for all). */
  victoryMode: victoryModeSchema,
  /** Number of the game in this room, from 1; rises with every "back to the lobby" (public). */
  gameNo: z.number().int().min(1),
  /**
   * Origin for the lobby QR code (`WAGNIS_PUBLIC_URL`; no path, no room code, no token). Only in the lobby, else `null`;
   * `null` also when the variable is not set. Public, the same for everybody.
   */
  publicUrl: z.string().nullable(),
  game: gameViewSchema.nullable(),
});
export type RoomView = z.infer<typeof roomViewSchema>;
