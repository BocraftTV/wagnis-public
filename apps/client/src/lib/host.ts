// Host controls: what to offer and which messages to send (plan 007, section 5). Presentation only: whether an
// action is valid is decided by the server (host, room status, turn, target), never here. The `turn` of a skip
// always comes from the view, never from a calculation.
import type { ClientMessage, GameViewMessage, RoomView } from "@wagnis/shared";

type Game = NonNullable<RoomView["game"]>;

export type PlayerStatus = "removed" | "eliminated" | "active";

/** Display only: removed by the host, out of the game (no territory), or in. Removed wins over eliminated. */
export function playerStatus(
  game: Pick<GameViewMessage, "removedPlayerIds" | "playerOrder" | "territories">,
  playerId: string,
): PlayerStatus {
  if (game.removedPlayerIds.includes(playerId)) return "removed";
  const holds = Object.values(game.territories).some((t) => t.ownerId === playerId);
  return holds ? "active" : "eliminated";
}

export interface PlayerControls {
  /** "Zug überspringen": the active player's row, running game only (the host may skip himself). */
  skip: boolean;
  /** "Entfernen": lobby or running game, not the own row, not already removed. */
  remove: boolean;
  /** "Zum Host machen": not the own row, not removed, only for a connected player (any room status). */
  transfer: boolean;
}

const none: PlayerControls = { skip: false, remove: false, transfer: false };

/** Per player id, what the host sees. Everybody else gets nothing. */
export function hostControls(view: RoomView): Record<string, PlayerControls> {
  const out: Record<string, PlayerControls> = {};
  for (const p of view.players) {
    if (!view.you.isHost) {
      out[p.id] = none;
      continue;
    }
    const mine = p.id === view.you.playerId;
    const removed = p.removed;
    const running = view.status === "playing" && view.game !== null && view.game.winnerId === null;
    out[p.id] = {
      skip: running && !removed && view.game!.activePlayerId === p.id,
      remove: !mine && !removed && (view.status === "lobby" || view.status === "playing"),
      transfer: !mine && !removed && p.connected,
    };
  }
  return out;
}

/** "Zurück zur Lobby" is offered to the host after the end of the game. */
export function canBackToLobby(view: RoomView): boolean {
  return view.you.isHost && view.status === "finished";
}

export const skipMessage = (game: Pick<Game, "turn">): ClientMessage => ({
  type: "host",
  action: { type: "skipTurn", turn: game.turn },
});
export const removeMessage = (playerId: string): ClientMessage => ({
  type: "host",
  action: { type: "removePlayer", playerId },
});
export const transferMessage = (playerId: string): ClientMessage => ({
  type: "host",
  action: { type: "transferHost", playerId },
});
export const backToLobbyMessage = (): ClientMessage => ({ type: "backToLobby" });
export const settingsMessage = (patch: {
  mapId?: "welt" | "testland";
  victoryMode?: "missions" | "domination";
}): ClientMessage => ({ type: "settings", ...patch });

/** "Annas", "Max'" (names ending in s, ß, x or z take only the apostrophe). */
export function genitive(name: string): string {
  return /[sßxz]$/i.test(name) ? `${name}'` : `${name}s`;
}

export const confirmSkipText = (name: string): string =>
  `${genitive(name)} Zug beenden? Noch nicht gesetzte Verstärkungen verfallen.`;

export const confirmRemoveText = (name: string, status: RoomView["status"]): string =>
  status === "lobby"
    ? `${name} entfernen? Der Platz wird frei, ${name} kann neu beitreten.`
    : `${name} entfernen? Die Gebiete von ${name} werden neutral, die Karten kommen aus dem Spiel. Das lässt sich nicht rückgängig machen.`;

export const confirmTransferText = (name: string): string =>
  `${name} zum Host machen? Du verlierst die Host-Rechte (Überspringen, Entfernen, Einstellungen). ${name} kann dich danach entfernen.`;

/** Name with the mark for removed players ("Anna (entfernt)"), for the list and for the resolution texts. */
export const nameWithMark = (name: string, removed: boolean): string =>
  removed ? `${name} (entfernt)` : name;
