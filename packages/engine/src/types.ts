export type PlayerId = string;
export type TerritoryId = string;
export type ContinentId = string;

/** Injected source of randomness. The engine never creates its own. */
export interface Rng {
  /** Uniform integer in [0, maxExclusive). */
  int(maxExclusive: number): number;
}

export type CardKind = "infantry" | "cavalry" | "artillery" | "joker";
/** `card-<territoryId>` for territory cards, `card-joker-<n>` for jokers. */
export type CardId = string;

/** Static card data derived from the map (see `cardCatalog`); the state only holds ids. */
export interface Card {
  id: CardId;
  kind: CardKind;
  /** The territory the card shows; null for jokers. */
  territoryId: TerritoryId | null;
}

export interface CardRules {
  /** Jokers in the deck. */
  jokers: number;
  /** Armies per set; `mixed` is one card of each kind. */
  tradeValues: { infantry: number; cavalry: number; artillery: number; mixed: number };
  /** Extra armies placed directly on one own territory shown by a traded card. */
  territoryBonus: number;
  /** Hand size from which trading is mandatory in the reinforce phase; at least 5. */
  mustTradeAt: number;
}

/** Owner of a territory: a player, or `null` for the neutral owner (rules.md 1.3: at the start with 2 players, with any number after the host removes a player). */
export type Owner = PlayerId | null;

export type VictoryMode = "missions" | "domination";
export type WinReason = "lastPlayer" | "mission" | "roundLimit";

/** Secret win condition (rules.md 1.1). Data only; the texts are made by the client. */
export type Mission =
  | { type: "conquerContinents"; continentIds: ContinentId[]; extraContinents: number }
  | { type: "holdTerritories"; count: number; minArmies: number }
  | { type: "eliminatePlayer"; targetPlayerId: PlayerId }
  /** At least `count` own territories that form one connected group over the map's neighbours (land or sea). */
  | { type: "connectedRealm"; count: number }
  /** At least `count` conquests in one attack phase of the holder's own turn. */
  | { type: "blitzkrieg"; count: number };

/** Missions of one map (own file next to the `MapDefinition`). */
export interface MissionSet {
  /** Map missions; `eliminatePlayer` entries come from the players at game start, not from here. */
  missions: Mission[];
  /** Replacement mission (self target at the start, target eliminated by a third player). */
  fallback: Extract<Mission, { type: "holdTerritories" }>;
}

export interface RuleConfig {
  /** Total armies per player by player count (including the 1 army per territory at start). */
  startArmies: Record<number, number>;
  minReinforcement: number;
  territoryDivisor: number;
  initialPlacement: "auto" | "manual";
  /** `connected`: any chain of own territories; `adjacent`: direct neighbours only. */
  fortifyReach: "connected" | "adjacent";
  /** Fortify moves per turn: 1 ends the turn after the first, 2 allows up to two (rules.md 5.3). Lobby choice of the host. */
  fortifyMoves: 1 | 2;
  cards: CardRules;
  /** `"missions"` (default): secret missions; `"domination"`: no missions, the last player wins. */
  victoryMode: VictoryMode;
  /** Plan 013: every player gets two missions and keeps one, chosen in phase `missionChoice` (rules.md 1.1). Only in `"missions"`. */
  missionDraft: boolean;
  /** Plan 013: a met mission only wins at the start of the holder's next turn (rules.md 1.2). Only in `"missions"`. */
  holdToWin: boolean;
  /** Plan 014 (A): after this many rounds the game is scored; `null` means no limit. Lobby choice of the host (rules.md 11). */
  roundLimit: RoundLimit;
  /** Plan 014 B: a world event is drawn at the start of every round (rules.md 12). Lobby choice of the host. */
  worldEvents: boolean;
  /** Plan 014 C: teams (rules.md 13). Only with the matching player count; the lobby choice of the host. */
  teams: TeamMode;
}

/** Team layout chosen in the lobby (plan 014 C, rules.md 13); `null` is off. */
export type TeamMode = null | "2v2" | "3v3" | "2v2v2";
export type TeamId = "A" | "B" | "C";

export type WorldEventKind =
  "storm" | "goldRush" | "plague" | "mobilize" | "truce" | "rebellion" | "cardFlood" | "fog";

/** The event of the current round (public). The fields are empty where the kind has no use for them. */
export interface WorldEvent {
  kind: WorldEventKind;
  /** The continent that goldRush, plague and truce hit; otherwise null. */
  continentId: ContinentId | null;
  /** Rebellion: the players who lost territories; otherwise empty. */
  playerIds: PlayerId[];
  /** Rebellion: the territories that went neutral; otherwise empty. */
  territoryIds: TerritoryId[];
}

/** Offered round limits (rules.md 11, question 50); `null` is off. */
export type RoundLimit = null | 8 | 12 | 16;

export type Phase = "missionChoice" | "reinforce" | "attack" | "fortify";

export interface TerritoryState {
  ownerId: Owner;
  armies: number;
}

export interface SecretState {
  /** Current mission; null in `"domination"`. Replaced by the fallback, never shown to others. */
  mission: Record<PlayerId, Mission | null>;
  /** Mission as dealt; never changes. Only revealed after the game (rules.md 1.1, question 20). */
  originalMission: Record<PlayerId, Mission | null>;
  /** True once the mission was replaced by the fallback. Own view only. */
  missionReplaced: Record<PlayerId, boolean>;
  /** The two missions on offer while `phase` is "missionChoice"; null once chosen (and outside the draft). Own view only. */
  missionOffer: Record<PlayerId, [Mission, Mission] | null>;
  /** The two missions as drawn (self targets not yet replaced); the other half of the offer. Internal, never in a view. */
  missionOfferDealt: Record<PlayerId, [Mission, Mission] | null>;
  /** The mission put away face down; revealed after the game only. Null without the draft. */
  discardedMission: Record<PlayerId, Mission | null>;
  /** Hold-to-win marker: the mission was met at the end of the holder's own turn. Internal; own view only. */
  victoryPending: Record<PlayerId, boolean>;
  hand: Record<PlayerId, CardId[]>;
  /** Plan 014 B: the world event cards still to be drawn, `[0]` is the top. Never leaves the server. */
  eventDeck: WorldEventKind[];
  /** Draw pile; `deck[0]` is the top card. Never leaves the server. */
  deck: CardId[];
  /** Traded cards. Never leaves the server. */
  discard: CardId[];
}

export interface GameState {
  mapId: string;
  rules: RuleConfig;
  /** Turn order, starting with the first player. */
  playerOrder: PlayerId[];
  activePlayerId: PlayerId;
  phase: Phase;
  /** 1-based count of turns played so far, including the current one. */
  turn: number;
  /** 1-based round: every player still in has been at turn once per round (rules.md 11.1). Public. */
  round: number;
  reinforcementsLeft: number;
  territories: Record<TerritoryId, TerritoryState>;
  secret: SecretState;
  /** Open mandatory move after a conquest; only `occupy` is valid while set. */
  pendingOccupation: PendingOccupation | null;
  /** At least one territory was conquered this turn; reset at turn start. */
  conqueredThisTurn: boolean;
  /** Conquests in the current turn; reset at every turn change. Public (rules.md 7). `conqueredThisTurn === (conquestsThisTurn > 0)`. */
  conquestsThisTurn: number;
  /** Accepted fortify moves in the current turn; reset at every turn change (rules.md 5.3). Internal, never in a view. */
  fortifyMovesDone: number;
  /** Plan 014 B: the event of the current round, or null (events off). Public. */
  worldEvent: WorldEvent | null;
  /** Plan 014 C: the teams in seat order, or null without teams. Public. */
  teams: Partial<Record<TeamId, PlayerId[]>> | null;
  /** Plan 014 C: the winning team in a team game, set together with `winnerId`; otherwise null. */
  winnerTeamId: TeamId | null;
  /** Set as soon as someone wins (rules.md 1.2). */
  winnerId: PlayerId | null;
  /** Set together with `winnerId`. */
  winReason: WinReason | null;
  /** All winners (more than one only on a tie after the round limit, rules.md 11.2); empty until the game is won, otherwise `winnerId` comes first. */
  winnerIds: PlayerId[];
  /** Players removed by the host, in the order of removal; they stay in `playerOrder` (rules.md 1.6). Public. */
  removedPlayerIds: PlayerId[];
  /** Format of the stored state (`STATE_VERSION`); internal, never in a view. */
  stateVersion: number;
  /** Last combat, public; replaced by the next combat, cleared at turn change. */
  lastCombat: CombatRecord | null;
  /** Counter behind `lastCombat.seq`; never reset, so `seq` never jumps back. */
  combatSeq: number;
  /** Last card trade, public; replaced by the next trade, cleared at turn change. */
  lastTrade: TradeRecord | null;
  /** Counter behind `lastTrade.seq`; never reset, so `seq` never jumps back. */
  tradeSeq: number;
}

/** A suggested set for the owner's view (see `findSuggestedSets`); the client works out neither validity nor value. */
export interface SuggestedSet {
  cardIds: CardId[];
  value: number;
  /** Own territory that gets the bonus if this set is traded as suggested, or null. */
  bonusTerritoryId: TerritoryId | null;
}

/** One traded set. Public: the discarded cards are shown to everyone. */
export interface TradeRecord {
  /** Consecutive from 1, never jumps back. */
  seq: number;
  playerId: PlayerId;
  cards: Card[];
  armies: number;
  bonusTerritoryId: TerritoryId | null;
}

/**
 * Open mandatory move after a conquest. `min` is the number of dice of the winning roll, i.e. the
 * total number of armies that move in (including the minimum move the engine has already made).
 */
export interface PendingOccupation {
  from: TerritoryId;
  to: TerritoryId;
  min: number;
}

/** View form: the same plus the derived `max` (`min` + armies left in `from` beyond the 1 that stays). */
export interface PendingOccupationView extends PendingOccupation {
  max: number;
}

export interface RollRecord {
  /** Sorted descending. */
  attackerDice: number[];
  /** Sorted descending. */
  defenderDice: number[];
  attackerLosses: number;
  defenderLosses: number;
}

export interface CombatSummary {
  /** All rolls of the combat, including those cut from `rolls`. */
  rollCount: number;
  attackerLosses: number;
  defenderLosses: number;
  conquered: boolean;
}

/** One combat = one `attack` or `blitz` action. Public information only. */
export interface CombatRecord {
  /** Consecutive from 1, never jumps back. */
  seq: number;
  attackerId: PlayerId;
  /** `null` when the defender was neutral. */
  defenderId: Owner;
  from: TerritoryId;
  to: TerritoryId;
  /** At most the last `MAX_COMBAT_ROLLS` rolls. */
  rolls: RollRecord[];
  summary: CombatSummary;
}

/** Longest roll list kept in `lastCombat`; events stay complete. */
export const MAX_COMBAT_ROLLS = 20;

export type Action =
  | { type: "placeArmies"; territoryId: TerritoryId; count: number }
  | { type: "attack"; from: TerritoryId; to: TerritoryId; dice: number }
  | { type: "blitz"; from: TerritoryId; to: TerritoryId }
  | { type: "occupy"; count: number }
  | { type: "fortify"; from: TerritoryId; to: TerritoryId; count: number }
  | { type: "tradeCards"; cardIds: CardId[]; bonusTerritoryId?: TerritoryId | undefined }
  | { type: "endPhase" }
  /** Plan 013: keep one of the two offered missions; valid for every player in phase `missionChoice`. */
  | { type: "chooseMission"; index: 0 | 1 };

/**
 * Actions only the host may trigger (rules.md 1.6). The engine does not know who the host is: the server checks that
 * and then calls `applyHostAction`. Handing over the host role (`transferHost`) is a room matter of the server,
 * not part of the game state, and not part of this type.
 */
export type HostAction =
  | { type: "skipTurn"; turn: number } // end the active player's turn; `turn` must equal `state.turn`
  | { type: "removePlayer"; playerId: PlayerId }; // permanent: territories go neutral, hand to the discard pile

export type ActionErrorCode =
  | "NOT_YOUR_TURN"
  | "WRONG_PHASE"
  | "UNKNOWN_TERRITORY"
  | "NOT_OWNER"
  | "INVALID_COUNT"
  | "NOT_ENOUGH_REINFORCEMENTS"
  | "REINFORCEMENTS_REMAINING"
  | "UNKNOWN_ACTION"
  | "UNKNOWN_MAP"
  | "INVALID_DICE"
  | "NOT_ADJACENT"
  | "OWN_TARGET"
  | "NOT_ENOUGH_ARMIES"
  | "OCCUPY_PENDING"
  | "NO_OCCUPY_PENDING"
  | "INVALID_OCCUPY_COUNT"
  | "GAME_OVER"
  | "SAME_TERRITORY"
  | "NOT_CONNECTED"
  | "MUST_TRADE"
  | "INVALID_SET"
  | "UNKNOWN_CARD"
  | "INVALID_BONUS_TERRITORY"
  | "STALE_TURN"
  | "UNKNOWN_PLAYER"
  | "PLAYER_REMOVED"
  | "ALREADY_CHOSEN"
  | "INVALID_CHOICE"
  | "SEA_BLOCKED"
  | "TRUCE"
  | "ALLY_TARGET";

export type SetupErrorCode =
  | "INVALID_MAP"
  | "INVALID_PLAYER_COUNT"
  | "INVALID_RULES"
  | "UNSUPPORTED_PLACEMENT"
  | "INVALID_MISSIONS"
  | "INVALID_TEAMS";

/** Why a stored state could not be loaded (`migrateState`). */
export type MigrateErrorCode = "STATE_VERSION_INVALID" | "STATE_VERSION_UNSUPPORTED";

export type GameEvent =
  | { type: "gameStarted"; firstPlayerId: PlayerId }
  | { type: "roundStarted"; round: number }
  | { type: "worldEventDrawn"; event: WorldEvent }
  | { type: "turnStarted"; playerId: PlayerId; turn: number; reinforcements: number }
  /** Public, without the mission (plan 013). */
  | { type: "missionChosen"; playerId: PlayerId }
  | { type: "armiesPlaced"; playerId: PlayerId; territoryId: TerritoryId; count: number }
  | { type: "phaseChanged"; playerId: PlayerId; phase: Phase }
  | {
      type: "attackRolled";
      playerId: PlayerId;
      defenderId: Owner;
      from: TerritoryId;
      to: TerritoryId;
      attackerDice: number[];
      defenderDice: number[];
      attackerLosses: number;
      defenderLosses: number;
    }
  | {
      type: "territoryConquered";
      playerId: PlayerId;
      previousOwnerId: Owner;
      from: TerritoryId;
      to: TerritoryId;
    }
  | { type: "armiesMoved"; playerId: PlayerId; from: TerritoryId; to: TerritoryId; count: number }
  | { type: "playerEliminated"; playerId: PlayerId; byPlayerId: PlayerId }
  | { type: "gameWon"; playerId: PlayerId; reason: WinReason }
  | {
      type: "armiesFortified";
      playerId: PlayerId;
      from: TerritoryId;
      to: TerritoryId;
      count: number;
    }
  /** The drawn card is deliberately not part of the event. */
  | { type: "cardDrawn"; playerId: PlayerId }
  | { type: "deckReshuffled" }
  | {
      type: "cardsTraded";
      playerId: PlayerId;
      cards: Card[];
      armies: number;
      bonusTerritoryId: TerritoryId | null;
    }
  /** Elimination: the conqueror takes the hand; only the number is public. */
  | { type: "cardsTaken"; playerId: PlayerId; fromPlayerId: PlayerId; count: number }
  /** Host actions (rules.md 1.6). Like all events they never leave the server. */
  | { type: "turnSkipped"; playerId: PlayerId; turn: number }
  | { type: "playerRemoved"; playerId: PlayerId; territoryCount: number; discardedCount: number };

export type ActionResult =
  { ok: true; state: GameState; events: GameEvent[] } | { ok: false; code: ActionErrorCode };

export type SetupResult =
  { ok: true; state: GameState; events: GameEvent[] } | { ok: false; code: SetupErrorCode };

export interface TerritoryView extends Omit<TerritoryState, "armies"> {
  /** The armies; `null` for foreign and neutral territories while the fog event stands (rules.md 12). */
  armies: number | null;
  /** `min(3, armies - 1)`, at least 0; 0 means this territory cannot attack. `null` in the fog, like `armies`. */
  maxAttackDice: number | null;
  /** `armies - 1`, at least 0: most armies that can leave this territory in a fortify move. `null` in the fog. */
  maxMove: number | null;
}

/**
 * What the active player may highlight in the fortify phase; the client works out no reachability.
 * `connected`: groups of linked own territories (only groups of 2 or more). `adjacent`: for every own
 * territory that can move, its allowed targets. `movesDone` and `movesMax` tell how many moves this turn has seen
 * and allows (the client shows "move 1 of 2" only when `movesMax` is 2).
 */
export type FortifyView =
  | {
      reach: "connected";
      groups: TerritoryId[][];
      /** Fortify moves already made in this turn: 0 with setting 1, 0 or 1 with setting 2. */
      movesDone: number;
      /** The room setting `rules.fortifyMoves` (1 or 2). */
      movesMax: 1 | 2;
    }
  | {
      reach: "adjacent";
      targets: Record<TerritoryId, TerritoryId[]>;
      movesDone: number;
      movesMax: 1 | 2;
    };

/** A card in the owner's own hand. `bonusEligible` is a selection aid only; the engine checks the trade. */
export interface HandCard extends Card {
  /** The card's territory currently belongs to the card's owner (always false for jokers). */
  bonusEligible: boolean;
}

/** One line of the resolution after the game (`GameView.missions`). */
export interface MissionReveal {
  /** The mission the player had at the end. */
  mission: Mission;
  /** The mission as dealt, only if it was replaced by the fallback; otherwise null. */
  originalMission: Mission | null;
  /** The mission put away in the draft ("two missions, keep one"); null without the draft. Plan 013. */
  discarded: Mission | null;
}

/** Progress towards the own mission, only for `connectedRealm` and `blitzkrieg` (plan 013, question 48). */
export interface MissionProgress {
  current: number;
  target: number;
}

/** The viewer's own secrets only. */
export interface SecretView {
  /** Current mission; null in `"domination"`. Never `originalMission`, which is a resolution field only. */
  mission: Mission | null;
  /** True if the current mission is the fallback. No public counterpart exists. */
  missionReplaced: boolean;
  /** The two missions on offer while the own choice is open (phase `missionChoice`); otherwise null. */
  missionOffer: [Mission, Mission] | null;
  /** The own hold-to-win marker (the mission was met at the end of the own last turn). */
  victoryPending: boolean;
  /** Progress of the own mission; null for the other kinds. Worked out by the engine, never by the client. */
  missionProgress: MissionProgress | null;
  hand: HandCard[];
  /** Plan 014 C: the hands of the viewer's teammates, so partners see each other's cards; empty without teams. */
  allyHands: Record<PlayerId, Card[]>;
  /** At most one set per trade value (best first); only in the own reinforce phase, otherwise empty. */
  suggestedSets: SuggestedSet[];
  /** The mandatory trade is open: `placeArmies` and `endPhase` are locked. */
  mustTrade: boolean;
}

/** One line of the team score (rules.md 13): the sums of the members' points and armies. */
export interface TeamScore {
  teamId: TeamId;
  playerIds: PlayerId[];
  points: number;
  armies: number;
}

/** One line of the score after the round limit (rules.md 11.2). Public once the game is over. */
export interface ScoreEntry {
  playerId: PlayerId;
  territories: number;
  /** Sum of the bonuses of the continents held completely. */
  continentBonus: number;
  /** `territories + continentBonus`. */
  points: number;
  /** All armies on the player's territories (the tie-break). */
  armies: number;
}

export interface GameView {
  mapId: string;
  phase: Phase;
  turn: number;
  /** 1-based round (rules.md 11.1). */
  round: number;
  /** The room's round limit, or null (no limit). */
  roundLimit: RoundLimit;
  /** Plan 014 B: the event of this round, or null; and how many cards are left in the event deck. */
  worldEvent: WorldEvent | null;
  worldEventsLeft: number;
  /** Plan 014 C: the teams, or null; public, the same for everybody. */
  teams: Partial<Record<TeamId, PlayerId[]>> | null;
  /** The winning team in a team game, otherwise null. */
  winnerTeamId: TeamId | null;
  /** Plan 014 C: the score summed per team, only with `winReason: "roundLimit"` in a team game; otherwise null. */
  teamScores: TeamScore[] | null;
  activePlayerId: PlayerId;
  playerOrder: PlayerId[];
  /** Players the host removed, in the order of removal; public, the same for every viewer (rules.md 7). */
  removedPlayerIds: PlayerId[];
  reinforcementsLeft: number;
  territories: Record<TerritoryId, TerritoryView>;
  pendingOccupation: PendingOccupationView | null;
  conqueredThisTurn: boolean;
  /** Public counter of conquests in the current turn (rules.md 7). */
  conquestsThisTurn: number;
  /** Some player still in the game holds the hold-to-win marker; no name (plan 013, question 46). */
  victoryPending: boolean;
  /** Who has already chosen a mission, only during phase `missionChoice` (plan 013); otherwise null. */
  missionChoice: { chosen: PlayerId[] } | null;
  winnerId: PlayerId | null;
  /** Set together with `winnerId`, otherwise null. */
  winReason: WinReason | null;
  /** All winners (several only on a tie after the round limit); empty until the game is won. */
  winnerIds: PlayerId[];
  /** The score of the round limit, only with `winReason: "roundLimit"`; otherwise null. */
  scores: ScoreEntry[] | null;
  victoryMode: VictoryMode;
  /**
   * The resolution of all missions: only once `winnerId` is set (and never in `"domination"`), otherwise null.
   * Built by `revealMissions`, nowhere else.
   */
  missions: Record<PlayerId, MissionReveal> | null;
  lastCombat: CombatRecord | null;
  lastTrade: TradeRecord | null;
  /** Number of cards in the draw pile and the discard pile; never their contents. */
  deckCount: number;
  discardCount: number;
  /** Only for the active player in the fortify phase, otherwise null. */
  fortify: FortifyView | null;
  secret: SecretView;
  /** Hand sizes of all players; the only thing others see of a hand. */
  handCounts: Record<PlayerId, number>;
}
