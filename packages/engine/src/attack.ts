import { resolveRoll, rollDice } from "./combat.js";
import { getMap } from "./maps/index.js";
import { replaceTargetMissions } from "./missions.js";
import { isEliminated } from "./players.js";
import { areAllies, teamMembers } from "./teams.js";
import { eventOf, isSeaRoute } from "./world-events.js";
import { MAX_COMBAT_ROLLS } from "./types.js";
import type {
  Action,
  ActionErrorCode,
  ActionResult,
  GameEvent,
  GameState,
  PlayerId,
  RollRecord,
  Rng,
  TerritoryId,
  TerritoryState,
} from "./types.js";

type AttackAction = Extract<Action, { type: "attack" }>;
type BlitzAction = Extract<Action, { type: "blitz" }>;
type OccupyAction = Extract<Action, { type: "occupy" }>;

const fail = (code: ActionErrorCode): ActionResult => ({ ok: false, code });

/** Own-property lookup, so ids like "constructor" are unknown territories. */
export function findTerritory(state: GameState, id: TerritoryId): TerritoryState | undefined {
  return Object.hasOwn(state.territories, id) ? state.territories[id] : undefined;
}

/**
 * Who gets the hand of an eliminated player: the conqueror, or in a team game the next team mate in turn order who
 * is still in (starting behind the eliminated player), falling back to the conqueror when the team is out.
 */
function handTaker(state: GameState, eliminatedId: PlayerId, conquerorId: PlayerId): PlayerId {
  const mates = teamMembers(state, eliminatedId).filter((p) => p !== eliminatedId);
  if (mates.length === 0) return conquerorId;
  const order = state.playerOrder;
  const start = order.indexOf(eliminatedId);
  for (let step = 1; step <= order.length; step++) {
    const candidate = order[(start + step) % order.length]!;
    if (mates.includes(candidate) && !isEliminated(state, candidate)) return candidate;
  }
  return conquerorId;
}

/** Highest number of dice the attacker may use from a territory with `armies` armies. */
export const maxDiceFor = (armies: number): number => Math.max(0, Math.min(3, armies - 1));

/**
 * Checks everything `attack` and `blitz` share, in the order of rules.md 5.2 (the turn, game-over and
 * pending-occupation checks come before, in `applyAction`). Returns an error code or null.
 */
function checkTarget(
  state: GameState,
  playerId: PlayerId,
  fromId: TerritoryId,
  toId: TerritoryId,
): ActionErrorCode | null {
  if (state.phase !== "attack") return "WRONG_PHASE";
  const from = findTerritory(state, fromId);
  const to = findTerritory(state, toId);
  if (!from || !to) return "UNKNOWN_TERRITORY";
  if (from.ownerId !== playerId) return "NOT_OWNER";
  if (to.ownerId === playerId) return "OWN_TARGET";
  if (areAllies(state, to.ownerId, playerId)) return "ALLY_TARGET";
  const map = getMap(state.mapId);
  if (!map) return "UNKNOWN_MAP";
  if (!map.territories.find((t) => t.id === fromId)?.neighbors.includes(toId)) {
    return "NOT_ADJACENT";
  }
  // World events of the round (plan 014 B): storm closes the sea routes, truce protects one continent.
  if (eventOf(state, "storm") && isSeaRoute(map, fromId, toId)) return "SEA_BLOCKED";
  const truce = eventOf(state, "truce");
  if (truce && map.territories.find((t) => t.id === toId)?.continentId === truce.continentId)
    return "TRUCE";
  if (from.armies < 2) return "NOT_ENOUGH_ARMIES";
  return null;
}

interface CombatRun {
  rolls: RollRecord[];
  events: GameEvent[];
  fromArmies: number;
  toArmies: number;
  attackerLosses: number;
  defenderLosses: number;
  /** Dice of the attacker in the last roll: the least number of armies that move in after a conquest. */
  lastAttackerDiceCount: number;
}

/**
 * Rolls one combat. `fixedDice` is the attacker's chosen dice for a single roll (`attack`); without it the attacker
 * rolls with the maximum until the territory falls or only 1 army is left (`blitz`).
 */
function rollCombat(
  state: GameState,
  playerId: PlayerId,
  fromId: TerritoryId,
  toId: TerritoryId,
  fixedDice: number | undefined,
  rng: Rng,
): CombatRun {
  const defenderId = state.territories[toId]!.ownerId;
  const run: CombatRun = {
    rolls: [],
    events: [],
    fromArmies: state.territories[fromId]!.armies,
    toArmies: state.territories[toId]!.armies,
    attackerLosses: 0,
    defenderLosses: 0,
    lastAttackerDiceCount: 0,
  };
  // Every roll costs at least one army, so the loop ends after at most fromArmies + toArmies rolls;
  // the counter is only a safety net.
  for (let guard = run.fromArmies + run.toArmies; guard > 0; guard--) {
    const attackerDiceCount = fixedDice ?? maxDiceFor(run.fromArmies);
    const attackerDice = rollDice(rng, attackerDiceCount);
    const defenderDice = rollDice(rng, run.toArmies >= 2 ? 2 : 1);
    const outcome = resolveRoll(attackerDice, defenderDice);
    run.fromArmies -= outcome.attackerLosses;
    run.toArmies -= outcome.defenderLosses;
    run.attackerLosses += outcome.attackerLosses;
    run.defenderLosses += outcome.defenderLosses;
    run.lastAttackerDiceCount = attackerDiceCount;
    run.rolls.push({ attackerDice, defenderDice, ...outcome });
    run.events.push({
      type: "attackRolled",
      playerId,
      defenderId,
      from: fromId,
      to: toId,
      attackerDice,
      defenderDice,
      ...outcome,
    });
    if (fixedDice !== undefined || run.toArmies === 0 || run.fromArmies <= 1) break;
  }
  return run;
}

/**
 * Fights one combat (see `rollCombat`): writes the armies and the combat record, and on a conquest takes the
 * territory. The caller has validated everything, so this always makes progress.
 */
function fight(
  state: GameState,
  playerId: PlayerId,
  fromId: TerritoryId,
  toId: TerritoryId,
  fixedDice: number | undefined,
  rng: Rng,
): ActionResult {
  const defenderId = state.territories[toId]!.ownerId;
  const run = rollCombat(state, playerId, fromId, toId, fixedDice, rng);
  const conquered = run.toArmies === 0;
  const seq = state.combatSeq + 1;
  const next: GameState = {
    ...state,
    territories: {
      ...state.territories,
      [fromId]: { ...state.territories[fromId]!, armies: run.fromArmies },
      [toId]: { ...state.territories[toId]!, armies: run.toArmies },
    },
    combatSeq: seq,
    lastCombat: {
      seq,
      attackerId: playerId,
      defenderId,
      from: fromId,
      to: toId,
      rolls: run.rolls.slice(-MAX_COMBAT_ROLLS),
      summary: {
        rollCount: run.rolls.length,
        attackerLosses: run.attackerLosses,
        defenderLosses: run.defenderLosses,
        conquered,
      },
    },
  };
  if (!conquered) return { ok: true, state: next, events: run.events };
  return conquer(state, next, playerId, fromId, toId, run.lastAttackerDiceCount, run.events);
}

/**
 * The attacker takes the territory with `min` armies (the dice of the winning roll); an eliminated defender hands
 * over the cards, and a move-in choice opens if armies are left beyond the 1 that stays.
 */
function conquer(
  before: GameState,
  fought: GameState,
  playerId: PlayerId,
  fromId: TerritoryId,
  toId: TerritoryId,
  min: number,
  events: GameEvent[],
): ActionResult {
  const defenderId = before.territories[toId]!.ownerId;
  const territories = fought.territories;
  // The attacker loses nothing in the winning roll, so the attacking territory has more than `min` armies.
  let next: GameState = {
    ...fought,
    conqueredThisTurn: true,
    conquestsThisTurn: before.conquestsThisTurn + 1,
    territories: {
      ...territories,
      [fromId]: { ...territories[fromId]!, armies: territories[fromId]!.armies - min },
      [toId]: { ownerId: playerId, armies: min },
    },
  };
  events.push(
    { type: "territoryConquered", playerId, previousOwnerId: defenderId, from: fromId, to: toId },
    { type: "armiesMoved", playerId, from: fromId, to: toId, count: min },
  );
  if (defenderId !== null && isEliminated(next, defenderId)) {
    events.push({ type: "playerEliminated", playerId: defenderId, byPlayerId: playerId });
    next = handOverHand(next, defenderId, playerId, events);
    // Missions of the other players that targeted the eliminated player become the fallback, silently:
    // no event and no public field (rules.md 1.2). The conqueror's own mission is not touched.
    next = replaceTargetMissions(next, defenderId, playerId);
  }
  if (next.territories[fromId]!.armies > 1) {
    // The attacker keeps armies beyond the 1 that stays: a move-in choice is open. `checkVictory` (in
    // `applyAction`) clears it again if this conquest wins the game.
    next = { ...next, pendingOccupation: { from: fromId, to: toId, min } };
  }
  return { ok: true, state: next, events };
}

/**
 * The conqueror takes the whole hand of the eliminated player. No instant trade (rules.md 6): the mandatory trade
 * applies in the conqueror's next reinforce phase. This also happens when the elimination ends the game. In a team
 * game the hand goes to the next team mate still in the game, in turn order, instead (rules.md 13, question 59); if
 * the whole team is out, the conqueror takes it as usual.
 */
function handOverHand(
  state: GameState,
  eliminatedId: PlayerId,
  conquerorId: PlayerId,
  events: GameEvent[],
): GameState {
  const taker = handTaker(state, eliminatedId, conquerorId);
  const taken = state.secret.hand[eliminatedId] ?? [];
  if (taken.length === 0) return state;
  events.push({
    type: "cardsTaken",
    playerId: taker,
    fromPlayerId: eliminatedId,
    count: taken.length,
  });
  return {
    ...state,
    secret: {
      ...state.secret,
      hand: {
        ...state.secret.hand,
        [taker]: [...(state.secret.hand[taker] ?? []), ...taken],
        [eliminatedId]: [],
      },
    },
  };
}

export function applyAttack(
  state: GameState,
  playerId: PlayerId,
  action: AttackAction,
  rng: Rng,
): ActionResult {
  const code = checkTarget(state, playerId, action.from, action.to);
  if (code) return fail(code);
  const max = maxDiceFor(state.territories[action.from]!.armies);
  if (!Number.isInteger(action.dice) || action.dice < 1 || action.dice > max) {
    return fail("INVALID_DICE");
  }
  return fight(state, playerId, action.from, action.to, action.dice, rng);
}

export function applyBlitz(
  state: GameState,
  playerId: PlayerId,
  action: BlitzAction,
  rng: Rng,
): ActionResult {
  const code = checkTarget(state, playerId, action.from, action.to);
  if (code) return fail(code);
  return fight(state, playerId, action.from, action.to, undefined, rng);
}

export function applyOccupy(
  state: GameState,
  playerId: PlayerId,
  action: OccupyAction,
): ActionResult {
  const pending = state.pendingOccupation;
  if (!pending) return fail("NO_OCCUPY_PENDING");
  const extra = state.territories[pending.from]!.armies - 1;
  if (
    !Number.isInteger(action.count) ||
    action.count < pending.min ||
    action.count > pending.min + extra
  ) {
    return fail("INVALID_OCCUPY_COUNT");
  }
  const more = action.count - pending.min;
  const from = state.territories[pending.from]!;
  const to = state.territories[pending.to]!;
  const events: GameEvent[] =
    more > 0
      ? [{ type: "armiesMoved", playerId, from: pending.from, to: pending.to, count: more }]
      : [];
  return {
    ok: true,
    state: {
      ...state,
      pendingOccupation: null,
      territories: {
        ...state.territories,
        [pending.from]: { ...from, armies: from.armies - more },
        [pending.to]: { ...to, armies: to.armies + more },
      },
    },
    events,
  };
}
