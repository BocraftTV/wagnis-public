import { resolveRoll, rollDice } from "./combat.js";
import { getMap } from "./maps/index.js";
import { replaceTargetMissions } from "./missions.js";
import { isEliminated } from "./players.js";
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

/**
 * Fights one combat. `fixedDice` is the attacker's chosen dice for a single roll (`attack`);
 * without it the attacker rolls with the maximum until the territory falls or only 1 army is left (`blitz`).
 * The caller has validated everything, so this always makes progress.
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
  let fromArmies = state.territories[fromId]!.armies;
  let toArmies = state.territories[toId]!.armies;
  const events: GameEvent[] = [];
  const rolls: RollRecord[] = [];
  let attackerLosses = 0;
  let defenderLosses = 0;
  let lastAttackerDiceCount = 0;

  // Every roll costs at least one army, so the loop ends after at most fromArmies + toArmies rolls;
  // the counter is only a safety net.
  for (let guard = fromArmies + toArmies; guard > 0; guard--) {
    const attackerDiceCount = fixedDice ?? maxDiceFor(fromArmies);
    const attackerDice = rollDice(rng, attackerDiceCount);
    const defenderDice = rollDice(rng, toArmies >= 2 ? 2 : 1);
    const outcome = resolveRoll(attackerDice, defenderDice);
    fromArmies -= outcome.attackerLosses;
    toArmies -= outcome.defenderLosses;
    attackerLosses += outcome.attackerLosses;
    defenderLosses += outcome.defenderLosses;
    lastAttackerDiceCount = attackerDiceCount;
    rolls.push({ attackerDice, defenderDice, ...outcome });
    events.push({
      type: "attackRolled",
      playerId,
      defenderId,
      from: fromId,
      to: toId,
      attackerDice,
      defenderDice,
      ...outcome,
    });
    if (fixedDice !== undefined || toArmies === 0 || fromArmies <= 1) break;
  }

  const conquered = toArmies === 0;
  const seq = state.combatSeq + 1;
  const territories = {
    ...state.territories,
    [fromId]: { ...state.territories[fromId]!, armies: fromArmies },
    [toId]: { ...state.territories[toId]!, armies: toArmies },
  };
  let next: GameState = {
    ...state,
    territories,
    combatSeq: seq,
    lastCombat: {
      seq,
      attackerId: playerId,
      defenderId,
      from: fromId,
      to: toId,
      rolls: rolls.slice(-MAX_COMBAT_ROLLS),
      summary: { rollCount: rolls.length, attackerLosses, defenderLosses, conquered },
    },
  };

  if (conquered) {
    // The attacker loses nothing in the winning roll, so fromArmies > lastAttackerDiceCount.
    const min = lastAttackerDiceCount;
    next = {
      ...next,
      conqueredThisTurn: true,
      conquestsThisTurn: state.conquestsThisTurn + 1,
      territories: {
        ...territories,
        [fromId]: { ...territories[fromId]!, armies: fromArmies - min },
        [toId]: { ownerId: playerId, armies: min },
      },
    };
    events.push(
      { type: "territoryConquered", playerId, previousOwnerId: defenderId, from: fromId, to: toId },
      { type: "armiesMoved", playerId, from: fromId, to: toId, count: min },
    );
    if (defenderId !== null && isEliminated(next, defenderId)) {
      events.push({ type: "playerEliminated", playerId: defenderId, byPlayerId: playerId });
      // The conqueror takes the whole hand. No instant trade (rules.md 6): the mandatory trade applies
      // in the conqueror's next reinforce phase. This also happens when the elimination ends the game.
      const taken = next.secret.hand[defenderId] ?? [];
      if (taken.length > 0) {
        next = {
          ...next,
          secret: {
            ...next.secret,
            hand: {
              ...next.secret.hand,
              [playerId]: [...(next.secret.hand[playerId] ?? []), ...taken],
              [defenderId]: [],
            },
          },
        };
        events.push({
          type: "cardsTaken",
          playerId,
          fromPlayerId: defenderId,
          count: taken.length,
        });
      }
      // Missions of the other players that targeted the eliminated player become the fallback, silently:
      // no event and no public field (rules.md 1.2). The conqueror's own mission is not touched.
      next = replaceTargetMissions(next, defenderId, playerId);
    }
    if (next.territories[fromId]!.armies > 1) {
      // The attacker keeps armies beyond the 1 that stays: a move-in choice is open. `checkVictory` (in
      // `applyAction`) clears it again if this conquest wins the game.
      next = { ...next, pendingOccupation: { from: fromId, to: toId, min } };
    }
  }
  return { ok: true, state: next, events };
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
