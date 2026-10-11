// Einlesen von CSV, Excel (xlsx/xls/ods) und Apple Numbers – mit automatischer Erkennung
// von Kopfzeile, Spaltenbedeutung, Ausrichtung (Zeilen/Spalten vertauscht) und Zahlenformat.

import { parseNumber, norm, uid } from './util.js';
import { ISIN_RE, isValidIsin, looksLikeWkn, recognize } from './assets.js';

export const FIELD_LABELS = {
  isin: 'ISIN / Kennung',
  wkn: 'WKN',
  symbol: 'Ticker / Symbol',
  name: 'Name',
  value: 'Wert',
  weight: 'Gewichtung',
  quantity: 'Stückzahl',
  price: 'Kurs',
  currency: 'Währung',
  type: 'Typ'
};

// Muster für Spaltenüberschriften (auf normalisierten Text angewendet). Höherer Score gewinnt.
// Deutsche Bank-Exporte nutzen oft zusammengesetzte Wörter („Wertpapierbezeichnung“, „Kurswert in EUR“,
// „Stück/Nom.“) – deshalb werden Wortteile erkannt, nicht nur ganze Wörter.
const HEADER_PATTERNS = {
  isin: [[/^isin$/, 10], [/\bisin\b/, 9], [/\b(kennung|identifier|kennnummer|id)\b/, 4]],
  wkn: [[/^wkn$/, 10], [/\bwkn\b|wertpapierkenn|valor|valoren/, 9]],
  symbol: [[/\b(ticker|symbol|kuerzel|boersenkuerzel)\b/, 8]],
  name: [[/^(name|bezeichnung|titel|wertpapier|asset|instrument|gattung)$/, 10],
    [/(bezeichnung|wertpapiername|name des|^name\b|\bname$)/, 9],
    [/\b(name|titel|asset|instrument|security|holding|beschreibung|description|produkt|position|gattung)\b|^wertpapier/, 7]],
  value: [[/(marktwert|kurswert|depotwert|positionswert|bestandswert|gesamtwert|tageswert|aktueller wert|akt wert|market value|current value)/, 10],
    [/^wert\b|\bwert in\b|\bwert eur\b|\bwert €|\bwert$/, 9], [/\b(value|betrag|amount|volumen|eur|summe)\b/, 6]],
  weight: [[/(gewicht|weight|allocation|allokation|portfolioanteil|depotanteil|anteil am|anteil in|anteil %)/, 10],
    [/\b(anteil|quote|prozent|percent|share of)\b/, 7]],
  quantity: [[/(stueck|stuckzahl|anzahl|menge|quantity|\bqty\b|\bshares\b|\bunits\b|nominal|\bbestand\b|\banteile\b|\bstk\b)/, 9]],
  price: [[/(^kurs\b|\bkurs$|akt kurs|aktueller kurs|letzter kurs|schlusskurs|tageskurs|\bkurs in\b|\bkurs eur\b|\bpreis\b|\bprice\b|\blast\b)/, 7]],
  currency: [[/\b(waehrung|wahrung|currency|ccy|whg)\b/, 9]],
  type: [[/\b(typ|type|art|anlageklasse|asset class|assetklasse|kategorie|category|wertpapierart|gattungsart)\b/, 8]]
};
// Spalten mit diesen Begriffen sind keine Gewichtung (sondern z. B. Performance in %)
const NOT_WEIGHT = /\b(perf|performance|veraenderung|change|gewinn|verlust|g v|guv|rendite|entwicklung|diff|differenz|plus|minus|ytd|dividende|yield|ter|kosten)\b/;
const NOT_VALUE = /(einstand|kaufwert|cost|kaufkurs|buy|anschaffung|vortag)/;
const TOTAL_ROW = /^(summe|gesamt|gesamtsumme|total|sum|zwischensumme|depotsumme|grand total|gesamtwert)\b/;

function headerScore(cell) {
  const raw = String(cell ?? '');
  const n = norm(raw);
  if (!n) return null;
  let best = null;
  for (const [field, pats] of Object.entries(HEADER_PATTERNS)) {
    for (const [re, score] of pats) {
      if (!re.test(n)) continue;
      let s = score;
      if (field === 'weight' && NOT_WEIGHT.test(n)) s = 0;
      if (field === 'value' && (NOT_VALUE.test(n) || NOT_WEIGHT.test(n))) s = 0;
      if (field === 'price' && /(wert|einstand|kauf|vortag)/.test(n)) s = 0; // "Kurswert" ist ein Wert, kein Kurs
      if (field === 'name' && /\b(wkn|isin|kennnummer|kennung)\b/.test(n)) s = 0;
      if (s && (!best || s > best.score)) best = { field, score: s };
    }
  }
  if (best && raw.includes('%') && best.field !== 'weight' && !NOT_WEIGHT.test(n)) {
    // "Wert (in %)" o. ä. → Gewichtung
    if (best.field === 'value') best = { field: 'weight', score: best.score };
  }
  if (!best && raw.includes('%') && !NOT_WEIGHT.test(n)) best = { field: 'weight', score: 5 };
  return best;
}

/** Bewertet eine Zeile (Array) als mögliche Kopfzeile. */
function scoreHeaderLine(cells) {
  let score = 0;
  const fields = new Set();
  for (const c of cells) {
    if (typeof c === 'number') { score -= 1; continue; }
    const h = headerScore(c);
    if (h && !fields.has(h.field)) { score += h.score; fields.add(h.field); }
    if (typeof c === 'string' && ISIN_RE.test(c.toUpperCase()) && isValidIsin(c.trim())) score -= 5;
  }
  return { score, fieldCount: fields.size };
}

function transpose(rows) {
  const w = Math.max(0, ...rows.map(r => r.length));
  return Array.from({ length: w }, (_, c) => rows.map(r => r[c]));
}

function trimRows(rows) {
  return rows
    .map(r => (r || []).map(v => (typeof v === 'string' ? v.trim() : v)))
    .filter(r => r.some(v => v !== null && v !== undefined && v !== ''));
}

/** Findet die beste Kopfzeile in Zeilen- oder Spaltenausrichtung. */
function findHeader(rows, orientation = 'auto') {
  const scan = (rs) => {
    let best = { index: -1, score: 0, fieldCount: 0 };
    rs.slice(0, 30).forEach((r, i) => {
      const s = scoreHeaderLine(r);
      if (s.fieldCount >= 2 && s.score > best.score) best = { index: i, ...s };
    });
    return best;
  };
  if (orientation === 'rows') return { rows, header: scan(rows), transposed: false };
  const cols = transpose(rows);
  if (orientation === 'cols') return { rows: cols, header: scan(cols), transposed: true };
  const byRow = scan(rows);
  const byCol = scan(cols);
  if (byCol.score > byRow.score * 1.2 && byCol.fieldCount >= 2) {
    return { rows: cols, header: byCol, transposed: true };
  }
  return { rows, header: byRow, transposed: false };
}

// Echte Währungscodes – „SAP“ oder „BMW“ sind Namen, keine Währungen
const CURRENCIES = new Set(['EUR', 'USD', 'CHF', 'GBP', 'JPY', 'CAD', 'AUD', 'SEK', 'NOK', 'DKK', 'PLN', 'CZK', 'HUF', 'HKD', 'CNY', 'SGD', 'NZD', 'ZAR', 'TRY', 'INR', 'BRL', 'MXN', 'KRW', 'TWD', 'GBX']);

function columnStats(dataRows, width) {
  const stats = [];
  for (let c = 0; c < width; c++) {
    const vals = dataRows.map(r => r[c]).filter(v => v !== null && v !== undefined && v !== '');
    const strs = vals.map(v => String(v).trim());
    const nums = vals.map(v => parseNumber(v)).filter(v => v !== null);
    const n = vals.length || 1;
    stats.push({
      col: c,
      count: vals.length,
      isinShare: strs.filter(s => isValidIsin(s.toUpperCase())).length / n,
      wknShare: strs.filter(s => looksLikeWkn(s)).length / n,
      numShare: nums.length / n,
      textShare: strs.filter(s => /[a-zA-ZäöüÄÖÜ]{3,}/.test(s) && parseNumber(s) === null).length / n,
      pctShare: strs.filter(s => /%\s*$/.test(s)).length / n,
      currencyShare: strs.filter(s => CURRENCIES.has(s.toUpperCase())).length / n,
      // Kennungen wie „BTC_to_EUR“, „US0378331005“, „A0RPWH“ – keine Namen
      idLikeShare: strs.filter(s => /^[A-Za-z0-9_.\-]+$/.test(s) && /[_\d]/.test(s)).length / n,
      sum: nums.reduce((a, b) => a + b, 0),
      avgLen: strs.reduce((a, s) => a + s.length, 0) / (strs.length || 1)
    });
  }
  return stats;
}

/** Passt der Inhalt einer Spalte zur vermuteten Bedeutung? Verhindert Fehldeutungen von Spaltentiteln. */
function plausible(field, st) {
  if (!st || !st.count) return false;
  switch (field) {
    case 'name': return st.textShare >= 0.5 && st.isinShare < 0.5 && st.currencyShare < 0.5;
    case 'isin': return st.isinShare >= 0.3 || st.wknShare >= 0.3 || (st.textShare < 0.5 && st.numShare < 0.5);
    case 'wkn': return st.wknShare >= 0.3 || st.isinShare >= 0.3;
    case 'symbol': return st.numShare < 0.5;
    case 'value': case 'weight': case 'quantity': case 'price': return st.numShare >= 0.6;
    case 'currency': return st.currencyShare >= 0.5;
    case 'type': return st.textShare >= 0.5;
    default: return true;
  }
}

/**
 * Ordnet jeder Spalte ein Feld zu: erst über die Überschrift (nur wenn der Inhalt passt),
 * dann über den Inhalt. `forced` ({feld: spalte}) überschreibt die Automatik (manuelle Korrektur).
 */
function mapColumns(headerCells, dataRows, forced = null) {
  const width = Math.max(headerCells.length, ...dataRows.map(r => r.length));
  const stats = columnStats(dataRows, width);
  if (forced) {
    const mapping = {};
    for (const [f, c] of Object.entries(forced)) if (c !== null && c !== undefined && c >= 0 && c < width) mapping[f] = Number(c);
    return { mapping, stats, width };
  }
  const candidates = [];
  for (let c = 0; c < width; c++) {
    const h = headerScore(headerCells[c]);
    if (h && plausible(h.field, stats[c])) candidates.push({ col: c, ...h });
  }
  candidates.sort((a, b) => b.score - a.score);
  const mapping = {};
  const used = new Set();
  for (const cand of candidates) {
    if (mapping[cand.field] !== undefined || used.has(cand.col)) continue;
    mapping[cand.field] = cand.col;
    used.add(cand.col);
  }

  // Inhaltsanalyse für fehlende Felder oder Tabellen ohne Kopfzeile
  const free = s => !used.has(s.col) && s.count > 0;
  const take = (field, s) => { if (s && mapping[field] === undefined) { mapping[field] = s.col; used.add(s.col); } };

  if (mapping.isin === undefined) take('isin', stats.filter(free).filter(s => s.isinShare > 0.5).sort((a, b) => b.isinShare - a.isinShare)[0]);
  if (mapping.wkn === undefined) take('wkn', stats.filter(free).filter(s => s.wknShare > 0.6 && s.isinShare < 0.2).sort((a, b) => b.wknShare - a.wknShare)[0]);
  if (mapping.name === undefined) take('name', stats.filter(free).filter(s => s.textShare > 0.6 && s.currencyShare < 0.5)
    .sort((a, b) => a.idLikeShare - b.idLikeShare || b.avgLen - a.avgLen)[0]);
  if (mapping.weight === undefined) {
    take('weight', stats.filter(free).filter(s => s.numShare > 0.7 && (s.pctShare > 0.5 || Math.abs(s.sum - 1) < 0.02 || Math.abs(s.sum - 100) < 2)).sort((a, b) => b.pctShare - a.pctShare)[0]);
  }
  if (mapping.value === undefined && mapping.quantity === undefined) {
    take('value', stats.filter(free).filter(s => s.numShare > 0.7).sort((a, b) => b.sum - a.sum)[0]);
  }
  return { mapping, stats, width };
}

function isTotalRow(row, mapping) {
  const name = norm(row[mapping.name] ?? '');
  const id = norm(row[mapping.isin] ?? '');
  const first = norm(row.find(v => typeof v === 'string' && v.trim()) ?? '');
  return TOTAL_ROW.test(name) || TOTAL_ROW.test(id) || (!name && !id && TOTAL_ROW.test(first));
}

/** Mehr belegte Spalten als diese ergeben für eine Depot-Tabelle keinen Sinn → Hinweis im Import-Dialog. */
export const MAX_COLUMNS = 6;

function countUsedColumns(headerCells, dataRows) {
  const width = Math.max(headerCells.length, ...dataRows.map(r => r.length), 0);
  let n = 0;
  for (let c = 0; c < width; c++) {
    const filled = v => v !== null && v !== undefined && String(v).trim() !== '';
    if (filled(headerCells[c]) || dataRows.some(r => filled(r[c]))) n++;
  }
  return n;
}

/**
 * Wandelt eine Tabelle (Array von Zeilen) in Positionen um.
 * Gibt { positions, mapping, transposed, headerRow, warnings } zurück.
 */
export function rowsToPositions(rawRows, forcedMapping = null, orientation = 'auto') {
  const rows0 = trimRows(rawRows);
  if (!rows0.length) return { positions: [], mapping: {}, warnings: ['Die Tabelle ist leer.'], score: 0 };
  if (orientation !== 'auto' || forcedMapping) return parseOriented(rows0, forcedMapping, orientation === 'auto' ? 'rows' : orientation);
  // Plausibilitätsprüfung: Tabelle in beiden Richtungen lesen und das glaubwürdigere Ergebnis nehmen
  const asRows = parseOriented(rows0, null, 'rows');
  const asCols = parseOriented(rows0, null, 'cols');
  const pr = plausibility(asRows), pc = plausibility(asCols);
  const pick = pc > pr * 1.15 ? asCols : asRows;
  const other = pick === asCols ? asRows : asCols;
  pick.plausibility = { rows: Math.round(pr * 10) / 10, cols: Math.round(pc * 10) / 10 };
  if (pick === asCols) pick.autoTransposed = true;
  // Reine Kopfzeilen-Heuristik hätte anders entschieden → Korrektur vermerken
  const heuristic = findHeader(rows0).transposed;
  if (heuristic !== pick.transposed) pick.orientationCorrected = true;
  pick.alternative = other.positions.length ? { transposed: other.transposed, count: other.positions.length } : null;
  return pick;
}

// Begriffe, die als „Name“ einer Position verdächtig sind (eigentlich Spaltentitel)
const HEADER_WORDS = /^(isin|wkn|name|bezeichnung|wert|gewicht|anteil|stueck|stuck|anzahl|kurs|preis|waehrung|typ|summe|gesamt|total|value|weight|price|symbol|ticker)\b/;

/**
 * Wie glaubwürdig ist ein Einlese-Ergebnis? Gültige ISIN/WKN, echte Namen (keine Spaltentitel/Zahlen),
 * Zahlen bei Wert/Gewicht und eine stimmige Gewichtssumme zählen positiv.
 */
export function plausibility(res) {
  const ps = res.positions || [];
  if (!ps.length) return 0;
  const share = f => ps.filter(f).length / ps.length;
  const idOk = share(p => isValidIsin(p.isin) || looksLikeWkn(p.wkn) || (p.symbol && /_|^[A-Z0-9.]{2,8}$/.test(p.symbol)));
  const nameOk = share(p => p.name && parseNumber(p.name) === null && !HEADER_WORDS.test(norm(p.name)) && !isValidIsin(p.name));
  const numOk = share(p => (Number.isFinite(p.value) && p.value > 0) || (Number.isFinite(p.weightFromFile) && p.weightFromFile > 0));
  const fields = Object.keys(res.mapping || {}).length;
  // Viele „Positionen“, deren Namen Spaltentitel sind, deuten auf eine falsch gedrehte Tabelle
  return ps.length * (2 * idOk + 2 * nameOk + 1.5 * numOk) + fields;
}

function parseOriented(rows0, forcedMapping, orientation) {
  const { rows, header, transposed } = findHeader(rows0, orientation);
  // Manuelle Zuordnung ohne erkannte Kopfzeile: erste Zeile ist Kopfzeile, wenn dort in Zahlenspalten keine Zahl steht
  if (header.index < 0 && forcedMapping) {
    const numCols = ['value', 'weight', 'quantity', 'price'].map(f => forcedMapping[f]).filter(c => c !== undefined && c !== null);
    if (numCols.length && numCols.every(c => parseNumber(rows[0]?.[c]) === null)) header.index = 0;
  }
  const hasHeader = header.index >= 0;
  const headerCells = hasHeader ? rows[header.index] : [];
  const dataRows = hasHeader ? rows.slice(header.index + 1) : rows;
  // Mehr als MAX_COLUMNS Spalten bringen keinen Nutzen – nur ein Hinweis, eingelesen wird trotzdem
  const usedColumns = countUsedColumns(headerCells, dataRows);
  const { mapping, width } = mapColumns(headerCells, dataRows, forcedMapping);
  const warnings = [];
  if (usedColumns > MAX_COLUMNS) {
    warnings.push(`Hinweis: Die Tabelle hat ${usedColumns} Spalten. Gebraucht werden höchstens ${MAX_COLUMNS} (z. B. ISIN, WKN, Name, Typ, Wert, Gewicht) – Spalten ohne erkennbare Bedeutung werden ignoriert.`);
  }
  // Spaltenübersicht für die manuelle Korrektur im Import-Dialog
  const fieldOf = Object.fromEntries(Object.entries(mapping).map(([f, c]) => [c, f]));
  const columns = Array.from({ length: width }, (_, c) => ({
    index: c,
    header: hasHeader ? String(headerCells[c] ?? '').trim() : '',
    samples: dataRows.map(r => r[c]).filter(v => v !== null && v !== undefined && String(v).trim() !== '').slice(0, 3).map(v => String(v).slice(0, 40)),
    field: fieldOf[c] || ''
  })).filter(col => col.header || col.samples.length);

  if (mapping.name === undefined && mapping.isin === undefined && mapping.wkn === undefined && mapping.symbol === undefined) {
    return { positions: [], mapping, transposed, columns, warnings: ['Keine Spalte mit Namen, ISIN oder WKN gefunden – bitte unten die Spalten zuordnen.'], score: 0 };
  }

  // Spaltenweise erkennen, ob deutsches Zahlenformat genutzt wird ("1.234,56")
  const decimalComma = {};
  for (const f of ['value', 'weight', 'quantity', 'price']) {
    const c = mapping[f];
    if (c === undefined) continue;
    const strs = dataRows.map(r => r[c]).filter(v => typeof v === 'string');
    decimalComma[f] = strs.some(s => /\d,\d{1,2}\s*(%|€|eur)?$/i.test(s.trim()) || /\d\.\d{3},/.test(s));
  }
  const num = (row, f) => (mapping[f] === undefined ? null : parseNumber(row[mapping[f]], decimalComma[f]));
  const str = (row, f) => (mapping[f] === undefined ? '' : String(row[mapping[f]] ?? '').trim());

  const positions = [];
  let weightIsPercentText = false;
  for (const row of dataRows) {
    if (isTotalRow(row, mapping)) continue;
    const name = str(row, 'name');
    let idRaw = str(row, 'isin');
    let wkn = str(row, 'wkn');
    let symbol = str(row, 'symbol');
    if (!name && !idRaw && !wkn && !symbol) continue;
    let isin = '';
    if (wkn && !looksLikeWkn(wkn) && !symbol) { symbol = wkn; wkn = ''; }
    if (idRaw) {
      const up = idRaw.toUpperCase().replace(/\s/g, '');
      if (ISIN_RE.test(up) && up.length === 12) isin = up;
      else if (!wkn && looksLikeWkn(up)) wkn = up;
      else if (!symbol) symbol = idRaw;
    }
    if (mapping.weight !== undefined && /%/.test(String(row[mapping.weight] ?? ''))) weightIsPercentText = true;
    const p = {
      id: uid(),
      name: name || symbol || isin || wkn,
      isin, wkn, symbol,
      value: num(row, 'value'),
      weightRaw: num(row, 'weight'),
      quantity: num(row, 'quantity'),
      price: num(row, 'price'),
      currency: str(row, 'currency').toUpperCase().slice(0, 3) || '',
      type: normalizeType(str(row, 'type'))
    };
    if (p.value === null && p.quantity !== null && p.price !== null) p.value = p.quantity * p.price;
    if (p.value === null && p.weightRaw === null && p.quantity === null && !p.name) continue;
    positions.push(p);
  }

  // Gewichtung: Brüche (Summe ≈ 1) in Prozent umrechnen
  const wSum = positions.reduce((a, p) => a + (p.weightRaw ?? 0), 0);
  const fractional = !weightIsPercentText && wSum > 0 && wSum <= 1.05 && positions.every(p => (p.weightRaw ?? 0) <= 1);
  for (const p of positions) {
    p.weight = p.weightRaw === null ? null : (fractional ? p.weightRaw * 100 : p.weightRaw);
    if (p.weight !== null) p.weightFromFile = p.weight; // für die Plausibilitätsprüfung
    delete p.weightRaw;
  }

  const recognized = positions.map(p => ({ ...recognize(p), id: p.id }));
  recomputeWeights(recognized);

  if (mapping.value === undefined && mapping.weight === undefined && mapping.quantity === undefined) {
    warnings.push('Weder Wert noch Gewichtung gefunden – alle Positionen werden gleich gewichtet.');
  }
  const score = recognized.length * 2 + Object.keys(mapping).length * 3 + (header.score || 0);
  return { positions: recognized, mapping, transposed, headerRow: hasHeader ? header.index : null, headerCells, columns, warnings, score, usedColumns };
}

function normalizeType(t) {
  const n = norm(t);
  if (!n) return '';
  if (/aktie|stock|equity|share/.test(n)) return 'Aktie';
  if (/etf/.test(n)) return 'ETF';
  if (/etc|etn/.test(n)) return 'ETC';
  if (/fonds|fund/.test(n)) return 'Fonds';
  if (/anleihe|bond|rente/.test(n)) return 'Anleihe';
  if (/krypto|crypto/.test(n)) return 'Krypto';
  if (/rohstoff|commodit|edelmetall/.test(n)) return 'Rohstoff';
  if (/cash|konto|liquid/.test(n)) return 'Cash';
  return '';
}

/**
 * Berechnet Gewichtungen neu: Wenn für alle Positionen ein Wert vorliegt, ergibt sich die Gewichtung
 * aus Wert / Summe. Sonst bleiben vorhandene Gewichtungen; fehlt alles, wird gleich gewichtet.
 */
export function recomputeWeights(positions) {
  const withValue = positions.filter(p => Number.isFinite(p.value));
  const total = withValue.reduce((a, p) => a + p.value, 0);
  if (withValue.length === positions.length && total > 0) {
    for (const p of positions) p.weight = (p.value / total) * 100;
    return { total, source: 'value' };
  }
  const withWeight = positions.filter(p => Number.isFinite(p.weight));
  if (withWeight.length) {
    // Werte aus Gewichtung hochrechnen, wenn ein Gesamtwert bekannt ist
    if (withValue.length) {
      const known = withValue.filter(p => Number.isFinite(p.weight) && p.weight > 0);
      if (known.length) {
        const estTotal = known.reduce((a, p) => a + p.value, 0) / (known.reduce((a, p) => a + p.weight, 0) / 100);
        for (const p of positions) if (!Number.isFinite(p.value) && Number.isFinite(p.weight)) p.value = estTotal * p.weight / 100;
      }
    }
    return { total: positions.reduce((a, p) => a + (Number.isFinite(p.value) ? p.value : 0), 0) || null, source: 'weight' };
  }
  const eq = positions.length ? 100 / positions.length : 0;
  for (const p of positions) p.weight = eq;
  return { total: null, source: 'equal' };
}

// ---------- Datei lesen ----------

/**
 * Erkennt die Textkodierung: UTF-8 (mit/ohne BOM), UTF-16 LE/BE (Excel „Unicode-Text“, Numbers-Export
 * mit UTF-16) und als Rückfall Windows-1252.
 */
export function decodeText(buf) {
  const b = new Uint8Array(buf);
  if (b[0] === 0xFF && b[1] === 0xFE) return new TextDecoder('utf-16le').decode(b.subarray(2));
  if (b[0] === 0xFE && b[1] === 0xFF) return new TextDecoder('utf-16be').decode(b.subarray(2));
  // UTF-16 ohne BOM: bei ASCII-Text ist jedes zweite Byte 0
  const sample = b.subarray(0, Math.min(b.length, 2000));
  let zeroEven = 0, zeroOdd = 0;
  for (let i = 0; i < sample.length; i++) if (sample[i] === 0) (i % 2 ? zeroOdd++ : zeroEven++);
  if (zeroOdd > sample.length / 4) return new TextDecoder('utf-16le').decode(b);
  if (zeroEven > sample.length / 4) return new TextDecoder('utf-16be').decode(b);
  const utf8 = new TextDecoder('utf-8').decode(b);
  if (!utf8.includes('�')) return utf8.replace(/^﻿/, '');
  return new TextDecoder('windows-1252').decode(b);
}

export function parseCsv(text) {
  const firstLines = text.split(/\r?\n/).slice(0, 10).join('\n');
  const delims = [';', ',', '\t', '|'];
  const counts = delims.map(d => firstLines.split(d).length);
  const delim = delims[counts.indexOf(Math.max(...counts))];
  const rows = [];
  let row = [];
  let cell = '';
  let q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else q = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') q = true;
    else if (ch === delim) { row.push(cell); cell = ''; }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(cell); rows.push(row); row = []; cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
  return rows;
}

/** Liest eine Datei (CSV/TXT/TSV, Excel, Numbers) und gibt Tabellenblätter als { name, rows }[] zurück. */
export async function readTableFile(file) {
  const name = file.name || 'datei';
  const ext = name.split('.').pop().toLowerCase();
  const buf = await file.arrayBuffer();
  if (['csv', 'txt', 'tsv'].includes(ext)) {
    return [{ name, rows: parseCsv(decodeText(buf)) }];
  }
  if (!window.XLSX) throw new Error('Excel-Bibliothek wurde nicht geladen.');
  let wb;
  try {
    wb = window.XLSX.read(buf, { type: 'array', cellDates: true, raw: false });
  } catch (e) {
    if (ext === 'numbers') {
      throw new Error('Diese Numbers-Datei konnte nicht gelesen werden. Bitte in Numbers über „Ablage → Exportieren → CSV“ (oder Excel) speichern und diese Datei wählen.');
    }
    throw e;
  }
  return wb.SheetNames.map(sn => ({
    name: sn,
    rows: window.XLSX.utils.sheet_to_json(wb.Sheets[sn], { header: 1, raw: true, defval: null, blankrows: false })
  }));
}

/**
 * Wertet bereits gelesene Tabellenblätter aus. Ohne Vorgaben wird das beste Blatt automatisch gewählt;
 * mit { sheet, mapping } wird genau dieses Blatt mit der manuell korrigierten Spaltenzuordnung gelesen.
 */
export function parseSheets(sheets, { sheet = null, mapping = null, orientation = 'auto' } = {}) {
  let best = null;
  for (const sh of sheets) {
    if (sheet !== null && sh.name !== sheet) continue;
    const res = rowsToPositions(sh.rows, mapping, orientation);
    if (!best || res.score > best.score) best = { ...res, sheet: sh.name };
  }
  return { ...best, sheetCount: sheets.length, sheetNames: sheets.map(s => s.name) };
}

/** Liest eine Datei und wählt automatisch das beste Tabellenblatt. */
export async function importFile(file) {
  const sheets = await readTableFile(file);
  const best = parseSheets(sheets);
  return { ...best, sheets, fileName: file.name, lastModified: file.lastModified || null };
}
