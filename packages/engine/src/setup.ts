import type { MapDefinition } from "./map/types.js";
import { cardCatalog } from "./cards.js";
import { getMissionSet } from "./maps/index.js";
import { validateMissions } from "./missions-validate.js";
import { cloneMission } from "./missions.js";
import { validateMap } from "./map/validate.js";
import { calculateReinforcements } from "./reinforcement.js";
import { shuffle } from "./shuffle.js";
import { STATE_VERSION } from "./state-version.js";
import { checkVictory } from "./victory.js";
import type {
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
}

export function createGame({ map, rules, playerIds, rng, missions }: CreateGameInput): SetupResult {
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
  if (rules.victoryMode === "missions") {
    if (!missionSet || !validateMissions(map, missionSet).ok) {
      return { ok: false, code: "INVALID_MISSIONS" };
    }
  }

  // Place each owner's remaining start armies on random own territories (players in seat order, then neutral).
  for (const owner of owners) {
    const own = ownedBy.get(owner)!;
    for (let left = startArmies - own.length; left > 0; left--) {
      territories[own[rng.int(own.length)]!]!.armies += 1;
    }
  }

  const start = rng.int(n);
  const playerOrder = [...playerIds.slice(start), ...playerIds.slice(0, start)];
  const firstPlayerId = playerOrder[0]!;
  const reinforcements = calculateReinforcements(map, rules, territories, firstPlayerId);
  // Shuffled last, so the Rng calls for the territory deal and the start player stay as before.
  const deck = shuffle(
    cardCatalog(map, rules).map((c) => c.id),
    rng,
  );

  // Missions are shuffled and dealt last, so the Rng calls above keep their order (rules.md 1.1).
  const dealt = missionSet ? dealMissions(missionSet, playerIds, rng) : undefined;

  const state: GameState = {
    mapId: map.id,
    rules,
    playerOrder,
    activePlayerId: firstPlayerId,
    phase: "reinforce",
    turn: 1,
    reinforcementsLeft: reinforcements,
    territories,
    secret: {
      mission: dealt?.mission ?? Object.fromEntries(playerIds.map((p) => [p, null])),
      originalMission:
        dealt?.originalMission ?? Object.fromEntries(playerIds.map((p) => [p, null])),
      missionReplaced:
        dealt?.missionReplaced ?? Object.fromEntries(playerIds.map((p) => [p, false])),
      hand: Object.fromEntries(playerIds.map((p) => [p, []])),
      deck,
      discard: [],
    },
    pendingOccupation: null,
    conqueredThisTurn: false,
    fortifyMovesDone: 0,
    winnerId: null,
    winReason: null,
    removedPlayerIds: [],
    stateVersion: STATE_VERSION,
    lastCombat: null,
    combatSeq: 0,
    lastTrade: null,
    tradeSeq: 0,
  };
  const events: GameEvent[] = [
    { type: "gameStarted", firstPlayerId },
    { type: "turnStarted", playerId: firstPlayerId, turn: 1, reinforcements },
  ];
  // Start of the first player's turn: same check as at every turn start (never wins with the map lists (checked for testland and welt)).
  return { ok: true, ...checkVictory(state, events) };
}

/**
 * Pool = map missions plus one `eliminatePlayer` per player (none with 2 players), shuffled; the i-th player in
 * seat order gets the i-th mission. Whoever draws the mission against themselves gets the fallback and
 * `missionReplaced`; `originalMission` keeps the drawn one (rules.md 1.1, question 22).
 */
function dealMissions(
  set: MissionSet,
  playerIds: PlayerId[],
  rng: Rng,
): {
  mission: Record<PlayerId, Mission>;
  originalMission: Record<PlayerId, Mission>;
  missionReplaced: Record<PlayerId, boolean>;
} {
  const pool: Mission[] = set.missions.map(cloneMission);
  if (playerIds.length > 2) {
    for (const p of playerIds) pool.push({ type: "eliminatePlayer", targetPlayerId: p });
  }
  const shuffled = shuffle(pool, rng);
  const mission: Record<PlayerId, Mission> = {};
  const originalMission: Record<PlayerId, Mission> = {};
  const missionReplaced: Record<PlayerId, boolean> = {};
  playerIds.forEach((p, i) => {
    const drawn = shuffled[i]!;
    const selfTarget = drawn.type === "eliminatePlayer" && drawn.targetPlayerId === p;
    originalMission[p] = cloneMission(drawn);
    mission[p] = selfTarget ? cloneMission(set.fallback) : drawn;
    missionReplaced[p] = selfTarget;
  });
  return { mission, originalMission, missionReplaced };
}
