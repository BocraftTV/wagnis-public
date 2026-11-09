# Wagnis

Rundenbasiertes Strategiespiel um die Weltherrschaft für 2 bis 6 Spieler, gespielt live am selben Tisch: Jede Person nutzt ihr eigenes Gerät
(gebaut und getestet für iPad mit Safari), alle sind über den Browser mit einem gemeinsamen Server verbunden. Die Oberfläche ist Deutsch.

- Räume mit Raumcode und QR-Code, Lobby, Host-Funktionen (Überspringen, Entfernen, zurück zur Lobby)
- Weltkarte mit 42 Gebieten in 8 Kontinenten, Zoom und Verschieben per Touch
- Angriff mit Würfeln (auch als Blitz-Angriff), Verschieben, Karten eintauschen, Missionen, neutrale Armeen
- Installierbar auf dem Home-Bildschirm (PWA, ohne Offline-Modus)

Der Server ist die einzige Wahrheit: Clients senden nur Absichten, der Server prüft sie über eine reine Spiel-Engine und schickt jedem Spieler
seine gefilterte Sicht auf den Spielstand. Gespeichert wird in einer einzigen SQLite-Datei.

## Mit dem fertigen Image starten

Images für `linux/arm64` (zum Beispiel Raspberry Pi 5) und `linux/amd64` liegen unter `ghcr.io/bocrafttv/wagnis`.

```sh
docker run -d --name wagnis -p 3000:3000 \
  -e WAGNIS_CREATE_CODE='<eigener Code, mindestens 8 Zeichen>' \
  -v wagnis-data:/data \
  --read-only --tmpfs /tmp \
  ghcr.io/bocrafttv/wagnis:main
```

Danach `http://<rechner>:3000` öffnen. Wer den Erstell-Code kennt, kann einen Raum anlegen; alle anderen treten mit dem Raumcode bei.

| Tag                          | Inhalt                                                                        |
| ---------------------------- | ----------------------------------------------------------------------------- |
| `sha-<7 Zeichen>`            | genau ein Stand von `main`; für ein Deployment empfohlen (oder per Digest)    |
| `main`                       | der neueste Stand von `main`                                                  |
| `1.2.3`, `1.2`, `latest`     | Versionen, sobald es welche gibt                                              |
| `<tag>-arm64`, `<tag>-amd64` | dasselbe als Image nur für eine Architektur; ohne Endung wählt Docker passend |

Das Image läuft als Benutzer `node` (UID 1000), braucht kein beschreibbares Dateisystem außer `/data` (Datenbank) und `/tmp`, und lauscht auf Port 3000.
Ein benanntes Volume übernimmt die Rechte aus dem Image. Bei einem Bind-Mount muss der Ordner UID 1000 gehören.

### Konfiguration

Nur über Umgebungsvariablen (siehe `.env.example`):

| Variable             | Pflicht | Bedeutung                                                                                                                       |
| -------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `WAGNIS_CREATE_CODE` | ja      | Code zum Anlegen von Räumen, mindestens 8 Zeichen. Geheim halten.                                                               |
| `PORT`               | nein    | Port des Servers, im Image `3000`.                                                                                              |
| `WAGNIS_DB_PATH`     | nein    | Pfad der SQLite-Datei, im Image `/data/wagnis.db`.                                                                              |
| `WAGNIS_PUBLIC_URL`  | nein    | Öffentliche Adresse (nur Ursprung, etwa `https://spiel.example.org`); der QR-Code in der Lobby zeigt darauf.                    |
| `TRUST_PROXY_HEADER` | nein    | Header mit der echten Client-IP hinter einem Proxy (etwa `cf-connecting-ip`). Nur hinter einem vertrauenswürdigen Proxy setzen. |

### Kubernetes

Wagnis ist ein einzelner Prozess mit SQLite: genau **eine** Replik, Strategie `Recreate`, ein `ReadWriteOnce`-Volume auf `/data`, `/tmp` als `emptyDir`.
`GET /healthz` eignet sich für Startup-, Readiness- und Liveness-Probe. `WAGNIS_CREATE_CODE` gehört in ein Secret. Der Container verträgt
`runAsUser: 1000`, `readOnlyRootFilesystem: true` und `capabilities: drop: [ALL]`. WebSocket-Verbindungen brauchen am Ingress oder Tunnel ein
ausreichendes Leerlauf-Timeout; der Server hält sie mit einem Heartbeat offen.

Sicherung im laufenden Container (WAL-sicher, über die Sicherungsfunktion von SQLite):

```sh
docker exec wagnis node -e "const D=require('better-sqlite3'); const d=new D('/data/wagnis.db'); d.backup('/tmp/backup.db').then(() => d.close())"
docker exec wagnis cat /tmp/backup.db > wagnis-backup.db && docker exec wagnis rm /tmp/backup.db
```

Die Sicherung enthält geheime Spielinhalte und Token-Hashes. Zum Wiederherstellen den Container stoppen, die Datei als `wagnis.db` ins Volume legen und
`wagnis.db-wal` sowie `wagnis.db-shm` vorher löschen. Räume ohne Aktivität seit 48 Stunden löscht der Server beim Start und danach stündlich.

## Entwickeln

Voraussetzung: Node.js in der Version aus `.node-version`.

```sh
npm ci
cp .env.example .env      # WAGNIS_CREATE_CODE eintragen
npm run build             # einmal nach dem Klonen; Client-Tests lösen Pakete über dist auf
npm run dev               # Server und Vite-Dev-Server (auch im LAN erreichbar)
npm test                  # alle Tests, ohne Watch
npm run typecheck
npm start                 # gebauter Server, liefert auch den Client aus
```

Aufbau: `packages/engine` (reine Spiellogik und Kartendaten), `packages/shared` (Schemas für HTTP und WebSocket), `apps/server` (Fastify, WebSocket,
SQLite), `apps/client` (Svelte 5 und Vite). Das Protokoll zwischen Client und Server steht in `docs/protocol.md`.

Image selbst bauen:

```sh
docker buildx build --platform linux/arm64 --build-arg NODE_VERSION=$(cat .node-version) -t wagnis:dev --load .
```

## Herkunft dieses Repos

Dieses Repo wird automatisch aus einem privaten Arbeits-Repo abgeglichen; jeder Abgleich ist ein Commit und ersetzt den gesamten Inhalt.
Issues sind willkommen. Pull Requests werden hier nicht gemergt, Änderungen fließen über das private Repo ein.

## Lizenz

MIT, siehe `LICENSE`. Die Küstenlinien der Weltkarte sind aus gemeinfreien Daten von [Natural Earth](https://www.naturalearthdata.com/) abgeleitet.
