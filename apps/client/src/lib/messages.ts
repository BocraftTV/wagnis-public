import type { HttpErrorCode, WsErrorCode } from "@wagnis/shared";

export type ClientHttpError = HttpErrorCode | "NETWORK";

export const httpErrorText: Record<ClientHttpError, string> = {
  VALIDATION: "Bitte Eingaben prüfen (Name: 1–16 Zeichen).",
  BAD_CREATE_CODE: "Der Erstell-Code ist falsch.",
  ROOM_NOT_FOUND: "Diesen Raum gibt es nicht.",
  ROOM_NOT_JOINABLE: "Die Partie hat schon begonnen.",
  ROOM_FULL: "Der Raum ist voll (höchstens 6 Spieler).",
  NAME_TAKEN: "Dieser Name ist im Raum schon vergeben.",
  RATE_LIMITED: "Zu viele Fehlversuche. Bitte später erneut versuchen.",
  NOT_FOUND: "Nicht gefunden.",
  INTERNAL: "Serverfehler. Bitte später erneut versuchen.",
  NETWORK: "Keine Verbindung zum Server.",
};

export const wsErrorText: Record<WsErrorCode, string> = {
  BAD_MESSAGE: "Ungültige Nachricht.",
  NOT_AUTHENTICATED: "Nicht angemeldet.",
  RATE_LIMITED: "Zu viele Fehlversuche. Bitte später erneut versuchen.",
  NOT_HOST: "Nur der Host kann die Partie starten.",
  NOT_IN_LOBBY: "Die Partie läuft schon.",
  NOT_IN_GAME: "Es läuft gerade keine Partie.",
  NOT_ENOUGH_PLAYERS: "Zum Starten braucht es mindestens 2 Spieler.",
  START_FAILED: "Die Partie konnte nicht gestartet werden.",
  INTERNAL: "Serverfehler.",
  STATE_UNSUPPORTED:
    "Dieser Spielstand stammt aus einer neueren Version und kann nicht geladen werden.",
  NOT_YOUR_TURN: "Du bist nicht am Zug.",
  WRONG_PHASE: "Das geht in dieser Phase nicht.",
  UNKNOWN_TERRITORY: "Unbekanntes Gebiet.",
  NOT_OWNER: "Dieses Gebiet gehört dir nicht.",
  INVALID_COUNT: "Ungültige Anzahl.",
  NOT_ENOUGH_REINFORCEMENTS: "So viele Armeen hast du nicht mehr.",
  REINFORCEMENTS_REMAINING: "Erst alle Armeen setzen.",
  UNKNOWN_ACTION: "Unbekannte Aktion.",
  UNKNOWN_MAP: "Unbekannte Karte.",
  INVALID_DICE: "Diese Würfelzahl ist nicht möglich.",
  NOT_ADJACENT: "Dieses Gebiet grenzt nicht an.",
  OWN_TARGET: "Du kannst kein eigenes Gebiet angreifen.",
  NOT_ENOUGH_ARMIES: "Zum Angreifen braucht es mindestens 2 Armeen.",
  OCCUPY_PENDING: "Erst Armeen nachrücken lassen.",
  NO_OCCUPY_PENDING: "Es gibt nichts nachzurücken.",
  INVALID_OCCUPY_COUNT: "Diese Anzahl ist beim Nachrücken nicht möglich.",
  GAME_OVER: "Die Partie ist beendet.",
  SAME_TERRITORY: "Herkunft und Ziel müssen verschieden sein.",
  NOT_CONNECTED: "Das Ziel ist über eigene Gebiete nicht erreichbar.",
  MUST_TRADE: "Du musst zuerst Karten tauschen.",
  INVALID_SET: "Diese Karten ergeben keinen Satz.",
  UNKNOWN_CARD: "Diese Karte hast du nicht.",
  INVALID_BONUS_TERRITORY: "Dieses Gebiet bringt keinen Bonus.",
  STALE_TURN: "Der Zug hat inzwischen gewechselt.",
  UNKNOWN_PLAYER: "Dieser Spieler ist nicht mehr dabei.",
  PLAYER_REMOVED: "Dieser Spieler ist nicht mehr dabei.",
  ALREADY_CHOSEN: "Du hast schon gewählt.",
  INVALID_CHOICE: "Diese Auswahl gibt es nicht.",
  NOT_FINISHED: "Die Partie läuft noch.",
  CANNOT_REMOVE_SELF: "Gib erst die Host-Rolle ab, dann kann dich der neue Host entfernen.",
  ALREADY_HOST: "Das ist schon der Host.",
  NOT_PRESENT: "Dieser Spieler ist gerade nicht verbunden.",
};

export const phaseText = {
  missionChoice: "Mission wählen",
  reinforce: "Verstärken",
  attack: "Angriff",
  fortify: "Verschieben",
} as const;

/** Hint in the "Verschieben" bar; the counter variant only differs after the first move of two. */
export function fortifyHintText(
  state: "none" | "pick-origin" | "pick-target" | "ready",
  movesDone: number,
): string {
  if (state === "none") return "Hier lässt sich nichts verschieben. „Zug beenden“ antippen.";
  if (state === "pick-origin") {
    return movesDone > 0
      ? "Zweite Verschiebung möglich, oder „Zug beenden“ antippen."
      : "Eigenes Gebiet antippen, aus dem du Armeen verschiebst (optional).";
  }
  return "Hervorgehobenes Ziel antippen.";
}
