import type { MapDefinition } from "./map/types.js";
import { getMissionSet } from "./maps/index.js";
import type { GameState, Mission, PlayerId } from "./types.js";
import { isEliminated } from "./players.js";

/** Deep copy of a mission (plain data); no `structuredClone`, which the engine build has no types for. */
export function cloneMission<M extends Mission>(m: M): M {
  return m.type === "conquerContinents" ? { ...m, continentIds: [...m.continentIds] } : { ...m };
}

/** Continents whose territories all belong to `playerId` (a neutral or foreign territory spoils it). */
function ownedContinents(state: GameState, map: MapDefinition, playerId: PlayerId): string[] {
  return map.continents
    .filter((c) => {
      const members = map.territories.filter((t) => t.continentId === c.id);
      return (
        members.length > 0 && members.every((t) => state.territories[t.id]?.ownerId === playerId)
      );
    })
    .map((c) => c.id);
}

/** Whether `mission` is met right now by `playerId`. Pure and read-only; only own territories count. */
export function isMissionMet(
  state: GameState,
  map: MapDefinition,
  playerId: PlayerId,
  mission: Mission,
): boolean {
  switch (mission.type) {
    case "conquerContinents": {
      const owned = ownedContinents(state, map, playerId);
      if (!mission.continentIds.every((id) => owned.includes(id))) return false;
      return (
        owned.filter((id) => !mission.continentIds.includes(id)).length >= mission.extraContinents
      );
    }
    case "holdTerritories": {
      let n = 0;
      for (const t of Object.values(state.territories)) {
        if (t.ownerId === playerId && t.armies >= mission.minArmies) n++;
      }
      return n >= mission.count;
    }
    case "eliminatePlayer":
      return isEliminated(state, mission.targetPlayerId);
    case "connectedRealm":
      return largestRealm(state, map, playerId) >= mission.count;
    case "blitzkrieg":
      // The counter belongs to the active player; nobody else can have it met.
      return playerId === state.activePlayerId && state.conquestsThisTurn >= mission.count;
  }
}

/** Size of the largest group of own territories that are linked by neighbours (land or sea); breadth-first over own ground only. */
export function largestRealm(state: GameState, map: MapDefinition, playerId: PlayerId): number {
  const neighbors = new Map(map.territories.map((t) => [t.id, t.neighbors]));
  const seen = new Set<string>();
  let best = 0;
  for (const t of map.territories) {
    if (seen.has(t.id) || state.territories[t.id]?.ownerId !== playerId) continue;
    let size = 0;
    const queue = [t.id];
    seen.add(t.id);
    while (queue.length > 0) {
      const id = queue.pop()!;
      size++;
      for (const n of neighbors.get(id) ?? []) {
        if (!seen.has(n) && state.territories[n]?.ownerId === playerId) {
          seen.add(n);
          queue.push(n);
        }
      }
    }
    best = Math.max(best, size);
  }
  return best;
}

/** Whether the player's current mission is met; false without a mission (`"domination"`). */
export function missionSatisfied(
  state: GameState,
  map: MapDefinition,
  playerId: PlayerId,
): boolean {
  const mission = state.secret.mission[playerId];
  return mission ? isMissionMet(state, map, playerId, mission) : false;
}

/**
 * Turns every `eliminatePlayer` mission aimed at `targetId` into the map's fallback, silently (no event, no public
 * field; rules.md 1.2 and 1.6). `exceptId` keeps one holder's mission as it is: the conqueror who just eliminated the
 * target wins with it (elimination); `null` spares nobody (removal by the host: the target is gone for everybody).
 * Only in `"missions"`; returns the same state otherwise.
 */
export function replaceTargetMissions(
  state: GameState,
  targetId: PlayerId,
  exceptId: PlayerId | null,
): GameState {
  const fallback = getMissionSet(state.mapId)?.fallback;
  if (state.rules.victoryMode !== "missions" || !fallback) return state;
  const mission = { ...state.secret.mission };
  const replaced = { ...state.secret.missionReplaced };
  for (const q of state.playerOrder) {
    const m = mission[q];
    if (q === exceptId || m?.type !== "eliminatePlayer" || m.targetPlayerId !== targetId) continue;
    mission[q] = cloneMission(fallback);
    replaced[q] = true;
  }
  // Open offers of the mission draft (plan 013): a card aimed at the target becomes the fallback in the offer too;
  // `missionOfferDealt` keeps the card as drawn.
  const offer = { ...state.secret.missionOffer };
  for (const q of state.playerOrder) {
    const o = offer[q];
    if (!o) continue;
    const swap = (m: Mission): Mission =>
      m.type === "eliminatePlayer" && m.targetPlayerId === targetId ? cloneMission(fallback) : m;
    offer[q] = [swap(o[0]), swap(o[1])];
  }
  return {
    ...state,
    secret: { ...state.secret, mission, missionReplaced: replaced, missionOffer: offer },
  };
}
