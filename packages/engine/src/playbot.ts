// Test helper (not in the build): plays random legal games over the real engine, for invariant tests.
import {
  applyAction,
  applyHostAction,
  createGame,
  createSeededRng,
  testland,
  testlandRules,
  viewFor,
} from "./index.js";
import type {
  Action,
  HostAction,
  MapDefinition,
  GameEvent,
  GameState,
  Mission,
  MissionSet,
  Rng,
  RuleConfig,
} from "./index.js";
import { pendingChoosers } from "./index.js";

export interface Step {
  /** State before the action, the action, and its outcome. */
  before: GameState;
  playerId: string;
  /** A player action, or (with `hostActions`) a host action; `host` tells which. */
  action: Action | HostAction;
  /** True for a host action (`skipTurn`, `removePlayer`); `playerId` is then the active player at that time. */
  host?: boolean;
  after: GameState;
  events: GameEvent[];
}

export interface PlayOptions {
  seed: number;
  players: number;
  rules?: RuleConfig;
  /** Map to play on; defaults to testland. */
  map?: MapDefinition;
  /** Extra input for `createGame` (missions), spread into the call. */
  extra?: Record<string, unknown>;
  /** Action budget; the game may end earlier. */
  maxActions?: number;
  /** Chance (0-1) that the bot attacks again instead of ending the attack phase. */
  aggression?: number;
  /**
   * Chance (0-1) that the bot inserts a random host action before a player action: `skipTurn` for the current
   * turn or `removePlayer` for a random player who has not been removed yet. Off by default.
   */
  hostRate?: number;
}

const ids = ["p1", "p2", "p3", "p4", "p5", "p6"];

/** Picks a legal action for the active player; every choice comes from the bot's own `bot` Rng. */
export function chooseAction(
  state: GameState,
  bot: Rng,
  aggression: number,
  map: MapDefinition = testland,
): Action {
  const me = state.activePlayerId;
  const view = viewFor(state, me);
  const own = Object.entries(state.territories).filter(([, t]) => t.ownerId === me);
  const pick = <T>(xs: T[]): T => xs[bot.int(xs.length)]!;
  if (state.pendingOccupation) {
    const p = view.pendingOccupation!;
    return { type: "occupy", count: p.min + bot.int(p.max - p.min + 1) };
  }
  if (state.phase === "reinforce") {
    const set = view.secret.suggestedSets[0];
    if (set && (view.secret.mustTrade || bot.int(2) === 0)) {
      return { type: "tradeCards", cardIds: set.cardIds };
    }
    if (state.reinforcementsLeft > 0) {
      const [id] = pick(own);
      return { type: "placeArmies", territoryId: id, count: 1 + bot.int(state.reinforcementsLeft) };
    }
    return { type: "endPhase" };
  }
  if (state.phase === "attack") {
    const pairs: { from: string; to: string; dice: number }[] = [];
    for (const [from, t] of own) {
      if (t.armies < 2) continue;
      for (const to of map.territories.find((x) => x.id === from)!.neighbors) {
        if (state.territories[to]!.ownerId !== me) {
          pairs.push({ from, to, dice: Math.min(3, t.armies - 1) });
        }
      }
    }
    if (pairs.length > 0 && bot.int(100) < aggression * 100) {
      const p = pick(pairs);
      return bot.int(2) === 0
        ? { type: "blitz", from: p.from, to: p.to }
        : { type: "attack", from: p.from, to: p.to, dice: 1 + bot.int(p.dice) };
    }
    return { type: "endPhase" };
  }
  // Origins and targets come from the view; with setting 2 the bot may fortify again after the first move.
  const fortify = view.fortify;
  const options: { from: string; to: string[] }[] = [];
  if (fortify?.reach === "connected") {
    for (const group of fortify.groups) {
      for (const from of group) {
        if (state.territories[from]!.armies > 1) {
          options.push({ from, to: group.filter((id) => id !== from) });
        }
      }
    }
  } else if (fortify?.reach === "adjacent") {
    for (const [from, to] of Object.entries(fortify.targets)) options.push({ from, to });
  }
  if (options.length > 0 && bot.int(2) === 0) {
    const { from, to } = pick(options);
    return {
      type: "fortify",
      from,
      to: pick(to),
      count: 1 + bot.int(state.territories[from]!.armies - 1),
    };
  }
  return { type: "endPhase" };
}

/** Plays one random game and returns every accepted step; throws if the engine rejects a chosen action. */
export function playRandomGame(opts: PlayOptions): { start: GameState; steps: Step[] } {
  const map = opts.map ?? testland;
  const rng = createSeededRng(opts.seed);
  const bot = createSeededRng(opts.seed * 7919 + 13);
  const created = createGame({
    map,
    rules: opts.rules ?? testlandRules,
    playerIds: ids.slice(0, opts.players),
    rng,
    ...opts.extra,
  });
  if (!created.ok) throw new Error(`createGame: ${created.code}`);
  const steps: Step[] = [];
  let state = created.state;
  for (let i = 0; i < (opts.maxActions ?? 400) && state.winnerId === null; i++) {
    if (opts.hostRate && bot.int(1000) < opts.hostRate * 1000) {
      const alive = state.playerOrder.filter((p) => !state.removedPlayerIds.includes(p));
      const host: HostAction =
        bot.int(2) === 0 || alive.length === 0
          ? { type: "skipTurn", turn: state.turn }
          : { type: "removePlayer", playerId: alive[bot.int(alive.length)]! };
      const playerId = state.activePlayerId;
      const r = applyHostAction(state, host, rng);
      if (!r.ok) throw new Error(`seed ${opts.seed}: ${JSON.stringify(host)} rejected: ${r.code}`);
      steps.push({
        before: state,
        playerId,
        action: host,
        host: true,
        after: r.state,
        events: r.events,
      });
      state = r.state;
      continue;
    }
    // In phase `missionChoice` a random player who has not chosen yet picks one of the two missions.
    const pending = state.phase === "missionChoice" ? pendingChoosers(state) : [];
    const playerId = pending.length > 0 ? pending[bot.int(pending.length)]! : state.activePlayerId;
    const action: Action =
      pending.length > 0
        ? { type: "chooseMission", index: bot.int(2) === 0 ? 0 : 1 }
        : chooseAction(state, bot, opts.aggression ?? 0.9, map);
    const r = applyAction(state, playerId, action, rng);
    if (!r.ok) throw new Error(`seed ${opts.seed}: ${JSON.stringify(action)} rejected: ${r.code}`);
    steps.push({ before: state, playerId, action, after: r.state, events: r.events });
    state = r.state;
  }
  return { start: created.state, steps };
}

export type { Mission, MissionSet };
