import { cardCatalog } from "./cards.js";
import { getMap } from "./maps/index.js";
import { defaultCardRules, defaultFortifyReach } from "./rules/defaults.js";
import { shuffle } from "./shuffle.js";
import type {
  CardId,
  CardRules,
  GameState,
  PlayerId,
  RuleConfig,
  Rng,
  SecretState,
} from "./types.js";

/** Rules as saved before phase 3: no `fortifyReach`, no `cards` (or only part of them). */
type LegacyRules = Omit<
  RuleConfig,
  | "fortifyReach"
  | "fortifyMoves"
  | "cards"
  | "victoryMode"
  | "missionDraft"
  | "holdToWin"
  | "roundLimit"
  | "worldEvents"
> & {
  fortifyReach?: RuleConfig["fortifyReach"];
  cards?: Partial<Omit<CardRules, "tradeValues">> & {
    tradeValues?: Partial<CardRules["tradeValues"]>;
  };
};

type LegacySecret = { mission: Record<PlayerId, unknown>; hand: SecretState["hand"] } & Partial<
  Pick<SecretState, "deck" | "discard">
>;

/** The state format up to phase 3 (no `stateVersion`, `victoryMode`, `winReason`, `originalMission`, ...). */
export type GameStateV3 = Omit<
  GameState,
  | "rules"
  | "secret"
  | "winReason"
  | "stateVersion"
  | "removedPlayerIds"
  | "fortifyMovesDone"
  | "conquestsThisTurn"
  | "round"
  | "winnerIds"
  | "worldEvent"
> & {
  rules: Omit<
    RuleConfig,
    "victoryMode" | "fortifyMoves" | "missionDraft" | "holdToWin" | "roundLimit" | "worldEvents"
  >;
  secret: Omit<
    SecretState,
    | "eventDeck"
    | "mission"
    | "originalMission"
    | "missionReplaced"
    | "missionOffer"
    | "missionOfferDealt"
    | "discardedMission"
    | "victoryPending"
  > & {
    mission: Record<PlayerId, unknown>;
  };
};

/** The state format of plan 014 A (version 8): everything of version 9 except `rules.worldEvents`, `worldEvent` and `secret.eventDeck` (plan 014 B). */
export type GameStateV8 = Omit<GameState, "worldEvent" | "rules" | "secret" | "stateVersion"> & {
  rules: Omit<RuleConfig, "worldEvents">;
  secret: Omit<SecretState, "eventDeck">;
  stateVersion: 8;
};

/** The state format of plan 013 (version 7): everything of version 8 except `round`, `winnerIds` and `rules.roundLimit` (plan 014 A). */
export type GameStateV7 = Omit<GameStateV8, "round" | "winnerIds" | "rules" | "stateVersion"> & {
  rules: Omit<GameStateV8["rules"], "roundLimit">;
  stateVersion: 7;
};

/**
 * The state format of plan 011 (version 6): everything of version 7 except the plan 013 fields (`conquestsThisTurn`,
 * `rules.missionDraft`/`holdToWin`, `secret.missionOffer`/`discardedMission`/`victoryPending`).
 */
export type GameStateV6 = Omit<
  GameStateV7,
  "conquestsThisTurn" | "rules" | "secret" | "stateVersion"
> & {
  rules: Omit<GameStateV7["rules"], "missionDraft" | "holdToWin">;
  secret: Omit<
    GameStateV7["secret"],
    "missionOffer" | "missionOfferDealt" | "discardedMission" | "victoryPending"
  >;
  stateVersion: 6;
};

/** The state format of phase 6a (version 5): everything of version 6 except `fortifyMovesDone` and `rules.fortifyMoves`. */
export type GameStateV5 = Omit<GameStateV6, "fortifyMovesDone" | "rules" | "stateVersion"> & {
  rules: Omit<GameStateV6["rules"], "fortifyMoves">;
  stateVersion: 5;
};

/** The state format of phases 4 and 5: everything of version 5 except `removedPlayerIds`. */
export type GameStateV4 = Omit<GameStateV5, "removedPlayerIds" | "stateVersion"> & {
  stateVersion: 4;
};

/** Fields added after phase 1, as they may be missing from stored older states. */
type LegacyGameState = Omit<
  GameStateV3,
  | "pendingOccupation"
  | "conqueredThisTurn"
  | "winnerId"
  | "lastCombat"
  | "combatSeq"
  | "lastTrade"
  | "tradeSeq"
  | "rules"
  | "secret"
> &
  Partial<Omit<GameStateV3, "rules" | "secret">> & { rules: LegacyRules; secret: LegacySecret };

/**
 * Fills defaults for fields missing in states saved by earlier versions; complete states stay as they
 * are and use no `rng`. A state without a draw pile (phase 2) gets a freshly shuffled one over the
 * injected `rng`, so the engine stays pure.
 */
export function normalizeState(state: LegacyGameState, rng: Rng): GameStateV3 {
  const rules: GameStateV3["rules"] = {
    ...state.rules,
    fortifyReach: state.rules.fortifyReach ?? defaultFortifyReach,
    cards: {
      ...defaultCardRules,
      ...state.rules.cards,
      tradeValues: { ...defaultCardRules.tradeValues, ...state.rules.cards?.tradeValues },
    },
  };
  const hand: Record<PlayerId, CardId[]> = { ...state.secret.hand };
  for (const p of state.playerOrder) hand[p] ??= [];
  const discard = state.secret.discard ?? [];
  return {
    ...state,
    rules,
    secret: {
      ...state.secret,
      hand,
      deck: state.secret.deck ?? freshDeck(state, rules, hand, discard, rng),
      discard,
    },
    pendingOccupation: state.pendingOccupation ?? null,
    conqueredThisTurn: state.conqueredThisTurn ?? false,
    winnerId: state.winnerId ?? null,
    lastCombat: state.lastCombat ?? null,
    combatSeq: state.combatSeq ?? 0,
    lastTrade: state.lastTrade ?? null,
    tradeSeq: state.tradeSeq ?? 0,
  };
}

/** Shuffled catalog minus the cards that are already somewhere else (an unknown map gives an empty pile). */
function freshDeck(
  state: LegacyGameState,
  rules: GameStateV3["rules"],
  hand: Record<PlayerId, CardId[]>,
  discard: CardId[],
  rng: Rng,
): CardId[] {
  const map = getMap(state.mapId);
  if (!map) return [];
  const used = new Set<CardId>([...Object.values(hand).flat(), ...discard]);
  return shuffle(
    cardCatalog(map, rules)
      .map((c) => c.id)
      .filter((id) => !used.has(id)),
    rng,
  );
}
