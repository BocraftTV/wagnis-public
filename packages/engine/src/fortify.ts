import { findTerritory } from "./attack.js";
import { getMap } from "./maps/index.js";
import type { MapDefinition } from "./map/types.js";
import { endTurn } from "./turn.js";
import { checkVictory } from "./victory.js";
import type {
  Action,
  ActionErrorCode,
  ActionResult,
  GameEvent,
  GameState,
  PlayerId,
  FortifyView,
  Rng,
  TerritoryId,
} from "./types.js";

type FortifyAction = Extract<Action, { type: "fortify" }>;

const fail = (code: ActionErrorCode): ActionResult => ({ ok: false, code });

const neighborsOf = (map: MapDefinition, id: TerritoryId): TerritoryId[] =>
  map.territories.find((t) => t.id === id)?.neighbors ?? [];

/**
 * Own territories the player may move armies to from `fromId` (never `fromId` itself): direct own
 * neighbours for `"adjacent"`, every territory reachable over a chain of own territories for `"connected"`.
 */
export function fortifyTargets(
  map: MapDefinition,
  state: GameState,
  playerId: PlayerId,
  fromId: TerritoryId,
): Set<TerritoryId> {
  const own = (id: TerritoryId): boolean => state.territories[id]?.ownerId === playerId;
  const reached = new Set<TerritoryId>();
  if (state.rules.fortifyReach === "adjacent") {
    for (const n of neighborsOf(map, fromId)) if (own(n)) reached.add(n);
    return reached;
  }
  const queue: TerritoryId[] = [fromId];
  const seen = new Set<TerritoryId>([fromId]);
  for (let next = queue.shift(); next !== undefined; next = queue.shift()) {
    for (const n of neighborsOf(map, next)) {
      if (seen.has(n) || !own(n)) continue;
      seen.add(n);
      reached.add(n);
      queue.push(n);
    }
  }
  return reached;
}

/** Order of checks: rules.md 5.3 (turn, game-over and pending-occupation checks come before, in `applyAction`). */
export function applyFortify(
  state: GameState,
  playerId: PlayerId,
  action: FortifyAction,
  rng: Rng,
): ActionResult {
  if (state.phase !== "fortify") return fail("WRONG_PHASE");
  const from = findTerritory(state, action.from);
  const to = findTerritory(state, action.to);
  if (!from || !to) return fail("UNKNOWN_TERRITORY");
  if (from.ownerId !== playerId || to.ownerId !== playerId) return fail("NOT_OWNER");
  if (action.from === action.to) return fail("SAME_TERRITORY");
  const map = getMap(state.mapId);
  if (!map) return fail("UNKNOWN_MAP");
  if (!fortifyTargets(map, state, playerId, action.from).has(action.to)) {
    return fail("NOT_CONNECTED");
  }
  if (!Number.isInteger(action.count) || action.count < 1 || action.count > from.armies - 1) {
    return fail("INVALID_COUNT");
  }
  const moved: GameState = {
    ...state,
    territories: {
      ...state.territories,
      [action.from]: { ...from, armies: from.armies - action.count },
      [action.to]: { ...to, armies: to.armies + action.count },
    },
  };
  const events: GameEvent[] = [
    { type: "armiesFortified", playerId, from: action.from, to: action.to, count: action.count },
  ];
  // The mover is checked before the turn ends: a win means no turn end, no card draw, no turn change.
  const checked = checkVictory(moved, events);
  if (checked.state.winnerId !== null) return { ok: true, ...checked };
  return endTurn(checked.state, checked.events, rng);
}

/** The fortify view for the active player: groups ("connected") or targets per origin ("adjacent"). */
export function fortifyView(map: MapDefinition, state: GameState, playerId: PlayerId): FortifyView {
  const own = map.territories.filter((t) => state.territories[t.id]?.ownerId === playerId);
  if (state.rules.fortifyReach === "adjacent") {
    const targets: Record<TerritoryId, TerritoryId[]> = {};
    for (const t of own) {
      if ((state.territories[t.id]?.armies ?? 0) < 2) continue;
      const to = own.filter((o) => t.neighbors.includes(o.id)).map((o) => o.id);
      if (to.length > 0) targets[t.id] = to;
    }
    return { reach: "adjacent", targets };
  }
  const groups: TerritoryId[][] = [];
  const done = new Set<TerritoryId>();
  for (const t of own) {
    if (done.has(t.id)) continue;
    const members = new Set([t.id, ...fortifyTargets(map, state, playerId, t.id)]);
    for (const m of members) done.add(m);
    if (members.size >= 2) groups.push(own.filter((o) => members.has(o.id)).map((o) => o.id));
  }
  return { reach: "connected", groups };
}
