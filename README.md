# Depot-News 📰

Private, nicht-kommerzielle Web-App (PWA) fürs iPhone und jeden anderen Browser:
Depot-Tabelle **lokal** einlesen → Wertpapiere automatisch erkennen → **aktuelle News aus anerkannten Quellen**
anzeigen, sortiert nach **1. Aktualität** und **2. Gewichtung** der Position.

> Keine Anlageberatung. Kein Server, kein Tracking, keine Cookies – deine Depotdaten bleiben auf deinem Gerät.
> Siehe [Datenschutz](datenschutz.html).

## Funktionen

| Bereich | Was die App kann |
|---|---|
| **Einrichtung** | Beim ersten Start: lokales Verzeichnis wählen *oder* Tabelle hochladen *oder* überspringen → Musterdepot |
| **Import** | Tabelle (Excel `.xlsx/.xls/.ods`, Apple Numbers `.numbers`) oder CSV (`;` `,` Tab; UTF-8, UTF-16, Windows-1252). Sinnvoll sind bis zu 6 Spalten (z. B. ISIN, WKN, Name, Typ, Wert, Gewicht) – bei mehr Spalten erscheint ein Hinweis, eingelesen wird trotzdem |
| **Höchstzahl** | Eingelesen werden höchstens die ersten 2000 Positionen der Tabelle (unter „Mehr → Einlesen“ einstellbar); der Import-Dialog nennt, wie viele übergangen werden |
| **News nach Typ** | Im Depot gibt es je Typ (z. B. ETF, Aktie, Anleihe) einen Schalter. Ausgeschaltete Typen werden gar nicht erst gesucht; bei Sortierung „Typ“ ist die Liste nach Typ gruppiert |
| **Beträge ausblenden** | Das Augen-Symbol oben rechts blendet alle Euro-Beträge aus (Gesamtwert und einzelne Positionen) – praktisch, wenn man die App jemandem zeigt. Prozent-Gewichtungen bleiben sichtbar; die Einstellung bleibt gespeichert |
| **Dividenden** | Eigener Bereich zwischen Depot und Quellen: Dividende je Anteil, Ex-Tag und Zahltag für ausschüttende Aktien, ETFs und Fonds ab 5.000 € Positionswert (einstellbar) plus eine Merkliste für Titel außerhalb des Depots. Titel ohne Ausschüttung werden ausgeblendet. Daten kommen direkt vom Gerät über einen eigenen kostenlosen API-Schlüssel (Financial Modeling Prep oder Alpha Vantage), der nur lokal gespeichert wird; abgerufene Daten gelten 7 Tage. Das Börsenkürzel wird über onvista ermittelt (kostet kein Kontingent) und ins Format des Dienstes übertragen (z. B. SAP.DEX); es lässt sich je Titel von Hand ändern. „Ausblenden“ entfernt einen Titel nur aus dieser Ansicht – das Depot bleibt unverändert. Für Titel, die der Dienst nicht abdeckt (v. a. deutsche Aktien und europäische ETFs): „Prompt für fehlende Dividenden“ erzeugt einen Prompt, mit dem Claude (mit Recherche) nur aus offiziellen Quellen eine CSV mit Ex-Tag, Zahltag, Betrag, Status und Quellen-Link erstellt; „Dividenden-CSV einlesen“ übernimmt sie. Werte lassen sich auch „Von Hand“ eintragen. Eigene Daten werden vom Dienst nie überschrieben |
| **Tabelle aus Screenshot (Claude)** | Für ein beliebiges Depot, von dem es nur Screenshots gibt (Bank-App, Broker-Website, Depotauszug): „Tabelle aus Depot-Screenshot erstellen“ (beim ersten Start und unter „Mehr → Einlesen“) erzeugt einen Prompt für Claude. Screenshots anhängen, Recherche einschalten – Claude löst Fonds und ETFs in Einzeltitel auf (bis zu 2000 Zeilen) und liefert eine CSV zum Einlesen. Die App selbst sendet dabei nichts |
| **Ausrichtung prüfen** | Plausibilitätsprüfung beim Einlesen: Die Tabelle wird in beiden Richtungen gelesen; stehen Positionen in Spalten und Felder in Zeilen, wird automatisch getauscht (Hinweis + Schalter „Zeilen und Spalten tauschen“ im Import-Dialog) |
| **Kurse** | Beim Einfügen einer Position (Einlesen oder „+ Position“) wird einmalig der aktuelle Kurs von onvista geholt – bevorzugt in Euro an Xetra/Tradegate/gettex; fehlt der Wert, wird er aus Stückzahl × Kurs berechnet |
| **Spalten korrigieren** | Im Import-Dialog jede Spalte mit Beispielwerten sehen und ihre Bedeutung per Auswahl ändern – die Positionen werden sofort neu eingelesen |
| **Automatische Erkennung** | Kopfzeile auch unter Vorspann-Zeilen, Spaltenbedeutung (ISIN, WKN, Name, Wert, Gewicht, Stück, Kurs, Währung, Typ), gedrehte Tabellen (Felder in Zeilen), deutsches/englisches Zahlenformat, Gewicht als Bruch oder %, Summenzeilen werden ignoriert, mehrere Tabellenblätter → das passendste wird gewählt |
| **Asset-Erkennung** | ISIN mit Prüfziffer, WKN (bei deutschen ISINs automatisch abgeleitet), Typ (Aktie, ETF, Fonds, ETC, Anleihe, Krypto, Rohstoff, Cash), Land; ISIN im Namen („Apple Inc. (US0378331005)“) |
| **News-Suchbegriffe** | Firmenname ohne Rechtsform-Zusätze; bei ETFs der Index (z. B. „MSCI World“), bei Rohstoffen „Goldpreis OR Gold price“; pro Position editierbar |
| **News** | News-Sammlung per GitHub Action (kein Proxy, kein Schlüssel) plus direkt vom Gerät abrufbare Feeds (tagesschau, CNBC, MarketWatch, WSJ, onvista); nur aktivierte Quellen, Position muss in Überschrift oder Anreißer vorkommen; doppelte Meldungen zusammengefasst; Gruppierung nach Zeitfenster (Stunde/6 h/Tag/exakt), innerhalb nach Gewichtung |
| **Nachschlagen** | Eingabefeld für WKN, ISIN oder Name → Höhe der Position, per Schieberegler in **%** oder **€** |
| **Positionen** | Bearbeiten, hinzufügen, löschen; Gewichtung wird aus Werten neu berechnet |
| **Online ergänzen** | Bei „+ Position“ genügt Name, ISIN *oder* WKN (auch ausländische, z. B. 865985 = Apple) – Name, ISIN, WKN, Ticker, Typ und Suchbegriff kommen von onvista (Rückfall: Wikidata); bei mehreren Treffern zur Auswahl |
| **Suchliste (lokal)** | Übersicht unter **„Mehr → Suchliste“**: alle Positionen mit ihren Suchbegriffen (antippen zum Ändern). News für Positionen ab 2 % Gewichtung (einstellbar, 0 = alle); Positionen und Suchbegriffe bleiben auf dem Gerät – mehrere Personen können die App unabhängig nutzen |
| **News pro Position abwählen** | Schiebeschalter je Position – schon im Import-Dialog und jederzeit in „Depot“ (inkl. „Alle an/aus“). Abgewählte Positionen werden nicht abgefragt, ihre News ausgeblendet, keine Benachrichtigungen; die Auswahl bleibt beim erneuten Einlesen erhalten |
| **Quellen** | 28 vorgeschlagene Qualitätsquellen (Agenturen, Wirtschafts- und Qualitätspresse), an-/abwählbar, eigene Quellen inkl. RSS ergänzbar |
| **Benachrichtigungen** | Bei neuen News (optional ab Mindestgewichtung) |
| **Datensicherung** | JSON-Sicherung speichern/laden (iPhone: Teilen → „In Dateien sichern“), automatische Sicherung ins verbundene Verzeichnis, Export als CSV (6 Spalten, wieder einlesbar) |
| **Offline** | App-Oberfläche & gespeicherte News funktionieren offline (Service Worker) |

## Auf dem iPhone nutzen

1. Seite in **Safari** öffnen: `https://t9c7nzmp9d-design.github.io/Claudia-Portfolio-News-Check/`
2. **Teilen → Zum Home-Bildschirm** – dann läuft sie wie eine App (Vollbild, Benachrichtigungen ab iOS 16.4).
3. Beim ersten Start „Tabelle hochladen“ → Datei aus *Dateien* / iCloud Drive wählen, oder überspringen.

> **Wichtig:** Safari und die Home-Bildschirm-App haben **getrennte Speicher**. Ein in Safari eingelesenes Depot ist in der
> Home-Bildschirm-App nicht vorhanden (und umgekehrt). Außerdem löscht Safari Webseiten-Daten nach 7 Tagen ohne Nutzung.
> Deshalb die App installieren und **nur über das Home-Symbol** öffnen. Unter „Mehr → Datensicherung“ zeigt die App, wo und
> wann das Depot zuletzt gespeichert wurde. Regelmäßig „Sicherung speichern“ – eine Sicherung lässt sich auch direkt bei der
> Einrichtung wieder laden.

**Hinweis zu „lokales Verzeichnis“:** Safari (iPhone/iPad/Mac) erlaubt Webseiten keinen dauerhaften Verzeichniszugriff.
Dort fragt die App beim Start nach einer neuen Version der Datei („Gibt es eine neue Version …?“) und du wählst sie mit einem Tipp.
In Chrome/Edge am Desktop kann ein Verzeichnis verbunden werden: Die App liest dann beim Start **selbstständig die neueste
Tabelle** darin ein und legt `depot-news-sicherung.json` als Sicherung ab.

## Musterdateien

- [`sample/Musterdepot.xlsx`](sample/Musterdepot.xlsx) – ISIN, Name, Wert (€), Gewicht (als Bruch), Summenzeile
- [`sample/Musterdepot.csv`](sample/Musterdepot.csv) – dasselbe als CSV
- [`sample/Musterdepot_Bank-Export.csv`](sample/Musterdepot_Bank-Export.csv) – typischer Bank-Export mit Vorspann, WKN, Stück, Kurs, deutschem Zahlenformat

Deine eigene Tabelle braucht mindestens **Name oder ISIN/WKN** und idealerweise **Wert** oder **Gewichtung**. Reihenfolge und
Spaltennamen sind egal.

## So kommen die News in die App

```
GitHub Action „News sammeln“ (alle 30 Min., läuft auf GitHub-Servern – dort gibt es keine CORS-Sperren)
  ├─ RSS-Feeds aus news/feeds.json (Handelsblatt, FAZ, tagesschau, WSJ, FT, CNBC, BBC, …)
  └─ Google News für Medien ohne Feed (Reuters, AP, Bloomberg, Börsen-Zeitung, …)
        ↓
  news.json im Branch „news-data“ (≈ 2.000 Artikel der letzten 7 Tage)
        ↓  eine einzige Anfrage an raw.githubusercontent.com (CORS erlaubt)
App auf dem iPhone: sucht lokal nach deinen Positionen → Depot verlässt das Gerät nie
```

**Einrichtung:** nichts zu tun – die Action startet nach dem Merge automatisch. Sofort testen:
*Actions → News sammeln → Run workflow*. Die App zeigt unter „Mehr“ den Stand der Sammlung.

**Quellen ändern:** `news/feeds.json` auf GitHub bearbeiten (RSS-Feed oder Domain ergänzen). In der App unter
„Quellen“ legst du fest, welche davon angezeigt werden.

**Alles Persönliche bleibt lokal:** Positionsliste und Suchbegriffe liegen nur auf dem Gerät. Die Sammlung ist für alle
Nutzer gleich (keine nutzerbezogenen Daten im Repository) – mehrere Personen können die App gleichzeitig nutzen.

**Treffergenauigkeit:** Suchbegriffe pro Position anpassen; mehrere Begriffe mit `OR`, Ausschlüsse mit ` -`, z. B.
`Nikkei OR Topix -Nikkei Asia`. Gleiche Meldungen mehrerer Medien werden zusammengefasst („Handelsblatt + FAZ“).

Hinweis: GitHub pausiert zeitgesteuerte Actions in öffentlichen Repositories nach 60 Tagen ohne Aktivität – dann unter
*Actions* einmal „Enable workflow“ klicken.

### Welche Quellen sind direkt vom iPhone erreichbar?

Browser dürfen fremde Seiten nur abrufen, wenn diese es per CORS-Header erlauben. Geprüft (Oktober 2026, `scripts/check-cors.mjs`):

| Direkt erreichbar ✓ | Nur über die News-Sammlung |
|---|---|
| tagesschau.de, CNBC, MarketWatch, WSJ Markets, onvista | Handelsblatt, FAZ, WiWo, manager magazin, SZ, Spiegel, Zeit, n-tv, Standard, NZZ, FT, BBC, Economist, Nikkei Asia, CoinDesk, Reuters/AP/Bloomberg (über Google News) |
| – | GDELT (HTTP 429, kein CORS), Google News, Bing News, finanzen.net |

Die direkt erreichbaren Quellen liest die App bei jeder Aktualisierung zusätzlich selbst – so gibt es auch dann aktuelle Schlagzeilen, wenn die News-Sammlung veraltet oder nicht erreichbar ist.

## Veröffentlichen auf GitHub Pages

1. Repository auf **Public** stellen (Settings → General → Danger Zone).
2. **Settings → Pages → Build and deployment → Source: „Deploy from a branch“**, Branch **`main`**, Ordner **`/ (root)`** → *Save*.
3. Nach ein bis zwei Minuten ist die App erreichbar unter `https://<benutzer>.github.io/<repo>/`.
4. In `datenschutz.html` Name/Kontakt eintragen.

Der Workflow `.github/workflows/tests.yml` führt bei jedem Push und Pull Request die Tests aus.

## Entwicklung

Reines HTML/CSS/JavaScript (ES-Module), kein Build-Schritt.

```bash
npm start      # lokaler Server auf http://localhost:8080
npm test       # Tests für Import, Erkennung und News-Zuordnung (Node ≥ 20)
node scripts/collect-news.mjs /tmp/news.json   # News-Sammlung lokal ausführen
```

```
index.html, datenschutz.html, manifest.webmanifest, sw.js
css/app.css
js/app.js      Oberfläche, Onboarding, Import-Ablauf, Sicherung, Benachrichtigungen
js/parser.js   Datei lesen, Kopfzeile/Spalten/Ausrichtung/Zahlenformat erkennen
js/assets.js   ISIN/WKN-Prüfung, Typ- & Suchbegriff-Erkennung
js/news.js     News-Sammlung und direkte Feeds laden, Zuordnung, Zusammenfassen, Sortierung
js/lookup.js   Online-Suche für „+ Position“ (onvista, Rückfall Wikidata)
scripts/collect-news.mjs  Sammelskript der GitHub Action
news/          feeds.json (Quellen der Sammlung)
js/sources.js  vorgeschlagene Quellen
js/store.js    lokale Speicherung, Sicherung
vendor/        SheetJS CE 0.18.5 (Apache-2.0), lokal ausgeliefert
scripts/check-cors.mjs  prüft, welche Feeds direkt aus dem Browser abrufbar sind
```

Nach Änderungen an App-Dateien die Cache-Version in `sw.js` erhöhen, damit installierte Apps aktualisieren.

## Ideen für Erweiterungen

- **Echte Push-Nachrichten bei geschlossener App:** GitHub Action (stündlich) + [ntfy.sh](https://ntfy.sh) oder Web Push.
  Erfordert, dass die *Suchbegriffe* (nicht die Werte) im Repo/Secret liegen – bewusste Datenschutz-Abwägung.
- **Kurse & Tagesperformance** (z. B. über einen Proxy zu einer Kurs-API) und Sortierung nach „Einfluss“ = Gewicht × Kursbewegung.
- **Ad-hoc-/Unternehmensmeldungen** (EQS, DGAP) und Termine (Quartalszahlen, Dividenden) als eigene Kategorie.
- **Stimmungs-/Relevanz-Einstufung** der Schlagzeilen, Duplikat-Bündelung über Quellen hinweg.
- **ETF-Durchschau:** News zu den größten Einzeltiteln in ETFs, gewichtet nach Durchschau-Anteil.
- **Mehrere Depots** und Verlauf der Gewichtung.
- **Verschlüsselte Sicherung** (Passwort) für die JSON-Datei.

## Lizenz

MIT – siehe [LICENSE](LICENSE). SheetJS Community Edition: Apache-2.0.
