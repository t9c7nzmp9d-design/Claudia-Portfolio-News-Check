// Prompt für Claude: Depot-Screenshot → CSV mit aufgelösten Fonds (Look-through).
// Die App sendet dabei nichts – der Text wird nur erzeugt und kopiert.

import { ASSET_TYPES } from './assets.js';

export const PROMPT_FILE = 'depot-aufgeloest.csv';
export const PROMPT_HEADER = 'ISIN;WKN;Name;Typ;Wert (in €);Gewicht (in %)';

/** @param {{maxRows?: number}} opts */
export function buildScreenshotPrompt({ maxRows = 2000 } = {}) {
  const n = Math.max(10, Math.round(Number(maxRows) || 2000));
  return `Im Anhang sind Screenshots eines Wertpapierdepots (z. B. aus der App oder Website einer Bank oder eines Brokers, eventuell mehrere Seiten oder mehrere Depots). Erstelle daraus eine CSV-Datei, in der alle Fonds und ETFs in ihre Einzeltitel aufgelöst sind (Look-through). Nutze dafür die Recherche bzw. Websuche gründlich (Deep Research), damit insgesamt bis zu ${n} Einzeltitel zusammenkommen.

Schritt 1 – Depot lesen
- Lies jede Position aus den Screenshots: Name, ISIN bzw. WKN und aktueller Wert in Euro (falls nur Stückzahl und Kurs zu sehen sind: Stückzahl × Kurs).
- Zeigen die Screenshots mehrere Depots oder überlappende Seiten, alle Positionen zusammen erfassen, doppelt sichtbare aber nur einmal.
- Übernimm nur, was wirklich zu sehen ist. Unleserliches nicht raten, sondern in der Zusammenfassung nennen.

Schritt 2 – Fonds und ETFs auflösen
- Suche für jeden Fonds und ETF die aktuelle, möglichst vollständige Bestandsliste (Holdings), bevorzugt direkt beim Anbieter (z. B. iShares, Xtrackers, Vanguard, Amundi, SPDR, Invesco, DWS, Union Investment, Deka), sonst Factsheet oder Jahres- bzw. Halbjahresbericht. Notiere Quelle und Stand.
- Wert je Einzeltitel = Wert des Fonds im Depot × Gewicht des Titels im Fonds.
- Gleiche Titel aus mehreren Fonds und direkt gehaltene Titel über die ISIN zu einer Zeile zusammenfassen.
- Anleihen im Fonds als Typ „Anleihe“; Kasse, Geldmarkt und Derivate je Fonds als eine Zeile „Kasse/Derivate <Fondsname>“ mit Typ „Cash“.
- Ist eine Bestandsliste nicht vollständig zu finden, nimm die veröffentlichten größten Positionen und fasse den Rest als eine Zeile „Rest <Fondsname>“ mit Typ „Fonds“ und der ISIN des Fonds zusammen, damit die Summe stimmt.
- Direkt gehaltene Aktien, Anleihen, ETCs, Kryptowerte usw. bleiben unverändert.

Schritt 3 – Begrenzen
- Höchstens ${n} Zeilen, nach Wert absteigend sortiert. Was darüber hinausgeht, je Fonds in die Zeile „Rest <Fondsname>“ aufnehmen.

Schritt 4 – CSV ausgeben
- Genau diese 6 Spalten mit Semikolon als Trennzeichen und dieser Kopfzeile:
${PROMPT_HEADER}
- Typ ist einer von: ${ASSET_TYPES.join(', ')}.
- Name kurz und gebräuchlich, so wie er in Nachrichten vorkommt (z. B. „Apple“ statt „APPLE INC. REGISTERED SHARES DL -,00001“).
- Zahlen mit Komma als Dezimalzeichen, ohne Tausenderpunkte und ohne Währungszeichen (z. B. 1234,56).
- Gewicht = Anteil am gesamten Depot in Prozent mit 4 Nachkommastellen; alle Zeilen ergeben zusammen 100.
- Der Gesamtwert der CSV entspricht dem Depotwert in den Screenshots (Abweichung höchstens durch Rundung).
- ISIN und WKN nur eintragen, wenn sie sicher bekannt sind – nichts erfinden, sonst leer lassen.
- Stelle die CSV als herunterladbare Datei „${PROMPT_FILE}“ (UTF-8) bereit.

Zum Schluss kurz zusammenfassen: welche Fonds aufgelöst wurden (mit Quelle und Stand), was zusammengefasst oder nicht gefunden wurde, und die Kontrollsumme.`;
}

// ---------------------------------------------------------------- Dividenden (nur Hauptquellen, keine Schätzungen)

export const DIV_PROMPT_FILE = 'dividenden.csv';
export const DIV_PROMPT_HEADER = 'ISIN;Name;Ex-Tag;Zahltag;Betrag;Währung;Status;Quelle';

/** @param {{name: string, isin?: string, wkn?: string, type?: string}[]} titles */
export function buildDividendPrompt(titles) {
  const list = titles.map(t => `- ${t.name}${t.isin ? ` – ISIN ${t.isin}` : ''}${t.wkn ? ` – WKN ${t.wkn}` : ''}${t.type ? ` (${t.type})` : ''}`).join('\n');
  return `Recherchiere für die folgenden Wertpapiere die Dividenden bzw. Ausschüttungen und gib sie als CSV-Datei aus. Nutze die Recherche bzw. Websuche gründlich. Ich brauche genaue, offiziell bestätigte Daten – keine Schätzungen, Prognosen oder Analystenerwartungen.

Wertpapiere:
${list}

Quellen (Pflicht):
- Aktien: Investor-Relations-Seite des Unternehmens, Einladung bzw. Beschlüsse der Hauptversammlung oder offizielle Pressemitteilung.
- ETFs und Fonds: Ausschüttungshistorie auf der Website des Fondsanbieters (z. B. Vanguard, iShares, Xtrackers, Amundi, DWS, Union Investment).
- Andere Seiten (Finanzportale, Nachrichten) nur zum Gegenprüfen, nie als alleinige Quelle.

Je Wertpapier gesucht:
- alle Ausschüttungen der letzten 12 Monate (Status „gezahlt“) und
- bereits beschlossene oder offiziell vorgeschlagene künftige Ausschüttungen (Status „beschlossen“ bzw. „vorgeschlagen“).

Regeln:
- Nichts schätzen oder aus früheren Mustern ableiten. Ist ein Wert nicht offiziell veröffentlicht, das Feld leer lassen.
- Betrag je Aktie bzw. Anteil in der Originalwährung der Ausschüttung (z. B. EUR, USD) – nicht umrechnen.
- Thesaurierende Fonds/ETFs und Titel ohne Ausschüttung: eine Zeile mit Status „keine“ und leerem Betrag.
- Wird ein Titel nicht eindeutig gefunden, eine Zeile mit Status „unklar“ und kurzer Erklärung in der Spalte Quelle.

CSV-Format (genau diese Kopfzeile, Semikolon als Trennzeichen, UTF-8):
${DIV_PROMPT_HEADER}
- Ex-Tag und Zahltag als JJJJ-MM-TT (z. B. 2026-05-08).
- Betrag mit Komma als Dezimalzeichen, ohne Währungszeichen (z. B. 17,10).
- Status: gezahlt, beschlossen, vorgeschlagen, keine oder unklar.
- Quelle: vollständige Adresse (URL) der Hauptquelle.
- Stelle die CSV als herunterladbare Datei „${DIV_PROMPT_FILE}“ bereit.

Zum Schluss kurz zusammenfassen, was nicht gefunden wurde oder unsicher ist.`;
}
