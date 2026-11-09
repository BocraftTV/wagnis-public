import type { MapDefinition } from "./map/types.js";
import { cardCatalog } from "./cards.js";
import { getMissionSet } from "./maps/index.js";
import { validateMissions } from "./missions-validate.js";
import { cloneMission } from "./missions.js";
import { validateMap } from "./map/validate.js";
import { calculateReinforcements } from "./reinforcement.js";
import { shuffle } from "./shuffle.js";
import { STATE_VERSION } from "./state-version.js";
import { TEAM_IDS, teamMembers, teamSizes } from "./teams.js";
import { checkVictory } from "./victory.js";
import { drawWorldEvent, freshEventDeck } from "./world-events.js";
import type {
  TeamId,
  GameEvent,
  GameState,
  Mission,
  MissionSet,
  Owner,
  PlayerId,
  Rng,
  RuleConfig,
  SetupResult,
  TerritoryId,
  TerritoryState,
} from "./types.js";

const MAX_PLAYERS = 6;

export interface CreateGameInput {
  map: MapDefinition;
  rules: RuleConfig;
  /** Player ids in seat order. */
  playerIds: PlayerId[];
  rng: Rng;
  /** Missions of the map; defaults to `getMissionSet(map.id)`. Only used with `victoryMode: "missions"`. */
  missions?: MissionSet | undefined;
  /** Plan 014 C: who plays in which team; needed when `rules.teams` is set, ignored otherwise (rules.md 13). */
  teams?: Partial<Record<TeamId, PlayerId[]>> | undefined;
}

export function createGame({
  map,
  rules,
  playerIds,
  rng,
  missions,
  teams: teamInput,
}: CreateGameInput): SetupResult {
  if (!validateMap(map).ok) return { ok: false, code: "INVALID_MAP" };
  const n = playerIds.length;
  if (n < 2 || n > MAX_PLAYERS || new Set(playerIds).size !== n)
    return { ok: false, code: "INVALID_PLAYER_COUNT" };
  const startArmies = rules.startArmies[n];
  if (startArmies === undefined) return { ok: false, code: "INVALID_PLAYER_COUNT" };
  if (rules.initialPlacement !== "auto") return { ok: false, code: "UNSUPPORTED_PLACEMENT" };
  // With 2 players the territories are dealt to three owners: both players and the neutral owner.
  const owners: Owner[] = n === 2 ? [...playerIds, null] : playerIds;
  if (startArmies < Math.ceil(map.territories.length / owners.length))
    return { ok: false, code: "INVALID_RULES" };
  if (rules.fortifyMoves !== 1 && rules.fortifyMoves !== 2)
    return { ok: false, code: "INVALID_RULES" };
  if (typeof rules.missionDraft !== "boolean" || typeof rules.holdToWin !== "boolean")
    return { ok: false, code: "INVALID_RULES" };
  if (typeof rules.worldEvents !== "boolean") return { ok: false, code: "INVALID_RULES" };
  if (![null, 8, 12, 16].includes(rules.roundLimit as number | null))
    return { ok: false, code: "INVALID_RULES" };
  if (![null, "2v2", "3v3", "2v2v2"].includes(rules.teams as string | null))
    return { ok: false, code: "INVALID_RULES" };
  // Teams (plan 014 C): the layout must fit the mode and the number of players, everybody in exactly one team.
  let teams: Record<TeamId, PlayerId[]> | null = null;
  const sizes = teamSizes(rules.teams);
  if (sizes) {
    const given = TEAM_IDS.slice(0, sizes.length).map((id) => teamInput?.[id]);
    const flat = given.flat();
    const fits =
      n === sizes.reduce((a, b) => a + b, 0) &&
      given.every((members, i) => members !== undefined && members.length === sizes[i]) &&
      new Set(flat).size === n &&
      flat.every((p) => p !== undefined && playerIds.includes(p)) &&
      TEAM_IDS.every((id, i) => i < sizes.length || teamInput?.[id] === undefined);
    if (!fits) return { ok: false, code: "INVALID_TEAMS" };
    teams = Object.fromEntries(
      TEAM_IDS.slice(0, sizes.length).map((id, i) => [id, [...given[i]!]]),
    ) as Record<TeamId, PlayerId[]>;
  }
  // Below 5 cards a hand can lack a valid set, so a mandatory trade could get stuck (rules.md 6).
  if (!Number.isInteger(rules.cards.mustTradeAt) || rules.cards.mustTradeAt < 5)
    return { ok: false, code: "INVALID_RULES" };

  // Deal territories round-robin in seat order (neutral last), 1 army each.
  const territories: Record<TerritoryId, TerritoryState> = {};
  const ownedBy = new Map<Owner, TerritoryId[]>(owners.map((o) => [o, []]));
  shuffle(map.territories, rng).forEach((t, i) => {
    const owner = owners[i % owners.length]!;
    territories[t.id] = { ownerId: owner, armies: 1 };
    ownedBy.get(owner)!.push(t.id);
  });

  const missionSet =
    rules.victoryMode === "missions" ? (missions ?? getMissionSet(map.id)) : undefined;
  // The draft (two missions each, keep one) only exists in "missions" (rules.md 1.1).
  const draft = missionSet !== undefined && rules.missionDraft;
  if (rules.victoryMode === "missions") {
    if (!missionSet || !validateMissions(map, missionSet).ok) {
      return { ok: false, code: "INVALID_MISSIONS" };
    }
    // Two missions per player must come from the pool, none twice (rules.md 1.1).
    // In a team game the cards go to the teams, not the players.
    const holders = teams ? Object.keys(teams).length : n;
    if (draft && poolSize(missionSet, n, teams !== null) < 2 * holders)
      return { ok: false, code: "INVALID_MISSIONS" };
    if (teams && poolSize(missionSet, n, true) < holders)
      return { ok: false, code: "INVALID_MISSIONS" };
  }

  // Place each owner's remaining start armies on random own territories (players in seat order, then neutral).
  for (const owner of owners) {
    const own = ownedBy.get(owner)!;
    for (let left = startArmies - own.length; left > 0; left--) {
      territories[own[rng.int(own.length)]!]!.armies += 1;
    }
  }

  // Turn order: seat order, or in a team game alternating between the teams (A1, B1, A2, B2 ...) with a random
  // starting team (rules.md 13, question 55).
  let playerOrder: PlayerId[];
  if (teams) {
    const lists = Object.values(teams);
    const first = rng.int(lists.length);
    const rotated = [...lists.slice(first), ...lists.slice(0, first)];
    playerOrder = [];
    for (let i = 0; i < Math.max(...rotated.map((l) => l.length)); i++) {
      for (const l of rotated) if (l[i] !== undefined) playerOrder.push(l[i]!);
    }
  } else {
    const start = rng.int(n);
    playerOrder = [...playerIds.slice(start), ...playerIds.slice(0, start)];
  }
  const firstPlayerId = playerOrder[0]!;
  // Shuffled last, so the Rng calls for the territory deal and the start player stay as before.
  const deck = shuffle(
    cardCatalog(map, rules).map((c) => c.id),
    rng,
  );

  // Missions are shuffled and dealt last, so the Rng calls above keep their order (rules.md 1.1).
  const groups = teams ? Object.values(teams) : playerIds.map((p) => [p]);
  const dealt =
    missionSet && !draft ? dealMissions(missionSet, groups, rng, teams !== null) : undefined;
  const offers =
    missionSet && draft ? dealOffers(missionSet, groups, rng, teams !== null) : undefined;
  const none = <T>(value: T): Record<PlayerId, T> =>
    Object.fromEntries(playerIds.map((p) => [p, value]));

  // The event deck is shuffled after everything else, so the Rng calls of games without events stay as they were.
  const eventDeck = rules.worldEvents ? freshEventDeck(rng) : [];

  const initial: GameState = {
    mapId: map.id,
    rules,
    playerOrder,
    activePlayerId: firstPlayerId,
    phase: draft ? "missionChoice" : "reinforce",
    turn: 1,
    round: 1,
    reinforcementsLeft: 0,
    territories,
    secret: {
      mission: dealt?.mission ?? Object.fromEntries(playerIds.map((p) => [p, null])),
      originalMission:
        dealt?.originalMission ?? Object.fromEntries(playerIds.map((p) => [p, null])),
      missionReplaced:
        dealt?.missionReplaced ?? Object.fromEntries(playerIds.map((p) => [p, false])),
      missionOffer: offers?.offer ?? none(null),
      missionOfferDealt: offers?.dealt ?? none(null),
      discardedMission: none(null),
      victoryPending: none(false),
      hand: Object.fromEntries(playerIds.map((p) => [p, []])),
      eventDeck,
      deck,
      discard: [],
    },
    pendingOccupation: null,
    conqueredThisTurn: false,
    conquestsThisTurn: 0,
    fortifyMovesDone: 0,
    winnerId: null,
    winReason: null,
    winnerIds: [],
    worldEvent: null,
    teams,
    winnerTeamId: null,
    removedPlayerIds: [],
    stateVersion: STATE_VERSION,
    lastCombat: null,
    combatSeq: 0,
    lastTrade: null,
    tradeSeq: 0,
  };
  // The event of round 1 is drawn at the start (also with the draft: it then stands during the choice), before the
  // first reinforcements are worked out, so goldRush and mobilize count for the first player too.
  const drawn = drawWorldEvent(initial, rng);
  const state: GameState = {
    ...drawn.state,
    reinforcementsLeft: draft
      ? 0
      : calculateReinforcements(
          map,
          rules,
          drawn.state.territories,
          firstPlayerId,
          drawn.state.worldEvent,
          teamMembers(drawn.state, firstPlayerId),
        ),
  };
  // With the draft the first turn only starts once everybody has chosen (`startFirstTurn`, mission-choice.ts).
  if (draft)
    return {
      ok: true,
      state,
      events: [{ type: "gameStarted", firstPlayerId }, ...drawn.events],
    };
  const events: GameEvent[] = [
    { type: "gameStarted", firstPlayerId },
    { type: "roundStarted", round: 1 },
    ...drawn.events,
    {
      type: "turnStarted",
      playerId: firstPlayerId,
      turn: 1,
      reinforcements: state.reinforcementsLeft,
    },
  ];
  // Start of the first player's turn: same check as at every turn start (never wins with the map lists (checked for testland and welt)).
  return { ok: true, ...checkVictory(state, events) };
}

/**
 * Pool = map missions plus one `eliminatePlayer` per player (none with 2 players, none in a team game), shuffled; the
 * i-th group (a single player in seat order, or a team) gets the i-th mission. Whoever draws the mission against
 * themselves gets the fallback and `missionReplaced`; `originalMission` keeps the drawn one (rules.md 1.1, question 22).
 * Every member of a team gets the team's mission (rules.md 13, question 56).
 */
function dealMissions(
  set: MissionSet,
  groups: PlayerId[][],
  rng: Rng,
  teamGame: boolean,
): {
  mission: Record<PlayerId, Mission>;
  originalMission: Record<PlayerId, Mission>;
  missionReplaced: Record<PlayerId, boolean>;
} {
  const players = groups.flat();
  const pool: Mission[] = set.missions.map(cloneMission);
  if (players.length > 2 && !teamGame) {
    for (const p of players) pool.push({ type: "eliminatePlayer", targetPlayerId: p });
  }
  const shuffled = shuffle(pool, rng);
  const mission: Record<PlayerId, Mission> = {};
  const originalMission: Record<PlayerId, Mission> = {};
  const missionReplaced: Record<PlayerId, boolean> = {};
  groups.forEach((members, i) => {
    const drawn = shuffled[i]!;
    for (const p of members) {
      const selfTarget = drawn.type === "eliminatePlayer" && drawn.targetPlayerId === p;
      originalMission[p] = cloneMission(drawn);
      mission[p] = selfTarget ? cloneMission(set.fallback) : cloneMission(drawn);
      missionReplaced[p] = selfTarget;
    }
  });
  return { mission, originalMission, missionReplaced };
}

/** Missions in the pool: the map's own plus one `eliminatePlayer` per player (none with 2 players or in a team game). */
function poolSize(set: MissionSet, playerCount: number, teamGame = false): number {
  return set.missions.length + (playerCount > 2 && !teamGame ? playerCount : 0);
}

/**
 * The draft deal: the same pool and shuffle as `dealMissions`, but every group gets two (the i-th group gets the
 * cards 2i and 2i+1). A self target in an offer is shown as the fallback, as in the plain deal (rules.md 1.1,
 * question 43); `dealt` keeps the cards as drawn. Team mates get the same two cards (rules.md 13).
 */
function dealOffers(
  set: MissionSet,
  groups: PlayerId[][],
  rng: Rng,
  teamGame: boolean,
): {
  offer: Record<PlayerId, [Mission, Mission]>;
  dealt: Record<PlayerId, [Mission, Mission]>;
} {
  const players = groups.flat();
  const pool: Mission[] = set.missions.map(cloneMission);
  if (players.length > 2 && !teamGame) {
    for (const p of players) pool.push({ type: "eliminatePlayer", targetPlayerId: p });
  }
  const shuffled = shuffle(pool, rng);
  const offer: Record<PlayerId, [Mission, Mission]> = {};
  const dealt: Record<PlayerId, [Mission, Mission]> = {};
  groups.forEach((members, i) => {
    const drawn: [Mission, Mission] = [shuffled[2 * i]!, shuffled[2 * i + 1]!];
    for (const p of members) {
      const shown = (m: Mission): Mission =>
        m.type === "eliminatePlayer" && m.targetPlayerId === p ? cloneMission(set.fallback) : m;
      dealt[p] = [cloneMission(drawn[0]), cloneMission(drawn[1])];
      offer[p] = [cloneMission(shown(drawn[0])), cloneMission(shown(drawn[1]))];
    }
  });
  return { offer, dealt };
}
