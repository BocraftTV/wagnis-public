// Playback of a combat (plan 008, 3): pure planning of the dice animation. Nothing here changes rules or state;
// the source is `lastCombat` only, and the result text is always shown right away.
import type { GameViewMessage } from "@wagnis/shared";
import { SeenCombats } from "./attack.js";

export type CombatRecord = NonNullable<GameViewMessage["lastCombat"]>;

export interface PlaybackStep {
  /** Index into `combat.rolls`. */
  rollIndex: number;
  startMs: number;
  durationMs: number;
}

export interface Playback {
  mode: "none" | "single" | "blitz";
  steps: PlaybackStep[];
  /** When the summary line appears. */
  summaryAtMs: number;
  totalMs: number;
}

const SINGLE_ROLL_MS = 600;
const SINGLE_REST_MS = 300;
const BLITZ_BUDGET_MS = 1500;
const BLITZ_MIN_MS = 60;
const BLITZ_MAX_MS = 150;
const BLITZ_SUMMARY_MS = 300;

const NO_PLAYBACK: Playback = { mode: "none", steps: [], summaryAtMs: 0, totalMs: 0 };

/** Times for the animation of one combat; `reducedMotion` (or no roll at all) means no animation. */
export function planPlayback(combat: CombatRecord, opts: { reducedMotion: boolean }): Playback {
  const n = combat.rolls.length;
  if (opts.reducedMotion || n === 0) return { ...NO_PLAYBACK, steps: [] };
  if (n === 1) {
    return {
      mode: "single",
      steps: [{ rollIndex: 0, startMs: 0, durationMs: SINGLE_ROLL_MS + SINGLE_REST_MS }],
      summaryAtMs: SINGLE_ROLL_MS,
      totalMs: SINGLE_ROLL_MS + SINGLE_REST_MS,
    };
  }
  const perRoll = Math.min(BLITZ_MAX_MS, Math.max(BLITZ_MIN_MS, BLITZ_BUDGET_MS / n));
  const steps = combat.rolls.map((_, rollIndex) => ({
    rollIndex,
    startMs: rollIndex * perRoll,
    durationMs: perRoll,
  }));
  return {
    mode: "blitz",
    steps,
    summaryAtMs: n * perRoll,
    totalMs: n * perRoll + BLITZ_SUMMARY_MS,
  };
}

/** "Wurf 7 bis 26 von 26" when the record holds only the last rolls of a long blitz, else null. */
export function rollRangeLabel(combat: CombatRecord): string | null {
  const { rollCount } = combat.summary;
  const n = combat.rolls.length;
  if (rollCount <= n) return null;
  return `Wurf ${rollCount - n + 1} bis ${rollCount} von ${rollCount}`;
}

export type PlaybackDecision = "animate" | "static" | "none";

/**
 * Decides per snapshot whether a combat is animated, shown without animation, or not shown (rules.md 10.6, question 34).
 * Memory is in the page only: a combat is handled once per (room, game number, `seq`).
 * The first snapshot of a room after the page loaded shows its combat statically; a new combat after that is
 * animated, also right after a reconnect.
 */
export class PlaybackGate {
  private readonly seen = new SeenCombats();
  private readonly rooms = new Set<string>();

  decide(input: {
    roomId: string;
    gameNo: number;
    combat: CombatRecord | null;
    reducedMotion: boolean;
  }): PlaybackDecision {
    const first = !this.rooms.has(input.roomId);
    this.rooms.add(input.roomId);
    if (input.combat === null) return "none";
    if (!this.seen.markIfNew(input.roomId, input.gameNo, input.combat.seq)) return "none";
    return first || input.reducedMotion ? "static" : "animate";
  }
}

/** One memory per page load, shared by every mount of the game view. */
export const playbackGate = new PlaybackGate();

/** Pip positions of a die face in a unit square (x right, y down); empty for anything but 1 to 6. */
export function pips(face: number): [number, number][] {
  const lo = 0.25;
  const mid = 0.5;
  const hi = 0.75;
  switch (face) {
    case 1:
      return [[mid, mid]];
    case 2:
      return [
        [lo, lo],
        [hi, hi],
      ];
    case 3:
      return [
        [lo, lo],
        [mid, mid],
        [hi, hi],
      ];
    case 4:
      return [
        [lo, lo],
        [hi, lo],
        [lo, hi],
        [hi, hi],
      ];
    case 5:
      return [
        [lo, lo],
        [hi, lo],
        [mid, mid],
        [lo, hi],
        [hi, hi],
      ];
    case 6:
      return [
        [lo, lo],
        [hi, lo],
        [lo, mid],
        [hi, mid],
        [lo, hi],
        [hi, hi],
      ];
    default:
      return [];
  }
}

/**
 * The faces a rolling die shows, `count` in all: a fixed cycle 1…6 shifted by `offset` (no randomness),
 * ending with the real value `final`.
 */
export function rollingFaces(final: number, count: number, offset: number): number[] {
  if (count <= 0) return [];
  const faces: number[] = [];
  for (let i = 0; i < count - 1; i++) faces.push(((((offset + i) % 6) + 6) % 6) + 1);
  faces.push(final);
  return faces;
}

/** What the dice area shows from `atMs` on: up to 3 attacker and 2 defender faces (`null`: no die) and the loss counters. */
export interface DiceFrame {
  atMs: number;
  attacker: (number | null)[];
  defender: (number | null)[];
  attackerLosses: number;
  defenderLosses: number;
}

const ATTACKER_SLOTS = 3;
const DEFENDER_SLOTS = 2;
const ROLLING_TICK_MS = 100;

const slots = (dice: readonly number[], n: number): (number | null)[] =>
  Array.from({ length: n }, (_, i) => dice[i] ?? null);

/**
 * The picture sequence of a playback. A single roll tumbles through fixed faces and lands on the real values at
 * `summaryAtMs`; a blitz shows each real roll for its step and counts the losses along. The last frame always shows
 * the delivered result (the summary totals for the losses). The interface sets one timeout per frame, no loop.
 */
export function diceFrames(combat: CombatRecord, playback: Playback): DiceFrame[] {
  if (playback.mode === "none") return [];
  const rolls = combat.rolls;
  const last = rolls[rolls.length - 1]!;
  const totals = {
    attackerLosses: combat.summary.attackerLosses,
    defenderLosses: combat.summary.defenderLosses,
  };
  if (playback.mode === "single") {
    const ticks = Math.floor(playback.summaryAtMs / ROLLING_TICK_MS);
    const faces = (dice: readonly number[], side: number) =>
      dice.map((final, j) => rollingFaces(final, ticks + 1, 2 * j + side));
    const attacker = faces(last.attackerDice, 0);
    const defender = faces(last.defenderDice, 1);
    return Array.from({ length: ticks + 1 }, (_, i) => ({
      atMs: i === ticks ? playback.summaryAtMs : i * ROLLING_TICK_MS,
      attacker: slots(
        attacker.map((f) => f[i]!),
        ATTACKER_SLOTS,
      ),
      defender: slots(
        defender.map((f) => f[i]!),
        DEFENDER_SLOTS,
      ),
      ...(i === ticks ? totals : { attackerLosses: 0, defenderLosses: 0 }),
    }));
  }
  // Blitz: a long blitz keeps only its last rolls; the counters start where the kept rolls begin.
  let attackerLosses = totals.attackerLosses - rolls.reduce((n, r) => n + r.attackerLosses, 0);
  let defenderLosses = totals.defenderLosses - rolls.reduce((n, r) => n + r.defenderLosses, 0);
  const frames: DiceFrame[] = playback.steps.map((step) => {
    const roll = rolls[step.rollIndex]!;
    attackerLosses += roll.attackerLosses;
    defenderLosses += roll.defenderLosses;
    return {
      atMs: step.startMs,
      attacker: slots(roll.attackerDice, ATTACKER_SLOTS),
      defender: slots(roll.defenderDice, DEFENDER_SLOTS),
      attackerLosses,
      defenderLosses,
    };
  });
  frames.push({
    atMs: playback.summaryAtMs,
    attacker: slots(last.attackerDice, ATTACKER_SLOTS),
    defender: slots(last.defenderDice, DEFENDER_SLOTS),
    ...totals,
  });
  return frames;
}
