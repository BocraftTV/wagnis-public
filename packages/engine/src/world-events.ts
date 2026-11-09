import { getMap } from "./maps/index.js";
import { isEliminated } from "./players.js";
import { shuffle } from "./shuffle.js";
import type { MapDefinition } from "./map/types.js";
import type {
  GameEvent,
  GameState,
  PlayerId,
  Rng,
  TerritoryId,
  WorldEvent,
  WorldEventKind,
} from "./types.js";

/** The eight cards of the deck, one each (rules.md 12). */
export const WORLD_EVENT_KINDS: readonly WorldEventKind[] = [
  "storm",
  "goldRush",
  "plague",
  "mobilize",
  "truce",
  "rebellion",
  "cardFlood",
  "fog",
];

/** Extra armies of the mobilize event, once per player at the start of their turn. */
export const MOBILIZE_BONUS = 3;

/** A shuffled deck with one card of every event. */
export const freshEventDeck = (rng: Rng): WorldEventKind[] => shuffle([...WORLD_EVENT_KINDS], rng);

/** The event of the current round if it is of `kind`, else null. */
export const eventOf = (state: GameState, kind: WorldEventKind): WorldEvent | null =>
  state.worldEvent?.kind === kind ? state.worldEvent : null;

/** Whether `a` - `b` is a sea route of the map. */
export const isSeaRoute = (map: MapDefinition, a: TerritoryId, b: TerritoryId): boolean =>
  map.seaRoutes.some(([x, y]) => (x === a && y === b) || (x === b && y === a));

/** Neighbours of a territory that can be used now: sea routes drop out during a storm. */
export function usableNeighbors(
  map: MapDefinition,
  state: GameState,
  id: TerritoryId,
): TerritoryId[] {
  const all = map.territories.find((t) => t.id === id)?.neighbors ?? [];
  return eventOf(state, "storm") ? all.filter((n) => !isSeaRoute(map, id, n)) : all;
}

const empty = (kind: WorldEventKind): WorldEvent => ({
  kind,
  continentId: null,
  playerIds: [],
  territoryIds: [],
});

/** Plague: every territory of the continent with at least 2 armies loses 1 (neutral ones too). */
function plague(state: GameState, map: MapDefinition, continentId: string): GameState {
  const territories = { ...state.territories };
  for (const t of map.territories) {
    const cur = territories[t.id];
    if (t.continentId === continentId && cur && cur.armies >= 2) {
      territories[t.id] = { ...cur, armies: cur.armies - 1 };
    }
  }
  return { ...state, territories };
}

/**
 * Rebellion: the player(s) with the most territories (tie: most armies in total, then all who are level) lose two
 * random territories with their armies to the neutral owner, never their last (rules.md 12, questions 65, 66).
 */
function rebellion(
  state: GameState,
  map: MapDefinition,
  rng: Rng,
): { state: GameState; playerIds: PlayerId[]; territoryIds: TerritoryId[] } {
  const rows = state.playerOrder
    .filter((p) => !isEliminated(state, p))
    .map((p) => {
      const own = map.territories.filter((t) => state.territories[t.id]?.ownerId === p);
      return {
        p,
        own: own.map((t) => t.id),
        armies: own.reduce((n, t) => n + (state.territories[t.id]?.armies ?? 0), 0),
      };
    });
  const most = Math.max(0, ...rows.map((r) => r.own.length));
  const top = rows.filter((r) => r.own.length === most);
  const armies = Math.max(0, ...top.map((r) => r.armies));
  const hit = top.filter((r) => r.armies === armies);
  const territories = { ...state.territories };
  const playerIds: PlayerId[] = [];
  const lost: TerritoryId[] = [];
  for (const r of hit) {
    const take = Math.min(2, r.own.length - 1);
    if (take <= 0) continue;
    playerIds.push(r.p);
    for (const id of shuffle(r.own, rng).slice(0, take)) {
      territories[id] = { ...territories[id]!, ownerId: null };
      lost.push(id);
    }
  }
  return { state: { ...state, territories }, playerIds, territoryIds: lost };
}

/**
 * Draws the event of a new round (rules.md 12): the top card of the deck; an empty deck is first refilled with all
 * eight (question 60). Storm on a map without sea routes is skipped. The random choices (continent, rebelling
 * territories) and the one-off effects (plague, rebellion) happen here. Without `rules.worldEvents` nothing changes.
 */
export function drawWorldEvent(
  state: GameState,
  rng: Rng,
): { state: GameState; events: GameEvent[] } {
  const map = getMap(state.mapId);
  if (!state.rules.worldEvents || !map) return { state, events: [] };
  let deck = [...state.secret.eventDeck];
  let kind: WorldEventKind | undefined;
  for (let guard = 3 * WORLD_EVENT_KINDS.length; guard > 0 && kind === undefined; guard--) {
    if (deck.length === 0) deck = freshEventDeck(rng);
    const top = deck.shift()!;
    if (top === "storm" && map.seaRoutes.length === 0) continue;
    kind = top;
  }
  if (kind === undefined) return { state, events: [] };
  let event = empty(kind);
  let next: GameState = state;
  if (kind === "goldRush" || kind === "plague" || kind === "truce") {
    const continentId = map.continents[rng.int(map.continents.length)]!.id;
    event = { ...event, continentId };
    if (kind === "plague") next = plague(next, map, continentId);
  } else if (kind === "rebellion") {
    const r = rebellion(next, map, rng);
    next = r.state;
    event = { ...event, playerIds: r.playerIds, territoryIds: r.territoryIds };
  }
  next = { ...next, worldEvent: event, secret: { ...next.secret, eventDeck: deck } };
  return { state: next, events: [{ type: "worldEventDrawn", event }] };
}
