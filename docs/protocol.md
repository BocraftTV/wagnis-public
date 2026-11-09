# Protokoll

Schemas (zod) liegen in `packages/shared/src` (`http.ts`, `ws.ts`, `view.ts`) und sind die maßgebliche Quelle.
Alle Antworten tragen den Header `X-Robots-Tag: noindex`. Der Server sendet nie den rohen Spielzustand,
nur `RoomView`-Snapshots, gebaut mit `viewFor`.

## Raum-ID

6 Zeichen aus `ABCDEFGHJKMNPQRSTUVWXYZ23456789`. Eingaben werden normalisiert (trimmen, Großbuchstaben,
`-` und Leerzeichen entfernen). Anzeige als `K7M-2XQ`, URL `/r/K7M2XQ`.

## HTTP

Fehlerformat: `{ "error": { "code": "BAD_CREATE_CODE", "message": "Wrong create code." } }`.
Codes: `VALIDATION` 400, `BAD_CREATE_CODE` 403, `ROOM_NOT_FOUND` 404, `NOT_FOUND` 404,
`ROOM_NOT_JOINABLE` 409, `ROOM_FULL` 409, `NAME_TAKEN` 409, `RATE_LIMITED` 429, `INTERNAL` 500.

### `GET /healthz`

```json
{ "ok": true }
```

### `POST /api/rooms`

```json
{ "createCode": "<WAGNIS_CREATE_CODE>", "hostName": "Anna", "mapId": "welt" }
```

`mapId` ist optional und legt die Karte des Raums fest: `"welt"` (Standard, 42 Gebiete) oder `"testland"` (kleine
Testkarte, 8 Gebiete). Eine andere ID ergibt `VALIDATION`. Das ist der Anfangswert: Der Host darf Karte und Siegmodus in der
Lobby per `settings` ändern (dazu die Verschiebungen pro Zug, Standard 1). Räume, die vor Phase 5 angelegt wurden, laufen auf `testland`.

`201`:

```json
{ "roomId": "K7M2XQ", "playerId": "6f1c…", "playerToken": "q3b…(43 Zeichen base64url)" }
```

Der Erstell-Code wird per SHA-256 + `timingSafeEqual` geprüft. Nur falsche Codes zählen für das Rate-Limit
(5 in 10 Minuten pro IP).

### `POST /api/rooms/:id/join`

```json
{ "name": "Ben" }
```

`200`: `{ "playerId": "…", "playerToken": "…" }`. Nur im Status `lobby`, höchstens 6 Spieler, Name 1–16
Zeichen (nach Trimmen), im Raum eindeutig (Groß-/Kleinschreibung egal). Nur unbekannte Räume zählen für das
Rate-Limit (30 Fehlversuche in 10 Minuten pro IP, gemeinsam mit fehlgeschlagenem `hello`).

### Sonstige GET-Anfragen

Nicht-API-Pfade ohne Dateiendung liefern `index.html` (SPA-Fallback), z. B. `/r/K7M2XQ`.

## WebSocket `/ws`

JSON-Nachrichten, höchstens 16 KB. Das Token steht nie in der URL.

### Client → Server

```json
{ "type": "hello", "roomId": "K7M2XQ", "token": "<playerToken>" }
{ "type": "start" }
{ "type": "settings", "mapId": "welt", "victoryMode": "domination" }
{ "type": "settings", "fortifyMoves": 2 }
{ "type": "host", "reqId": "h1", "action": { "type": "skipTurn", "turn": 12 } }
{ "type": "host", "reqId": "h2", "action": { "type": "removePlayer", "playerId": "9a2e…" } }
{ "type": "host", "reqId": "h3", "action": { "type": "transferHost", "playerId": "9a2e…" } }
{ "type": "backToLobby" }
{ "type": "action", "reqId": "c1", "action": { "type": "placeArmies", "territoryId": "eisenfurt", "count": 1 } }
{ "type": "action", "reqId": "c2", "action": { "type": "endPhase" } }
{ "type": "action", "reqId": "c3", "action": { "type": "attack", "from": "eisenfurt", "to": "rabenhain", "dice": 3 } }
{ "type": "action", "reqId": "c4", "action": { "type": "blitz", "from": "eisenfurt", "to": "rabenhain" } }
{ "type": "action", "reqId": "c5", "action": { "type": "occupy", "count": 3 } }
{ "type": "action", "reqId": "c6", "action": { "type": "fortify", "from": "eisenfurt", "to": "tannenfeld", "count": 2 } }
{ "type": "action", "reqId": "c7", "action": { "type": "tradeCards", "cardIds": ["card-eisenfurt", "card-rabenhain", "card-joker-1"], "bonusTerritoryId": "eisenfurt" } }
{ "type": "action", "reqId": "c8", "action": { "type": "tradeCards", "cardIds": ["card-eisenfurt", "card-rabenhain", "card-grauwacht"] } }
```

- `hello` muss die erste Nachricht sein und binnen 5 s eintreffen, sonst (oder bei falschem Token/Raum)
  schließt der Server mit Code 4001.
- `start`: nur Host, nur in der Lobby, ab 2 Spielern. Karte und Siegmodus kommen aus dem Raum (siehe `settings`).
- `settings` (Phase 6a, Plan 011): nur Host, nur in der Lobby. Mindestens eines der Felder `mapId` (`"welt"` | `"testland"`),
  `victoryMode` (`"missions"` | `"domination"`) und `fortifyMoves` (`1` | `2`, Verschiebungen pro Zug), sonst `BAD_MESSAGE`;
  unbekannte Werte (z. B. `0`, `3`, `"2"`, `true`) und zusätzliche Felder ebenso. Jede Änderung erhöht `version` und geht als
  Snapshot an alle. In einer laufenden oder beendeten Partie ändert sich die Einstellung nie (`NOT_IN_LOBBY`); nach
  `backToLobby` darf der Host sie wieder ändern.
- `host` (Phase 6a): nur Host. `action` ist `skipTurn` (`turn` ganzzahlig ≥ 1, muss die aktuelle `game.turn` sein, sonst
  `STALE_TURN`; der Zug des aktiven Spielers endet, `docs/rules.md` 1.6) oder `removePlayer` (`playerId`, 1–64 Zeichen;
  in der Lobby wird der Sitz freigegeben, im Spiel werden die Gebiete neutral). Der Host kann sich nicht selbst entfernen
  (`CANNOT_REMOVE_SELF`). `reqId` optional wie bei `action`. Die Identität des Absenders kommt wie immer aus der Verbindung.
  Die ausdrückliche Host-Übergabe `transferHost` (`playerId`, 1–64 Zeichen) ist ebenfalls eine `host`-Aktion, gilt in Lobby,
  laufender und beendeter Partie und wird vom Server ohne Engine ausgeführt: nur an einen anderen, nicht entfernten, **gerade
  verbundenen** Spieler (`UNKNOWN_PLAYER`, `PLAYER_REMOVED`, `ALREADY_HOST`, `NOT_PRESENT`); danach ist genau ein anderer Spieler Host
  (`players[].isHost`, `you.isHost`), `version` steigt um 1, alle bekommen einen Snapshot.
- `backToLobby` (Phase 6a): nur Host, nur im Status `finished` (sonst `NOT_FINISHED`). Alle Spieler (Sitz, Name, Host, Token)
  bleiben, entfernte Spieler verlieren ihren Platz; der Raum ist wieder `lobby`, `game` ist `null`, `gameNo` steigt um 1,
  `version` zählt weiter.
- Prüfreihenfolge der Host-Nachrichten: gültige Nachricht (`BAD_MESSAGE`), Host (`NOT_HOST`), Raumstatus (`settings`:
  `NOT_IN_LOBBY`; `host`: `NOT_IN_GAME`, beim Entfernen auch in der Lobby erlaubt; `backToLobby`: `NOT_FINISHED`), dann Ziel
  und Engine (`UNKNOWN_PLAYER`, `CANNOT_REMOVE_SELF`, `PLAYER_REMOVED`, `ALREADY_HOST`, `NOT_PRESENT`, `GAME_OVER`, `STALE_TURN`; `transferHost` prüft keinen Raumstatus).
- `action`: `reqId` ist optional und wird in Fehlern zurückgegeben. Die Spieler-Identität kommt aus der
  Verbindung, nie aus der Nachricht.
- Angriff (nur Formprüfung im Schema, die Regeln prüft die Engine): `attack` mit `dice` ganzzahlig 1–3, `blitz`
  ohne Würfelzahl (maximale Würfel, wiederholt bis Eroberung oder 1 Armee übrig), `occupy` mit `count`
  ganzzahlig ≥ 1. `count` ist die **Gesamtzahl** nachgezogener Armeen (mindestens die Würfel des Siegwurfs,
  höchstens alle bis auf 1). Der Server würfelt; Würfel und Ausgang stehen im Snapshot (`lastCombat`).
- Verschieben und Karten (nur Formprüfung im Schema, die Regeln prüft die Engine): `fortify` mit `from`, `to`
  (nicht leere Strings) und `count` ganzzahlig ≥ 1; je nach Raumeinstellung `fortifyMoves` ist es eine Verschiebung pro Zug
  (sie beendet den Zug) oder sind es bis zu zwei (nach der ersten bleibt der Spieler am Zug, `endPhase` beendet ihn); nach der
  letzten erlaubten Verschiebung endet der Zug, eine weitere gibt `NOT_YOUR_TURN`. `tradeCards` mit `cardIds` (genau 3 nicht leere Strings) und optionalem `bonusTerritoryId`; eine
  Action tauscht genau einen Satz. Ohne `bonusTerritoryId` nimmt die Engine das erste passende Gebiet in der
  Reihenfolge von `cardIds`. Karten-IDs stehen in Nachrichten nur in der eigenen Hand, in `suggestedSets` und in
  `lastTrade` (die getauschten Karten sind öffentlich), sonst nie; auch Stapel und Ablagestapel verlassen den
  Server nie.

### Server → Client

```json
{
  "type": "snapshot",
  "view": {
    "roomId": "K7M2XQ",
    "status": "playing",
    "mapId": "testland",
    "version": 3,
    "you": { "playerId": "6f1c…", "isHost": true },
    "players": [
      { "id": "6f1c…", "name": "Anna", "seat": 0, "isHost": true, "connected": true, "removed": false },
      { "id": "9a2e…", "name": "Ben", "seat": 1, "isHost": false, "connected": false, "removed": false }
    ],
    "victoryMode": "missions",
    "fortifyMoves": 1,
    "gameNo": 1,
    "publicUrl": null,
    "game": {
      "mapId": "testland",
      "phase": "reinforce",
      "turn": 1,
      "activePlayerId": "6f1c…",
      "playerOrder": ["6f1c…", "9a2e…"],
      "removedPlayerIds": [],
      "reinforcementsLeft": 3,
      "territories": { "eisenfurt": { "ownerId": "6f1c…", "armies": 4, "maxAttackDice": 3, "maxMove": 3 } },
      "pendingOccupation": { "from": "eisenfurt", "to": "rabenhain", "min": 3, "max": 4 },
      "conqueredThisTurn": true,
      "winnerId": null,
      "winReason": null,
      "victoryMode": "missions",
      "missions": null,
      "lastCombat": {
        "seq": 7,
        "attackerId": "6f1c…",
        "defenderId": "9a2e…",
        "from": "eisenfurt",
        "to": "rabenhain",
        "rolls": [
          { "attackerDice": [6, 5, 4], "defenderDice": [3], "attackerLosses": 0, "defenderLosses": 1 }
        ],
        "summary": { "rollCount": 1, "attackerLosses": 0, "defenderLosses": 1, "conquered": true }
      },
      "lastTrade": null,
      "deckCount": 8,
      "discardCount": 0,
      "fortify": null,
      "secret": { "mission": null, "missionReplaced": false, "hand": [], "suggestedSets": [], "mustTrade": false },
      "handCounts": { "6f1c…": 0, "9a2e…": 0 }
    }
  }
}
{ "type": "error", "code": "NOT_YOUR_TURN", "reqId": "c1" }
{ "type": "error", "code": "STATE_UNSUPPORTED" }
```

Ausschnitt eines Snapshots für den aktiven Spieler in der Verstärkungsphase mit 5 Karten (Pflichttausch offen;
`view.game`, nur die für Phase 3 relevanten Felder):

```json
{
  "type": "snapshot",
  "view": {
    "roomId": "K7M2XQ",
    "status": "playing",
    "mapId": "testland",
    "version": 12,
    "you": { "playerId": "6f1c…", "isHost": true },
    "players": [
      {
        "id": "6f1c…",
        "name": "Anna",
        "seat": 0,
        "isHost": true,
        "connected": true,
        "removed": false
      },
      {
        "id": "9a2e…",
        "name": "Ben",
        "seat": 1,
        "isHost": false,
        "connected": true,
        "removed": false
      }
    ],
    "victoryMode": "missions",
    "fortifyMoves": 1,
    "gameNo": 1,
    "publicUrl": null,
    "game": {
      "mapId": "testland",
      "phase": "reinforce",
      "turn": 5,
      "activePlayerId": "6f1c…",
      "playerOrder": ["6f1c…", "9a2e…"],
      "removedPlayerIds": [],
      "reinforcementsLeft": 3,
      "territories": {
        "eisenfurt": { "ownerId": "6f1c…", "armies": 2, "maxAttackDice": 1, "maxMove": 1 },
        "tannenfeld": { "ownerId": "6f1c…", "armies": 3, "maxAttackDice": 2, "maxMove": 2 }
      },
      "pendingOccupation": null,
      "conqueredThisTurn": false,
      "winnerId": null,
      "winReason": null,
      "victoryMode": "missions",
      "missions": null,
      "lastCombat": null,
      "lastTrade": {
        "seq": 2,
        "playerId": "9a2e…",
        "cards": [
          { "id": "card-rabenhain", "kind": "cavalry", "territoryId": "rabenhain" },
          { "id": "card-salzmoor", "kind": "cavalry", "territoryId": "salzmoor" },
          { "id": "card-nebelkueste", "kind": "cavalry", "territoryId": "nebelkueste" }
        ],
        "armies": 6,
        "bonusTerritoryId": null
      },
      "deckCount": 1,
      "discardCount": 6,
      "fortify": null,
      "secret": {
        "mission": null,
        "missionReplaced": false,
        "hand": [
          {
            "id": "card-eisenfurt",
            "kind": "infantry",
            "territoryId": "eisenfurt",
            "bonusEligible": true
          },
          {
            "id": "card-tannenfeld",
            "kind": "infantry",
            "territoryId": "tannenfeld",
            "bonusEligible": true
          },
          {
            "id": "card-kupferstadt",
            "kind": "infantry",
            "territoryId": "kupferstadt",
            "bonusEligible": false
          },
          {
            "id": "card-grauwacht",
            "kind": "artillery",
            "territoryId": "grauwacht",
            "bonusEligible": false
          },
          { "id": "card-joker-1", "kind": "joker", "territoryId": null, "bonusEligible": false }
        ],
        "suggestedSets": [
          {
            "cardIds": ["card-eisenfurt", "card-grauwacht", "card-joker-1"],
            "value": 10,
            "bonusTerritoryId": "eisenfurt"
          },
          {
            "cardIds": ["card-eisenfurt", "card-tannenfeld", "card-kupferstadt"],
            "value": 4,
            "bonusTerritoryId": "eisenfurt"
          }
        ],
        "mustTrade": true
      },
      "handCounts": { "6f1c…": 5, "9a2e…": 0 }
    }
  }
}
```

Snapshot in einer laufenden Partie mit einem entfernten Spieler (Cleo, Phase 6a; ihre Gebiete sind neutral, `removed` und
`game.removedPlayerIds` sehen alle):

```json
{
  "type": "snapshot",
  "view": {
    "roomId": "K7M2XQ",
    "status": "playing",
    "mapId": "testland",
    "version": 21,
    "you": { "playerId": "6f1c…", "isHost": true },
    "players": [
      {
        "id": "6f1c…",
        "name": "Anna",
        "seat": 0,
        "isHost": true,
        "connected": true,
        "removed": false
      },
      {
        "id": "9a2e…",
        "name": "Ben",
        "seat": 1,
        "isHost": false,
        "connected": true,
        "removed": false
      },
      {
        "id": "4d7b…",
        "name": "Cleo",
        "seat": 2,
        "isHost": false,
        "connected": false,
        "removed": true
      }
    ],
    "victoryMode": "missions",
    "fortifyMoves": 1,
    "gameNo": 1,
    "publicUrl": null,
    "game": {
      "mapId": "testland",
      "phase": "reinforce",
      "turn": 9,
      "activePlayerId": "9a2e…",
      "playerOrder": ["6f1c…", "9a2e…", "4d7b…"],
      "removedPlayerIds": ["4d7b…"],
      "reinforcementsLeft": 3,
      "territories": {
        "eisenfurt": { "ownerId": "6f1c…", "armies": 3, "maxAttackDice": 2, "maxMove": 2 },
        "kupferstadt": { "ownerId": null, "armies": 4, "maxAttackDice": 3, "maxMove": 3 }
      },
      "pendingOccupation": null,
      "conqueredThisTurn": false,
      "winnerId": null,
      "winReason": null,
      "victoryMode": "missions",
      "missions": null,
      "lastCombat": null,
      "lastTrade": null,
      "deckCount": 5,
      "discardCount": 4,
      "fortify": null,
      "secret": {
        "mission": null,
        "missionReplaced": false,
        "hand": [],
        "suggestedSets": [],
        "mustTrade": false
      },
      "handCounts": { "6f1c…": 0, "9a2e…": 2, "4d7b…": 0 }
    }
  }
}
```

Lobby-Snapshot nach „Zurück zur Lobby“ (zweite Partie im Raum: `gameNo` 2, `game` ist `null`, `version` zählt weiter, Cleo
ist als entfernte Spielerin aus der Liste verschwunden):

```json
{
  "type": "snapshot",
  "view": {
    "roomId": "K7M2XQ",
    "status": "lobby",
    "mapId": "testland",
    "version": 24,
    "you": { "playerId": "6f1c…", "isHost": true },
    "players": [
      {
        "id": "6f1c…",
        "name": "Anna",
        "seat": 0,
        "isHost": true,
        "connected": true,
        "removed": false
      },
      {
        "id": "9a2e…",
        "name": "Ben",
        "seat": 1,
        "isHost": false,
        "connected": true,
        "removed": false
      }
    ],
    "victoryMode": "domination",
    "fortifyMoves": 2,
    "gameNo": 2,
    "publicUrl": "http://192.0.2.10:3000",
    "game": null
  }
}
```

- Phase 6a, Raumfelder (öffentlich, für alle gleich): `players[].removed` (vom Host entfernt; in der Lobby immer `false`,
  weil dort entfernte Zeilen gelöscht werden), `victoryMode` (in der Lobby die Wahl des Hosts, im Spiel der Wert des
  Spielzustands; steht außerdem in `game.victoryMode`), `gameNo` (Partienummer im Raum ab 1, steigt bei jedem „Zurück zur
  Lobby“; der Client setzt damit seine Gesehen-Merker zurück) und `game.removedPlayerIds` (Reihenfolge des Entfernens).
  Tokens, Hashes, Gründe und Zeitstempel der Aktivität stehen in keinem Snapshot.
- Plan 011, `fortifyMoves` (öffentlich, für alle gleich, `1` oder `2`): Verschiebungen pro Zug; in der Lobby die Wahl des Hosts
  (Standard `1`), im Spiel der Wert des Spielstands (`rules.fortifyMoves`).
- Phase 6b, `publicUrl` (öffentlich, für alle gleich): der Ursprung aus der optionalen Umgebungsvariable `WAGNIS_PUBLIC_URL`
  (Schema, Host, Port; nie Pfad, Raumcode, Token oder Zugangsdaten; der Server prüft und normalisiert ihn beim Start). Der Wert
  steht nur im Raumstatus `lobby`, damit der Client den QR-Code bauen kann (er hängt `/r/<Raumcode>` selbst an); im Spiel und
  beim Beenden ist er `null`, ebenso überall, wenn die Variable nicht gesetzt ist (im Beispiel oben der Lobby-Snapshot mit
  gesetzter Adresse, die Spiel-Snapshots mit `null`). Keine neue Nachricht, keine neue Aktion.
- `mapId` (Phase 5): öffentlich, für alle Spieler gleich, schon in der Lobby gesetzt (die Karte des Raums, `"welt"`
  oder `"testland"`); im Spiel steht dieselbe ID in `game.mapId`. Das ist die einzige neue Angabe der Karte im Snapshot:
  Karte, Missionsliste und Regelwerte verlassen den Server nie als Daten, der Client kennt die Karte aus seinem Bundle.
- Snapshots sind vollständig; `game` ist in der Lobby `null`. `secret` enthält nur die eigenen Werte,
  von den anderen existiert nur `handCounts`.
- Neue Felder in `game` (alle öffentlich, für alle Spieler gleich):
  - `territories[id].maxAttackDice`: `min(3, Armeen − 1)`, mindestens 0, unabhängig von Phase und Besitzer
    (0 = kann nicht angreifen). Der Client rechnet die Obergrenze nicht selbst.
  - `pendingOccupation`: `null` oder `{ from, to, min, max }`, solange nach einer Eroberung das Nachrücken
    offen ist; gültig ist `occupy` mit `min ≤ count ≤ max`. Bis dahin lehnt der Server alles andere mit
    `OCCUPY_PENDING` ab.
  - `conqueredThisTurn`: in diesem Zug wurde mindestens ein Gebiet erobert.
  - `winnerId`: `null` oder die Spieler-ID, sobald jemand gewonnen hat (nur noch ein Spieler übrig oder im Modus
    `"missions"` die eigene Mission erfüllt; `docs/rules.md` Abschnitt 1.2).
  - `lastCombat`: `null` oder der letzte Kampf (eine `attack`- oder `blitz`-Action). `seq` zählt Kämpfe ab 1
    und springt nie zurück, auch nicht nach dem Leeren; ein Client stellt jeden Kampf anhand von `seq`
    genau einmal dar, auch nach einem Reconnect. `rolls` enthält höchstens die letzten 20 Würfe (Würfel
    absteigend sortiert, Verluste je Wurf), `summary` zählt über den ganzen Kampf (`rollCount`, Verluste je
    Seite, `conquered`). Das Feld bleibt stehen, bis der nächste Kampf es ersetzt (`occupy` und `endPhase`
    lassen es unverändert), wird beim Zugwechsel `null` und bleibt nach Spielende stehen.
  - Würfel erreichen die Clients ausschließlich über `lastCombat` (kein Event-Replay, keine Diffs).
- Neue Felder in `game` für Phase 3 (Regeln: `docs/rules.md` Abschnitte 5.3, 6 und 7):
  - `territories[id].maxMove` (öffentlich): `Armeen − 1`, mindestens 0, Obergrenze für `count` bei `fortify`.
  - `fortify`: nur für den aktiven Spieler in der Phase `fortify`, sonst `null`. Bei `fortifyReach`
    `"connected"` `{ "reach": "connected", "groups": [[Gebiets-IDs]] }` (Gruppen verbundener eigener Gebiete,
    nur Gruppen mit mindestens 2 Gebieten), bei `"adjacent"` `{ "reach": "adjacent", "targets": { Herkunft: [Ziele] } }`
    (nur Herkunftsgebiete mit mindestens 2 Armeen und mindestens einem Ziel). Der Client hebt nur hervor. In beiden Varianten
    stehen außerdem `movesDone` (bisher angenommene Verschiebungen in diesem Zug: bei Einstellung 1 immer `0`, bei 2 `0` oder
    `1`) und `movesMax` (die Raumeinstellung, `1` oder `2`), z. B. `{ "reach": "connected", "groups": [[…]], "movesDone": 1,
"movesMax": 2 }`. Nur der aktive Spieler sieht sie; der interne Zähler des Spielstands steht in keiner Nachricht.
  - `lastTrade` (öffentlich): `null` oder der letzte Tausch `{ seq, playerId, cards, armies, bonusTerritoryId }`
    mit den drei abgelegten Karten (`{ id, kind, territoryId }`). Wie `lastCombat`: `seq` springt nie zurück,
    das Feld bleibt stehen, bis der nächste Tausch es ersetzt, und wird beim Zugwechsel `null`.
  - `deckCount`, `discardCount` (öffentlich): Zahl der Karten in Stapel und Ablagestapel, nie der Inhalt.
  - `secret` (nur eigene Werte): `hand` (volle Karten: `id`, `kind` ∈ `infantry`/`cavalry`/`artillery`/`joker`,
    `territoryId` oder `null`), `suggestedSets` (höchstens ein Vorschlag je Tauschwert, also höchstens 4,
    absteigend nach Wert: der beste konkrete Satz der Hand `{ cardIds, value, bonusTerritoryId }`; „bester“:
    zuerst mit Gebietsbonus vor ohne, dann möglichst wenige Joker, dann nach Reihenfolge der Karten auf der Hand;
    nur in der eigenen Verstärkungsphase, sonst `[]`; die Größe hängt nicht von der Handgröße ab) und `mustTrade`
    (Pflichttausch offen: `placeArmies` und `endPhase` liefern `MUST_TRADE`). Der Spieler darf auch drei beliebige
    Handkarten frei wählen und als `tradeCards` senden; der Server prüft und lehnt Ungültiges mit `INVALID_SET`
    ab (auch wenn die Karten nicht unter den Vorschlägen stehen). Der Client berechnet keine Kombinationen.
  - Ein Beispiel für den aktiven Spieler in der Verstärkungsphase mit 5 Karten steht unter dem ersten Snapshot.
- Neue Felder in `game` für Phase 4 (Regeln: `docs/rules.md` Abschnitte 1.1 bis 1.5 und 7):
  - `territories[id].ownerId` und `lastCombat.defenderId` sind `null` für den neutralen Besitzer (nur bei 2 Spielern).
    Neutral ist kein Spieler: nicht in `playerOrder`, nicht in `handCounts`, nicht in `players`.
  - `victoryMode` (öffentlich): `"missions"` oder `"domination"`.
  - `winReason` (öffentlich): `null`, solange `winnerId` `null` ist, danach `"lastPlayer"` oder `"mission"`.
  - `secret.mission` (nur eigene): `null` (in `"domination"`) oder eine Mission als Daten, `type` ist `conquerContinents`
    (`continentIds`, `extraContinents`), `holdTerritories` (`count`, `minArmies`) oder `eliminatePlayer`
    (`targetPlayerId`). Die deutschen Texte erzeugt der Client. `secret.missionReplaced` (nur eigene): die Mission ist
    die Ersatzmission. `originalMission` steht vor Spielende in **keinem** Snapshot, auch nicht im eigenen.
  - `secret.hand[].bonusEligible` (nur eigene Hand): das Gebiet der Karte gehört aktuell dem Besitzer (Joker: `false`);
    die Karten in `lastTrade` haben das Feld nicht.
  - `missions` (Auflösung): `null`, solange `winnerId` `null` ist und im Modus `"domination"`; danach je Spieler
    `{ mission, originalMission }` (aktuelle Mission, und die ursprünglich zugeteilte nur dann, wenn sie ersetzt wurde,
    sonst `null`). Gilt für jeden Empfänger, auch bei `hello` nach Spielende und nach einem Neustart.
  - Fremde Missionen stehen vor Spielende in keiner Nachricht. Es gibt kein Event und kein öffentliches Feld für den
    Wechsel zur Ersatzmission; nur der Inhaber sieht ihn (`mission`, `missionReplaced`).
  - Der Spielstand-Version `stateVersion` ist intern und steht in keiner Nachricht.
  - Beispiele (Ausschnitte, die über `"example"` benannt sind; `game` ergänzt einen Basis-Snapshot, die Felder
    darin ersetzen die des Basis-Snapshots):

```json
{
  "example": "neutral",
  "game": {
    "territories": {
      "eisenfurt": { "ownerId": "6f1c…", "armies": 4, "maxAttackDice": 3, "maxMove": 3 },
      "rabenhain": { "ownerId": null, "armies": 2, "maxAttackDice": 1, "maxMove": 1 }
    },
    "lastCombat": {
      "seq": 1,
      "attackerId": "6f1c…",
      "defenderId": null,
      "from": "eisenfurt",
      "to": "rabenhain",
      "rolls": [
        {
          "attackerDice": [6, 5, 4],
          "defenderDice": [3, 2],
          "attackerLosses": 0,
          "defenderLosses": 2
        }
      ],
      "summary": { "rollCount": 1, "attackerLosses": 0, "defenderLosses": 2, "conquered": true }
    }
  }
}
```

```json
{
  "example": "mission-conquerContinents",
  "game": {
    "secret": {
      "mission": {
        "type": "conquerContinents",
        "continentIds": ["nordreich"],
        "extraContinents": 1
      },
      "missionReplaced": false,
      "hand": [],
      "suggestedSets": [],
      "mustTrade": false
    }
  }
}
```

```json
{
  "example": "mission-holdTerritories",
  "game": {
    "secret": {
      "mission": { "type": "holdTerritories", "count": 5, "minArmies": 2 },
      "missionReplaced": false,
      "hand": [],
      "suggestedSets": [],
      "mustTrade": false
    }
  }
}
```

```json
{
  "example": "mission-eliminatePlayer",
  "game": {
    "secret": {
      "mission": { "type": "eliminatePlayer", "targetPlayerId": "9a2e…" },
      "missionReplaced": false,
      "hand": [],
      "suggestedSets": [],
      "mustTrade": false
    }
  }
}
```

```json
{
  "example": "mission-replaced",
  "game": {
    "secret": {
      "mission": { "type": "holdTerritories", "count": 6, "minArmies": 2 },
      "missionReplaced": true,
      "hand": [],
      "suggestedSets": [],
      "mustTrade": false
    }
  }
}
```

Auflösung nach Spielende (Anna hat ihre Mission behalten, Ben bekam die Ersatzmission):

```json
{
  "example": "resolution",
  "game": {
    "winnerId": "6f1c…",
    "winReason": "mission",
    "missions": {
      "6f1c…": {
        "mission": { "type": "eliminatePlayer", "targetPlayerId": "9a2e…" },
        "originalMission": null
      },
      "9a2e…": {
        "mission": { "type": "holdTerritories", "count": 6, "minArmies": 2 },
        "originalMission": { "type": "eliminatePlayer", "targetPlayerId": "9a2e…" }
      }
    }
  }
}
```

Zieht ein Spieler beim Spielstart die Vernichtungsmission gegen sich selbst, bekommt er die Ersatzmission; die
Auflösung zeigt `originalMission` als `eliminatePlayer` mit dem Spieler selbst als Ziel (der Client erkennt den
Fall daran, es gibt kein zusätzliches Feld):

```json
{
  "example": "resolution-self-target",
  "game": {
    "winnerId": "6f1c…",
    "winReason": "mission",
    "missions": {
      "6f1c…": {
        "mission": { "type": "holdTerritories", "count": 5, "minArmies": 2 },
        "originalMission": null
      },
      "9a2e…": {
        "mission": { "type": "holdTerritories", "count": 6, "minArmies": 2 },
        "originalMission": { "type": "eliminatePlayer", "targetPlayerId": "9a2e…" }
      }
    }
  }
}
```

- Ein gespeicherter Spielstand mit einer neueren oder ungültigen `stateVersion` wird nicht geladen. Der Server
  antwortet auf `hello` und auf Actions mit `{ "type": "error", "code": "STATE_UNSUPPORTED" }` (bei Actions mit
  `reqId`), sendet keinen Snapshot und verändert den Raum nicht. Die Nachricht und das Log enthalten nur den Code und
  die Versionszahlen, nie Stand-Inhalte. Die feste deutsche Meldung („Dieser Spielstand stammt aus einer neueren
  Version und kann nicht geladen werden.“) steht im Client (`messages.ts`), nicht in der Nachricht.
- Ist `winnerId` gesetzt, steht der Raumstatus auf `finished`: der Server lehnt danach jede Action mit
  `NOT_IN_GAME` ab, `hello` mit gültigem Token funktioniert weiter und liefert den Snapshot (Status
  `finished`, `winnerId`, stehender `lastCombat`). Neue Spieler können nicht beitreten (`ROOM_NOT_JOINABLE`).
- `version` zählt Änderungen am gespeicherten Raumzustand (Beitritt, Start, angenommene Action, `settings`, Host-Aktion, `backToLobby`) und wird nie zurückgesetzt. Wechselt
  nur die Anwesenheit, kommt ein Snapshot mit unveränderter `version`. Clients übernehmen `version` ≥ aktueller.
- Auf `hello` folgt sofort ein Snapshot. Nach jeder angenommenen Action, jedem Beitritt und jedem
  Anwesenheitswechsel bekommt jeder verbundene Spieler seinen eigenen Snapshot.
- Fehler gehen nur an den Absender, es wird nichts gespeichert. Codes: `BAD_MESSAGE`, `NOT_AUTHENTICATED`,
  `RATE_LIMITED`, `NOT_HOST`, `NOT_IN_LOBBY`, `NOT_IN_GAME`, `NOT_ENOUGH_PLAYERS`, `START_FAILED`,
  `INTERNAL`, `STATE_UNSUPPORTED`, `NOT_FINISHED`, `CANNOT_REMOVE_SELF`, `ALREADY_HOST`, `NOT_PRESENT` sowie die Engine-Fehler `NOT_YOUR_TURN`, `WRONG_PHASE`, `UNKNOWN_TERRITORY`, `NOT_OWNER`,
  `INVALID_COUNT`, `NOT_ENOUGH_REINFORCEMENTS`, `REINFORCEMENTS_REMAINING`, `UNKNOWN_ACTION`, `UNKNOWN_MAP`
  sowie die Angriffsfehler `INVALID_DICE`, `NOT_ADJACENT`, `OWN_TARGET`, `NOT_ENOUGH_ARMIES`, `OCCUPY_PENDING`,
  `NO_OCCUPY_PENDING`, `INVALID_OCCUPY_COUNT`, `GAME_OVER` sowie die Fehler für Verschieben und Karten
  `SAME_TERRITORY`, `NOT_CONNECTED`, `MUST_TRADE`, `INVALID_SET`, `UNKNOWN_CARD`, `INVALID_BONUS_TERRITORY` sowie die Host-Fehler `STALE_TURN`, `UNKNOWN_PLAYER`, `PLAYER_REMOVED` (Bedeutung: `docs/rules.md` Abschnitt 8;
  `GAME_OVER` ist die Engine-Absicherung, der Server meldet nach Spielende vorher `NOT_IN_GAME`).

### Close-Codes

| Code  | Bedeutung                                                | Client                                       |
| ----- | -------------------------------------------------------- | -------------------------------------------- |
| 4001  | `hello` fehlt, ungültig oder Timeout                     | Token verwerfen, kein Reconnect              |
| 4002  | Von einer neueren Verbindung derselben Identität ersetzt | kein Reconnect, Button „Hier fortsetzen“     |
| 4003  | Rate-Limit                                               | weiter mit Backoff                           |
| 4004  | Vom Host entfernt                                        | Token verwerfen, kein Reconnect, Hinweis     |
| sonst | Verbindung verloren                                      | Reconnect, Backoff 0,5 s bis 5 s, unbegrenzt |

### Heartbeat

Der Server schickt alle 25 s ein Ping. Bleiben zwei Pongs aus, wird die Verbindung beendet und der Spieler
gilt als getrennt.
