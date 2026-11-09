# Karten-Daten

Umrisse und Zierdaten der Weltkarte. Plan: `docs/plans/006-kartenoptik.md`. `welt.shapes.ts` ist **erzeugt** (nicht von Hand
ändern) aus den Geodaten unten; das Aussehen (Atlas-Look: Papier, Meer, Halo, Muster, Münzen) steckt in `decor.ts`, den
Komponenten `MapBackdrop`/`MapDefs`/`MapCanvas` und den Variablen in `styles/colors.css`.

## Geodaten

- **Quelle:** Natural Earth, „Admin 0 – Countries“, Maßstab 1:110 Mio., Datei `ne_110m_admin_0_countries.geojson`.
- **Lizenz:** Public Domain (gemeinfrei), keine Namensnennung nötig. Natural Earth: https://www.naturalearthdata.com
- **Spiegel und Version:** GitHub `nvkelso/natural-earth-vector`, Tag `v5.1.2`
- **URL:** https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/ne_110m_admin_0_countries.geojson
- **SHA-256:** `6866c877d39cba9c357620878839b336d569f8c662d3cfab4cb1dbe2d39c977f` (838 726 Bytes, 177 Objekte).
  Der Git-Blob-Hash `1e6ab74c7042f97013be69ceec798be8e1aff27d` stimmt mit dem der GitHub-API für den Tag überein.
- **Rohdaten nicht im Repo:** `node scripts/fetch-natural-earth.mjs` lädt die Datei in `.geo-tmp/` (ignoriert), prüft
  die Summe und bricht bei Abweichung ab. Die Datei wird nur mit `JSON.parse` gelesen.
- Im Repo liegt nur ein eigener Auszug (vereinfachte Umrisse), keine Attribute der Quelle. Die Linien der Quelle sind
  de-facto-Linien (z. B. Kaschmir, Krim, Westsahara) und keine politische Aussage von Wagnis. Die Grenze zwischen
  Subkontinent und Hochasien in Kaschmir ist die der Quelle; viele Gebiete fassen betroffene Länder ohnehin zusammen
  (Krim und Westsahara sind innerhalb eines Gebiets nicht sichtbar).
- Die geraden Schnittlinien durch Russland, Kanada, die USA, China, Brasilien und Angola sind eigene Wahl nach Landschaft
  und Nachbarschaft des Entwurfs (`../geo/welt.regions.ts`), keine Verwaltungsgrenzen.

## Ablauf (Pipeline)

1. `node scripts/fetch-natural-earth.mjs`: Rohdaten nach `.geo-tmp/` (SHA-256 geprüft).
2. `node scripts/build-world-shapes.mjs`: baut die Umrisse und druckt den Bericht (Eckpunkte je Gebiet, Inselringe, Kerben,
   Berührungen über `KERBE_MAX`, Abstände, Ankervorschläge). Mit `--write` wird `welt.shapes.ts` geschrieben, `--eps` setzt die
   Vereinfachungstoleranz (Standard 0,8 Einheiten). `--check` prüft die eingecheckten Umrisse ohne Rohdaten (einfache Ringe, keine Kreuzung,
   Landgrenzen der Engine gemeinsam, andere Paare getrennt, Budget).
3. Die Zuordnung Land → Gebiet, die Schnittgeraden, Inselregeln, das Inselband der Kleinen Antillen und die Linsen stehen in
   `../geo/welt.regions.ts`; Änderungen dort und neu erzeugen, `welt.shapes.ts` nie von Hand ändern.

Verarbeitung (Funktionen in `../geo/`, mit Tests): Länder über das Datumsfenster schieben und auf das Kartenfenster
beschneiden (`assign.ts`), an Schnittgeraden zerlegen (`cut.ts`), auf das 0,01°-Raster runden, T-Knoten einfügen und
Nullbreiten-Spitzen entfernen (`arcs.ts`), Bögen bilden, Linsen anwenden, glätten und mit Douglas-Peucker vereinfachen
(Bögen werden von beiden Nachbarn gemeinsam benutzt), kleine Inseln streichen, Kerben schneiden und Mindestabstände
erzwingen (`notch.ts`), auf eine Nachkommastelle runden, prüfen (`check.ts`).

Eigene Entscheidungen der Umsetzung (Schritt 1, im PR-Text benannt):

- Löcher der Quelle werden übersprungen (nur Lesotho in Südafrika; Lesotho gehört zum selben Gebiet und ist ohne eigene Zeile).
- Natural Earth hat einen Nullbreiten-Keil (Kafia Kingi, Sudan): Knoten eines Landes liegen auf der Kante eines anderen.
  `removeSpikes` entfernt die Spitze, sonst bricht der Ring.
- „Teilpolygone gesamt höchstens 70“ gilt für **Inselringe neben dem Hauptteil** (der Zielwert 40–55 des Plans passt nur dazu);
  Mindestflächen je Gebiet stehen in `ISLAND_MIN_AREA`.
- Kerbe an Berührungspunkten: Jede Seite bekommt eine Kopie des gemeinsamen Linienzugs, um `GAP_MIN` + 0,2 (Rundungsreserve)
  halb in das eigene Gebiet verschoben. Ein drittes Gebiet am Ende der Berührung bekommt beide Kopien in seinen Umriss.

## Dateien

- `decor.ts`: Zier-Geometrie (Gradnetz, Wellenkachel, Kompassrose, Rahmen, Musterkacheln) als reine Daten, von der App und
  von `scripts/render-map.mjs` benutzt.
- `../geo/`: Pipeline-Funktionen und `welt.regions.ts`; die App importiert daraus nur `project.ts` (für das Gradnetz).
- `../../../../scripts/build-world-shapes.mjs`: Pipeline-Kommandozeile. `render-map.mjs`: statische SVG-Ansicht der Karte
  (`--labels`, `--rings`, `--hits`, `--crop`, `--scale`) zur Sichtprüfung.
