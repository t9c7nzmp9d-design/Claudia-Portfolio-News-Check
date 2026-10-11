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
| **Import** | CSV (`;` `,` Tab), Excel (`.xlsx/.xls/.ods`), Apple Numbers (`.numbers`) |
| **Automatische Erkennung** | Kopfzeile auch unter Vorspann-Zeilen, Spaltenbedeutung (ISIN, WKN, Name, Wert, Gewicht, Stück, Kurs, Währung, Typ), gedrehte Tabellen (Felder in Zeilen), deutsches/englisches Zahlenformat, Gewicht als Bruch oder %, Summenzeilen werden ignoriert, mehrere Tabellenblätter → das passendste wird gewählt |
| **Asset-Erkennung** | ISIN mit Prüfziffer, WKN (bei deutschen ISINs automatisch abgeleitet), Typ (Aktie, ETF, Fonds, ETC, Anleihe, Krypto, Rohstoff, Cash), Land; ISIN im Namen („Apple Inc. (US0378331005)“) |
| **News-Suchbegriffe** | Firmenname ohne Rechtsform-Zusätze; bei ETFs der Index (z. B. „MSCI World“), bei Rohstoffen „Goldpreis OR Gold price“; pro Position editierbar |
| **News** | Nur Artikel aus aktivierten Quellen, deren Überschrift die Position nennt; Gruppierung nach Zeitfenster (Stunde/6 h/Tag/exakt), innerhalb nach Gewichtung |
| **Nachschlagen** | Eingabefeld für WKN, ISIN oder Name → Höhe der Position, per Schieberegler in **%** oder **€** |
| **Positionen** | Bearbeiten, hinzufügen, löschen; Gewichtung wird aus Werten neu berechnet |
| **Quellen** | 28 vorgeschlagene Qualitätsquellen (Agenturen, Wirtschafts- und Qualitätspresse), an-/abwählbar, eigene Quellen inkl. RSS ergänzbar |
| **Benachrichtigungen** | Bei neuen News (optional ab Mindestgewichtung) |
| **Datensicherung** | JSON-Sicherung speichern/laden (iPhone: Teilen → „In Dateien sichern“), automatische Sicherung ins verbundene Verzeichnis, Export als Excel/CSV |
| **Offline** | App-Oberfläche & gespeicherte News funktionieren offline (Service Worker) |

## Auf dem iPhone nutzen

1. Seite in **Safari** öffnen: `https://t9c7nzmp9d-design.github.io/Claudia-Portfolio-News-Check/`
2. **Teilen → Zum Home-Bildschirm** – dann läuft sie wie eine App (Vollbild, Benachrichtigungen ab iOS 16.4).
3. Beim ersten Start „Tabelle hochladen“ → Datei aus *Dateien* / iCloud Drive wählen, oder überspringen.

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

## Nachrichtendienste

| Dienst | Einrichtung | Bemerkung |
|---|---|---|
| **GDELT** (Standard) | keine | Kostenlos, ohne Schlüssel, direkt aus dem Browser. Max. 1 Anfrage / 5 s → Positionen werden gebündelt (ca. 3 Anfragen für 20 Positionen). Paywall-Medien (FT, WSJ, Bloomberg) teils lückenhaft erfasst. |
| **Google News RSS** | CORS-Proxy nötig | Genauere Treffer und mehr Quellen. |
| **RSS-Feeds** je Quelle | meist CORS-Proxy nötig | z. B. tagesschau.de Wirtschaft |

### Optional: eigener CORS-Proxy (kostenlos, ~5 Min.)

1. Bei [Cloudflare](https://dash.cloudflare.com) anmelden → *Workers & Pages* → *Create Worker*.
2. Inhalt von [`proxy/cloudflare-worker.js`](proxy/cloudflare-worker.js) einfügen, ggf. `ALLOWED_ORIGIN` und `ALLOWED_HOSTS` anpassen, *Deploy*.
3. In der App unter **Mehr → CORS-Proxy**: `https://<name>.<konto>.workers.dev/?url={url}` eintragen und „Google News RSS“ wählen.

Der Proxy lässt nur deine App-Herkunft und freigegebene Hosts zu (kein offener Proxy).

## Veröffentlichen auf GitHub Pages

Das Repository enthält einen Workflow (`.github/workflows/pages.yml`), der Tests ausführt und die Seite veröffentlicht:

1. Repository auf **Public** stellen (Settings → General → Danger Zone).
2. **Settings → Pages → Source: „GitHub Actions“**.
3. Auf `main` pushen (oder Workflow manuell starten). URL: `https://<benutzer>.github.io/<repo>/`.
4. In `datenschutz.html` Name/Kontakt eintragen.

## Entwicklung

Reines HTML/CSS/JavaScript (ES-Module), kein Build-Schritt.

```bash
npm start      # lokaler Server auf http://localhost:8080
npm test       # Parser-/Erkennungs-Tests (Node ≥ 20)
```

```
index.html, datenschutz.html, manifest.webmanifest, sw.js
css/app.css
js/app.js      Oberfläche, Onboarding, Import-Ablauf, Sicherung, Benachrichtigungen
js/parser.js   Datei lesen, Kopfzeile/Spalten/Ausrichtung/Zahlenformat erkennen
js/assets.js   ISIN/WKN-Prüfung, Typ- & Suchbegriff-Erkennung
js/news.js     GDELT / Google News / RSS, Zuordnung, Sortierung
js/sources.js  vorgeschlagene Quellen
js/store.js    lokale Speicherung, Sicherung
vendor/        SheetJS CE 0.18.5 (Apache-2.0), lokal ausgeliefert
proxy/         optionaler Cloudflare-Worker
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
