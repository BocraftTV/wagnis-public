import { cardCatalog } from "./cards.js";
import { testland } from "./maps/testland.map.js";
import { STATE_VERSION } from "./state-version.js";
import { testlandRules } from "./rules/testland.rules.js";
import type { GameState, Mission, Owner, Phase, PlayerId, TerritoryId } from "./types.js";

export interface StateSpec {
  /** `[ownerId, armies]` per territory; unlisted territories belong to `fill` with 1 army. */
  territories: Record<TerritoryId, [Owner, number]>;
  players?: PlayerId[] | undefined;
  /** Owner of unlisted territories; defaults to the second player. */
  fill?: Owner | undefined;
  phase?: Phase | undefined;
  active?: PlayerId | undefined;
  overrides?: Partial<GameState> | undefined;
  /** Fortify moves per turn (rules.md 5.3); defaults to 1. */
  fortifyMoves?: 1 | 2 | undefined;
}

/** Hand-built testland state for rule tests: attack phase, first player active. */
export function makeState(spec: StateSpec): GameState {
  const players = spec.players ?? ["a", "b"];
  const fill = spec.fill === undefined ? players[1]! : spec.fill;
  const territories: GameState["territories"] = {};
  for (const t of testland.territories) {
    const [ownerId, armies] = spec.territories[t.id] ?? [fill, 1];
    territories[t.id] = { ownerId, armies };
  }
  return {
    mapId: testland.id,
    rules:
      spec.fortifyMoves === undefined
        ? testlandRules
        : { ...testlandRules, fortifyMoves: spec.fortifyMoves },
    playerOrder: players,
    activePlayerId: spec.active ?? players[0]!,
    phase: spec.phase ?? "attack",
    turn: 1,
    round: 1,
    reinforcementsLeft: 0,
    territories,
    secret: {
      mission: Object.fromEntries(players.map((p) => [p, null])),
      originalMission: Object.fromEntries(players.map((p) => [p, null])),
      missionReplaced: Object.fromEntries(players.map((p) => [p, false])),
      missionOffer: Object.fromEntries(players.map((p) => [p, null])),
      missionOfferDealt: Object.fromEntries(players.map((p) => [p, null])),
      discardedMission: Object.fromEntries(players.map((p) => [p, null])),
      victoryPending: Object.fromEntries(players.map((p) => [p, false])),
      hand: Object.fromEntries(players.map((p) => [p, []])),
      deck: cardCatalog(testland, testlandRules).map((c) => c.id),
      discard: [],
    },
    pendingOccupation: null,
    conqueredThisTurn: false,
    conquestsThisTurn: 0,
    fortifyMovesDone: 0,
    winnerId: null,
    winReason: null,
    winnerIds: [],
    removedPlayerIds: [],
    stateVersion: STATE_VERSION,
    lastCombat: null,
    combatSeq: 0,
    lastTrade: null,
    tradeSeq: 0,
    ...spec.overrides,
  };
}

export const totalArmies = (state: GameState): number =>
  Object.values(state.territories).reduce((sum, t) => sum + t.armies, 0);

/** Sets hands, deck and discard pile directly (card ids), leaving everything else as it is. */
export function withCards(
  state: GameState,
  cards: { hand?: Record<PlayerId, string[]>; deck?: string[]; discard?: string[] },
): GameState {
  return {
    ...state,
    secret: {
      ...state.secret,
      hand: { ...state.secret.hand, ...cards.hand },
      deck: cards.deck ?? state.secret.deck,
      discard: cards.discard ?? state.secret.discard,
    },
  };
}

/** Sets the current and the original mission of the listed players (not replaced); others stay as they are. */
export function withMissions(
  state: GameState,
  missions: Record<PlayerId, Mission | null>,
): GameState {
  return {
    ...state,
    secret: {
      ...state.secret,
      mission: { ...state.secret.mission, ...missions },
      originalMission: { ...state.secret.originalMission, ...missions },
    },
  };
}

export interface S3Spec {
  phase?: Phase;
  /** Hand sizes (default a 5, b 2, c 0), discard pile size (default 1); the rest of the 10 testland cards is the deck. */
  hands?: { a: number; b: number; c: number };
  discard?: number;
  missions?: Record<"a" | "b" | "c", Mission | null>;
  overrides?: Partial<GameState>;
}

/**
 * Plan 007, section 6, scenario S3 (3 players, turn 7, `a` active in `reinforce` with 3 reinforcements): a holds
 * eisenfurt 3, rabenhain 4, grauwacht 5; b holds tannenfeld 2, salzmoor 1, dornental 3; c holds kupferstadt 4,
 * nebelkueste 2. testland has only 10 cards (8 territories + 2 jokers), so the plan's sizes (deck 20, ...) are
 * scaled: cards are dealt from the catalog order, hands first, then the discard pile, the rest is the deck.
 * Missions: a eliminates b, b holds 5 territories with 2 armies, c holds 4 with 3 (by default).
 */
export function scenarioS3(spec: S3Spec = {}): GameState {
  const hands = spec.hands ?? { a: 5, b: 2, c: 0 };
  const all = cardCatalog(testland, testlandRules).map((c) => c.id);
  const take = (from: number, n: number): string[] => all.slice(from, from + n);
  const discard = spec.discard ?? 1;
  const used = hands.a + hands.b + hands.c;
  const state = makeState({
    players: ["a", "b", "c"],
    phase: spec.phase ?? "reinforce",
    territories: {
      eisenfurt: ["a", 3],
      rabenhain: ["a", 4],
      grauwacht: ["a", 5],
      tannenfeld: ["b", 2],
      salzmoor: ["b", 1],
      dornental: ["b", 3],
      kupferstadt: ["c", 4],
      nebelkueste: ["c", 2],
    },
    overrides: { turn: 7, reinforcementsLeft: 3, ...spec.overrides },
  });
  const missions = spec.missions ?? {
    a: { type: "eliminatePlayer", targetPlayerId: "b" },
    b: { type: "holdTerritories", count: 5, minArmies: 2 },
    c: { type: "holdTerritories", count: 4, minArmies: 3 },
  };
  return withMissions(
    withCards(state, {
      hand: {
        a: take(0, hands.a),
        b: take(hands.a, hands.b),
        c: take(hands.a + hands.b, hands.c),
      },
      discard: take(used, discard),
      deck: all.slice(used + discard),
    }),
    missions,
  );
}
