import { normalizeState } from "./normalize.js";
import type {
  GameStateV3,
  GameStateV4,
  GameStateV5,
  GameStateV6,
  GameStateV7,
  GameStateV8,
} from "./normalize.js";
import { STATE_VERSION } from "./state-version.js";
import type { GameState, MigrateErrorCode, Rng } from "./types.js";

export type MigrateResult =
  | { ok: true; state: GameState; migrated: boolean } // migrated: the stored state was older than STATE_VERSION
  | { ok: false; code: MigrateErrorCode };

/** Oldest version a stored state can claim explicitly; states without `stateVersion` are "unversioned". */
const FIRST_VERSIONED = 3;

/**
 * 3 -> 4 (phase 4): old games go on as `"domination"`, without missions and without neutral owners
 * (rules.md 1.5, question 19). Builds a new object; the input is not touched, no `Rng`.
 */
export function migrate3to4(state: GameStateV3): GameStateV4 {
  const none = Object.fromEntries(state.playerOrder.map((p) => [p, null]));
  return {
    ...state,
    rules: { ...state.rules, victoryMode: "domination" },
    secret: {
      ...state.secret,
      mission: { ...none },
      originalMission: { ...none },
      missionReplaced: Object.fromEntries(state.playerOrder.map((p) => [p, false])),
    },
    winReason: state.winnerId !== null ? "lastPlayer" : null,
    stateVersion: 4,
  };
}

/**
 * 4 -> 5 (phase 6a): nobody has been removed by a host yet (rules.md 1.5, 1.6). Builds a new object; the input is
 * not touched, no `Rng`.
 */
export function migrate4to5(state: GameStateV4): GameStateV5 {
  return { ...state, removedPlayerIds: [], stateVersion: 5 };
}

/**
 * 5 -> 6 (plan 011): every stored game was started with one fortify move per turn, so it goes on with
 * `fortifyMoves: 1`; the counter is 0 because under the old rules the first move already ended the turn (rules.md
 * 1.5, 5.3). Builds a new object; the input is not touched, no `Rng`.
 */
export function migrate5to6(state: GameStateV5): GameStateV6 {
  return {
    ...state,
    rules: { ...state.rules, fortifyMoves: 1 },
    fortifyMovesDone: 0,
    stateVersion: 6,
  };
}

/**
 * 6 -> 7 (plan 013): the counter is rebuilt from the flag (exact count is not recoverable; it only matters for
 * `blitzkrieg`, which old states do not have); no mission offers, nothing discarded, no pending victory, both
 * mission options off (rules.md 1.5). Builds a new object; the input is not touched, no `Rng`.
 */
export function migrate6to7(state: GameStateV6): GameStateV7 {
  const none = Object.fromEntries(state.playerOrder.map((p) => [p, null]));
  return {
    ...state,
    rules: { ...state.rules, missionDraft: false, holdToWin: false },
    secret: {
      ...state.secret,
      missionOffer: { ...none },
      missionOfferDealt: { ...none },
      discardedMission: { ...none },
      victoryPending: Object.fromEntries(state.playerOrder.map((p) => [p, false])),
    },
    conquestsThisTurn: state.conqueredThisTurn ? 1 : 0,
    stateVersion: 7,
  };
}

/**
 * 7 -> 8 (plan 014 A): no round limit. `round` is only a display value for games that have no limit, so the
 * approximation `ceil(turn / players)` is enough (exact if nobody was eliminated); `winnerIds` is the winner, if any
 * (rules.md 1.5, 11). Builds a new object; the input is not touched, no `Rng`.
 */
export function migrate7to8(state: GameStateV7): GameStateV8 {
  return {
    ...state,
    rules: { ...state.rules, roundLimit: null },
    round: Math.max(1, Math.ceil(state.turn / Math.max(1, state.playerOrder.length))),
    winnerIds: state.winnerId !== null ? [state.winnerId] : [],
    stateVersion: 8,
  };
}

/**
 * 8 -> 9 (plan 014 B): no world events: `rules.worldEvents: false`, no event in force, an empty event deck
 * (rules.md 1.5, 12). Builds a new object; the input is not touched, no `Rng`.
 */
export function migrate8to9(state: GameStateV8): GameState {
  return {
    ...state,
    rules: { ...state.rules, worldEvents: false },
    worldEvent: null,
    secret: { ...state.secret, eventDeck: [] },
    stateVersion: 9,
  };
}

/**
 * One step per version: `MIGRATIONS[n]` turns a version-n state into a version-(n+1) state. Typed loosely on
 * purpose, each step knows its own input and output format.
 */
const MIGRATIONS: Record<number, (state: never) => unknown> = {
  3: migrate3to4,
  4: migrate4to5,
  5: migrate5to6,
  6: migrate6to7,
  7: migrate7to8,
  8: migrate8to9,
};

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Brings a stored state to `STATE_VERSION` (rules.md 1.5). No `throw`: an unknown newer version or an invalid
 * value is returned as an error and the input is never changed. A state at the current version is returned as
 * it is, without using the `rng`. Unversioned states (phase 3 or older) first go through `normalizeState`
 * (-> 3), which uses the `rng` only for the draw pile of a phase 2 state.
 */
export function migrateState(raw: unknown, rng: Rng): MigrateResult {
  if (!isRecord(raw)) return { ok: false, code: "STATE_VERSION_INVALID" };
  const declared = raw["stateVersion"];
  if (declared !== undefined) {
    if (typeof declared !== "number" || !Number.isInteger(declared) || declared < FIRST_VERSIONED) {
      return { ok: false, code: "STATE_VERSION_INVALID" };
    }
    if (declared > STATE_VERSION) return { ok: false, code: "STATE_VERSION_UNSUPPORTED" };
    if (declared === STATE_VERSION)
      return { ok: true, state: raw as unknown as GameState, migrated: false };
  }
  let current: unknown =
    declared === undefined ? normalizeState(raw as unknown as GameStateV3, rng) : raw;
  for (let v = declared ?? FIRST_VERSIONED; v < STATE_VERSION; v++) {
    current = MIGRATIONS[v]!(current as never);
  }
  return { ok: true, state: current as GameState, migrated: true };
}
