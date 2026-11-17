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
  SecretState,
  SetupErrorCode,
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
  const checked = checkSetup(map, rules, playerIds, teamInput);
  if (!checked.ok) return checked;
  const { startArmies, owners, teams } = checked;
  // The order of the Rng calls below is part of the result (same seed, same game): territories, start armies,
  // turn order, card deck, missions, event deck, event of round 1.
  const { territories, ownedBy } = dealTerritories(map, owners, rng);
  const missionSet =
    rules.victoryMode === "missions" ? (missions ?? getMissionSet(map.id)) : undefined;
  // The draft (two missions each, keep one) only exists in "missions" (rules.md 1.1).
  const draft = missionSet !== undefined && rules.missionDraft;
  if (
    rules.victoryMode === "missions" &&
    !missionsFit(map, missionSet, draft, playerIds.length, teams)
  )
    return { ok: false, code: "INVALID_MISSIONS" };
  placeStartArmies(territories, ownedBy, owners, startArmies, rng);
  const playerOrder = turnOrder(playerIds, teams, rng);
  // Shuffled after the territory deal and the start player, so their Rng calls stay as before.
  const deck = shuffle(
    cardCatalog(map, rules).map((c) => c.id),
    rng,
  );
  // Missions are shuffled and dealt last, so the Rng calls above keep their order (rules.md 1.1).
  const secretMissions = dealAll(missionSet, draft, playerIds, teams, rng);
  // The event deck is shuffled after everything else, so the Rng calls of games without events stay as they were.
  const eventDeck = rules.worldEvents ? freshEventDeck(rng) : [];
  const initial = initialState(map, rules, playerOrder, playerIds, territories, teams, draft, {
    ...secretMissions,
    eventDeck,
    deck,
  });
  return firstTurn(map, initial, draft, rng);
}

type Checked =
  | { ok: true; startArmies: number; owners: Owner[]; teams: Record<TeamId, PlayerId[]> | null }
  | { ok: false; code: SetupErrorCode };

/** Every check that needs no Rng, in the order the codes are answered. */
function checkSetup(
  map: MapDefinition,
  rules: RuleConfig,
  playerIds: PlayerId[],
  teamInput: CreateGameInput["teams"],
): Checked {
  if (!validateMap(map).ok) return { ok: false, code: "INVALID_MAP" };
  const n = playerIds.length;
  if (n < 2 || n > MAX_PLAYERS || new Set(playerIds).size !== n)
    return { ok: false, code: "INVALID_PLAYER_COUNT" };
  const startArmies = rules.startArmies[n];
  if (startArmies === undefined) return { ok: false, code: "INVALID_PLAYER_COUNT" };
  if (rules.initialPlacement !== "auto") return { ok: false, code: "UNSUPPORTED_PLACEMENT" };
  // With 2 players the territories are dealt to three owners: both players and the neutral owner.
  const owners: Owner[] = n === 2 ? [...playerIds, null] : playerIds;
  if (!rulesFit(rules, startArmies, Math.ceil(map.territories.length / owners.length)))
    return { ok: false, code: "INVALID_RULES" };
  const teams = resolveTeams(rules.teams, playerIds, teamInput);
  if (teams === "INVALID_TEAMS") return { ok: false, code: "INVALID_TEAMS" };
  // Below 5 cards a hand can lack a valid set, so a mandatory trade could get stuck (rules.md 6).
  if (!Number.isInteger(rules.cards.mustTradeAt) || rules.cards.mustTradeAt < 5)
    return { ok: false, code: "INVALID_RULES" };
  return { ok: true, startArmies, owners, teams };
}

/** The `INVALID_RULES` checks before the teams: start armies, fortify moves and the lobby options. */
function rulesFit(rules: RuleConfig, startArmies: number, minStartArmies: number): boolean {
  return (
    startArmies >= minStartArmies &&
    (rules.fortifyMoves === 1 || rules.fortifyMoves === 2) &&
    typeof rules.missionDraft === "boolean" &&
    typeof rules.holdToWin === "boolean" &&
    typeof rules.worldEvents === "boolean" &&
    [null, 8, 12, 16].includes(rules.roundLimit as number | null) &&
    [null, "2v2", "3v3", "2v2v2"].includes(rules.teams as string | null)
  );
}

/**
 * Teams (plan 014 C): the layout must fit the mode and the number of players, everybody in exactly one team.
 * `null` without teams.
 */
function resolveTeams(
  mode: RuleConfig["teams"],
  playerIds: PlayerId[],
  teamInput: CreateGameInput["teams"],
): Record<TeamId, PlayerId[]> | null | "INVALID_TEAMS" {
  const sizes = teamSizes(mode);
  if (!sizes) return null;
  const n = playerIds.length;
  const given = TEAM_IDS.slice(0, sizes.length).map((id) => teamInput?.[id]);
  const flat = given.flat();
  const fits =
    n === sizes.reduce((a, b) => a + b, 0) &&
    given.every((members, i) => members !== undefined && members.length === sizes[i]) &&
    new Set(flat).size === n &&
    flat.every((p) => p !== undefined && playerIds.includes(p)) &&
    TEAM_IDS.every((id, i) => i < sizes.length || teamInput?.[id] === undefined);
  if (!fits) return "INVALID_TEAMS";
  return Object.fromEntries(
    TEAM_IDS.slice(0, sizes.length).map((id, i) => [id, [...given[i]!]]),
  ) as Record<TeamId, PlayerId[]>;
}

/** Deals the territories round-robin in seat order (neutral last), 1 army each. */
function dealTerritories(
  map: MapDefinition,
  owners: Owner[],
  rng: Rng,
): { territories: Record<TerritoryId, TerritoryState>; ownedBy: Map<Owner, TerritoryId[]> } {
  const territories: Record<TerritoryId, TerritoryState> = {};
  const ownedBy = new Map<Owner, TerritoryId[]>(owners.map((o) => [o, []]));
  shuffle(map.territories, rng).forEach((t, i) => {
    const owner = owners[i % owners.length]!;
    territories[t.id] = { ownerId: owner, armies: 1 };
    ownedBy.get(owner)!.push(t.id);
  });
  return { territories, ownedBy };
}

/**
 * The map's missions must be valid; with the draft two per holder must come from the pool, none twice (rules.md
 * 1.1). In a team game the cards go to the teams, not the players.
 */
function missionsFit(
  map: MapDefinition,
  set: MissionSet | undefined,
  draft: boolean,
  n: number,
  teams: Record<TeamId, PlayerId[]> | null,
): boolean {
  if (!set || !validateMissions(map, set).ok) return false;
  const holders = teams ? Object.keys(teams).length : n;
  if (draft && poolSize(set, n, teams !== null) < 2 * holders) return false;
  return !(teams && poolSize(set, n, true) < holders);
}

/** Places each owner's remaining start armies on random own territories (players in seat order, then neutral). */
function placeStartArmies(
  territories: Record<TerritoryId, TerritoryState>,
  ownedBy: Map<Owner, TerritoryId[]>,
  owners: Owner[],
  startArmies: number,
  rng: Rng,
): void {
  for (const owner of owners) {
    const own = ownedBy.get(owner)!;
    for (let left = startArmies - own.length; left > 0; left--) {
      territories[own[rng.int(own.length)]!]!.armies += 1;
    }
  }
}

/**
 * Turn order: seat order from a random start, or in a team game alternating between the teams (A1, B1, A2, B2 ...)
 * with a random starting team (rules.md 13, question 55).
 */
function turnOrder(
  playerIds: PlayerId[],
  teams: Record<TeamId, PlayerId[]> | null,
  rng: Rng,
): PlayerId[] {
  if (!teams) {
    const start = rng.int(playerIds.length);
    return [...playerIds.slice(start), ...playerIds.slice(0, start)];
  }
  const lists = Object.values(teams);
  const first = rng.int(lists.length);
  const rotated = [...lists.slice(first), ...lists.slice(0, first)];
  const order: PlayerId[] = [];
  for (let i = 0; i < Math.max(...rotated.map((l) => l.length)); i++) {
    for (const l of rotated) if (l[i] !== undefined) order.push(l[i]!);
  }
  return order;
}

const everyone = <T>(playerIds: PlayerId[], value: T): Record<PlayerId, T> =>
  Object.fromEntries(playerIds.map((p) => [p, value]));

type DealtMissions = Pick<
  SecretState,
  "mission" | "originalMission" | "missionReplaced" | "missionOffer" | "missionOfferDealt"
>;

/** The secret mission fields at the start: dealt, offered (draft) or empty ("domination"). */
function dealAll(
  set: MissionSet | undefined,
  draft: boolean,
  playerIds: PlayerId[],
  teams: Record<TeamId, PlayerId[]> | null,
  rng: Rng,
): DealtMissions {
  const groups = teams ? Object.values(teams) : playerIds.map((p) => [p]);
  const dealt = set && !draft ? dealMissions(set, groups, rng, teams !== null) : undefined;
  const offers = set && draft ? dealOffers(set, groups, rng, teams !== null) : undefined;
  return {
    mission: dealt?.mission ?? everyone(playerIds, null),
    originalMission: dealt?.originalMission ?? everyone(playerIds, null),
    missionReplaced: dealt?.missionReplaced ?? everyone(playerIds, false),
    missionOffer: offers?.offer ?? everyone(playerIds, null),
    missionOfferDealt: offers?.dealt ?? everyone(playerIds, null),
  };
}

function initialState(
  map: MapDefinition,
  rules: RuleConfig,
  playerOrder: PlayerId[],
  playerIds: PlayerId[],
  territories: Record<TerritoryId, TerritoryState>,
  teams: Record<TeamId, PlayerId[]> | null,
  draft: boolean,
  secret: DealtMissions & Pick<SecretState, "eventDeck" | "deck">,
): GameState {
  return {
    mapId: map.id,
    rules,
    playerOrder,
    activePlayerId: playerOrder[0]!,
    phase: draft ? "missionChoice" : "reinforce",
    turn: 1,
    round: 1,
    reinforcementsLeft: 0,
    territories,
    secret: {
      mission: secret.mission,
      originalMission: secret.originalMission,
      missionReplaced: secret.missionReplaced,
      missionOffer: secret.missionOffer,
      missionOfferDealt: secret.missionOfferDealt,
      discardedMission: everyone(playerIds, null),
      victoryPending: everyone(playerIds, false),
      hand: Object.fromEntries(playerIds.map((p) => [p, []])),
      eventDeck: secret.eventDeck,
      deck: secret.deck,
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
}

/**
 * The event of round 1 is drawn at the start (also with the draft: it then stands during the choice), before the
 * first reinforcements are worked out, so goldRush and mobilize count for the first player too. With the draft the
 * first turn only starts once everybody has chosen (`startFirstTurn`, mission-choice.ts).
 */
function firstTurn(map: MapDefinition, initial: GameState, draft: boolean, rng: Rng): SetupResult {
  const firstPlayerId = initial.activePlayerId;
  const drawn = drawWorldEvent(initial, rng);
  const state: GameState = {
    ...drawn.state,
    reinforcementsLeft: draft
      ? 0
      : calculateReinforcements(
          map,
          initial.rules,
          drawn.state.territories,
          firstPlayerId,
          drawn.state.worldEvent,
          teamMembers(drawn.state, firstPlayerId),
        ),
  };
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
  // Start of the first player's turn: the same check as at every turn start (with the map lists it never wins
  // here; checked for testland and welt).
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
  const shuffled = shuffle(missionPool(set, groups.flat(), teamGame), rng);
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

/** The unshuffled pool: the map's missions plus one `eliminatePlayer` per player (none with 2 players or in a team game). */
function missionPool(set: MissionSet, players: PlayerId[], teamGame: boolean): Mission[] {
  const pool: Mission[] = set.missions.map(cloneMission);
  if (players.length > 2 && !teamGame) {
    for (const p of players) pool.push({ type: "eliminatePlayer", targetPlayerId: p });
  }
  return pool;
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
  const shuffled = shuffle(missionPool(set, groups.flat(), teamGame), rng);
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
