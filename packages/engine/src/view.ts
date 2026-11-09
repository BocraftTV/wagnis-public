import { cardCatalog, findSuggestedSets, mustTrade } from "./cards.js";
import { fortifyView } from "./fortify.js";
import { getMap } from "./maps/index.js";
import type {
  Card,
  CombatRecord,
  GameState,
  GameView,
  HandCard,
  Mission,
  MissionReveal,
  PlayerId,
  SecretView,
  TradeRecord,
} from "./types.js";

const maxAttackDice = (armies: number): number => Math.max(0, Math.min(3, armies - 1));

const copyCard = (c: Card): Card => ({ id: c.id, kind: c.kind, territoryId: c.territoryId });

/** Copies the combat record field by field, so the view shares no references with the state and adds nothing unknown. */
const copyCombat = (c: CombatRecord): CombatRecord => ({
  seq: c.seq,
  attackerId: c.attackerId,
  defenderId: c.defenderId,
  from: c.from,
  to: c.to,
  rolls: c.rolls.map((r) => ({
    attackerDice: [...r.attackerDice],
    defenderDice: [...r.defenderDice],
    attackerLosses: r.attackerLosses,
    defenderLosses: r.defenderLosses,
  })),
  summary: {
    rollCount: c.summary.rollCount,
    attackerLosses: c.summary.attackerLosses,
    defenderLosses: c.summary.defenderLosses,
    conquered: c.summary.conquered,
  },
});

/** Same for the trade record: the discarded cards are public, nothing else is added. */
const copyTrade = (t: TradeRecord): TradeRecord => ({
  seq: t.seq,
  playerId: t.playerId,
  cards: t.cards.map(copyCard),
  armies: t.armies,
  bonusTerritoryId: t.bonusTerritoryId,
});

/** Field-by-field copy of a mission: the view shares no references with the state and adds nothing unknown. */
function copyMission(m: Mission): Mission {
  switch (m.type) {
    case "conquerContinents":
      return {
        type: "conquerContinents",
        continentIds: [...m.continentIds],
        extraContinents: m.extraContinents,
      };
    case "holdTerritories":
      return { type: "holdTerritories", count: m.count, minArmies: m.minArmies };
    case "eliminatePlayer":
      return { type: "eliminatePlayer", targetPlayerId: m.targetPlayerId };
  }
}

/**
 * The resolution of all missions after the game. The ONLY place that builds `missions`: nothing is revealed
 * while `winnerId` is null. Per player the current mission and, if it was replaced, the one as dealt.
 */
function revealMissions(state: GameState): Record<PlayerId, MissionReveal> | null {
  if (state.winnerId === null) return null;
  if (state.rules.victoryMode !== "missions") return null;
  const out: Record<PlayerId, MissionReveal> = {};
  for (const p of state.playerOrder) {
    // A removed player is not part of the resolution (rules.md 1.6, 7)
    if (state.removedPlayerIds.includes(p)) continue;
    const mission = state.secret.mission[p];
    if (!mission) continue;
    const original = state.secret.originalMission[p];
    out[p] = {
      mission: copyMission(mission),
      originalMission: state.secret.missionReplaced[p] && original ? copyMission(original) : null,
    };
  }
  return out;
}

/**
 * The viewer's own secrets, field by field. The deck and the discard pile are never read here, and the
 * hands of others are not either.
 */
function secretFor(state: GameState, playerId: PlayerId): SecretView {
  // A removed player (their token is worthless anyway) gets nothing: no mission, no hand, no suggestions
  if (state.removedPlayerIds.includes(playerId)) {
    return { mission: null, missionReplaced: false, hand: [], suggestedSets: [], mustTrade: false };
  }
  const map = getMap(state.mapId);
  const catalog = new Map(map ? cardCatalog(map, state.rules).map((c) => [c.id, c]) : []);
  const own = state.secret.hand[playerId] ?? [];
  const inReinforce =
    state.winnerId === null && playerId === state.activePlayerId && state.phase === "reinforce";
  const mission = state.secret.mission[playerId];
  return {
    mission: mission ? copyMission(mission) : null,
    missionReplaced: state.secret.missionReplaced[playerId] ?? false,
    hand: own.flatMap((id): HandCard[] => {
      const card = catalog.get(id);
      if (!card) return [];
      const shown = card.territoryId;
      const bonusEligible = shown !== null && state.territories[shown]?.ownerId === playerId;
      return [{ ...copyCard(card), bonusEligible }];
    }),
    suggestedSets: inReinforce
      ? findSuggestedSets(state, playerId, catalog).map((o) => ({
          cardIds: [...o.cardIds],
          value: o.value,
          bonusTerritoryId: o.bonusTerritoryId,
        }))
      : [],
    mustTrade: mustTrade(state, playerId),
  };
}

/** The only thing that may leave the server: state as seen by one player. */
export function viewFor(state: GameState, playerId: PlayerId): GameView {
  const pending = state.pendingOccupation;
  const map = getMap(state.mapId);
  return {
    mapId: state.mapId,
    phase: state.phase,
    turn: state.turn,
    activePlayerId: state.activePlayerId,
    playerOrder: [...state.playerOrder],
    removedPlayerIds: [...state.removedPlayerIds],
    reinforcementsLeft: state.reinforcementsLeft,
    territories: Object.fromEntries(
      Object.entries(state.territories).map(([id, t]) => [
        id,
        {
          ownerId: t.ownerId,
          armies: t.armies,
          maxAttackDice: maxAttackDice(t.armies),
          maxMove: Math.max(0, t.armies - 1),
        },
      ]),
    ),
    pendingOccupation: pending
      ? {
          from: pending.from,
          to: pending.to,
          min: pending.min,
          max: pending.min + Math.max(0, (state.territories[pending.from]?.armies ?? 1) - 1),
        }
      : null,
    conqueredThisTurn: state.conqueredThisTurn,
    winnerId: state.winnerId,
    winReason: state.winReason,
    victoryMode: state.rules.victoryMode,
    missions: revealMissions(state),
    lastCombat: state.lastCombat ? copyCombat(state.lastCombat) : null,
    lastTrade: state.lastTrade ? copyTrade(state.lastTrade) : null,
    deckCount: state.secret.deck.length,
    discardCount: state.secret.discard.length,
    fortify:
      map &&
      state.winnerId === null &&
      playerId === state.activePlayerId &&
      state.phase === "fortify"
        ? fortifyView(map, state, playerId)
        : null,
    secret: secretFor(state, playerId),
    handCounts: Object.fromEntries(
      state.playerOrder.map((p) => [p, (state.secret.hand[p] ?? []).length]),
    ),
  };
}
