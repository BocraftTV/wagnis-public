import { normalizeState } from "./normalize.js";
import type { GameStateV3, GameStateV4, GameStateV5 } from "./normalize.js";
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
export function migrate5to6(state: GameStateV5): GameState {
  return {
    ...state,
    rules: { ...state.rules, fortifyMoves: 1 },
    fortifyMovesDone: 0,
    stateVersion: 6,
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
