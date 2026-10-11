// Online-Suche für „+ Position“: ergänzt Name, ISIN, WKN, Ticker und Typ über Wikidata
// (query.wikidata.org – kostenlos, ohne Schlüssel, im Browser abrufbar).
// Gesendet wird nur der eingegebene Suchbegriff (Name, ISIN oder WKN), nie das Depot.
//
// WKN: Wikidata kennt keine WKN. Für deutsche Wertpapiere lässt sich die ISIN aber berechnen
// (DE000 + WKN + Prüfziffer) und dann nachschlagen. Ausländische WKNs (z. B. 865985 = Apple)
// sind so nicht auflösbar – dann bitte Name oder ISIN eingeben.

import { isValidIsin, looksLikeWkn, wknFromIsin, isinFromDeWkn, countryOf, suggestSearchTerm } from './assets.js';

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const TIMEOUT_MS = 15000;

async function fetchJson(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { ...opts, signal: ctrl.signal, credentials: 'omit', referrerPolicy: 'no-referrer' });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.json();
  } finally {
    clearTimeout(t);
  }
}

const sparqlString = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

function typeFromWikidata(types) {
  const t = types.join(' ').toLowerCase();
  if (/exchange-traded fund|börsengehandelter fonds|\betf\b/.test(t)) return 'ETF';
  if (/investment fund|investmentfonds|mutual fund|fonds/.test(t)) return 'Fonds';
  if (/cryptocurrency|kryptowährung/.test(t)) return 'Krypto';
  if (/bond|anleihe/.test(t)) return 'Anleihe';
  if (/precious metal|edelmetall|commodity|rohstoff/.test(t)) return 'Rohstoff';
  return 'Aktie';
}

/** Wikidata: Suche nach ISIN oder Name → Kandidaten mit ISIN/Ticker. */
async function searchWikidata(query) {
  const isin = query.toUpperCase().replace(/\s/g, '');
  const byIsin = isValidIsin(isin);
  const where = byIsin
    ? `?item wdt:P946 ${sparqlString(isin)} .`
    : `SERVICE wikibase:mwapi {
         bd:serviceParam wikibase:endpoint "www.wikidata.org"; wikibase:api "EntitySearch";
                         mwapi:search ${sparqlString(query)}; mwapi:language "de"; mwapi:limit "15" .
         ?item wikibase:apiOutputItem mwapi:item .
       }`;
  const q = `SELECT ?item ?itemLabel ?itemDescription ?isin ?ticker ?exchangeLabel ?typeLabel ?countryLabel WHERE {
      ${where}
      OPTIONAL { ?item wdt:P946 ?isin . }
      OPTIONAL { ?item p:P414 ?st . ?st ps:P414 ?exchange . OPTIONAL { ?st pq:P249 ?ticker . } }
      OPTIONAL { ?item wdt:P31 ?type . }
      OPTIONAL { ?item wdt:P17 ?country . }
      FILTER(BOUND(?isin) || BOUND(?exchange))
      SERVICE wikibase:label { bd:serviceParam wikibase:language "de,en". }
    } LIMIT 120`;
  const data = await fetchJson(`${WIKIDATA_SPARQL}?format=json&query=${encodeURIComponent(q)}`, {
    headers: { Accept: 'application/sparql-results+json' }
  });
  const byItem = new Map();
  for (const b of data.results?.bindings || []) {
    const id = b.item.value;
    const c = byItem.get(id) || {
      source: 'Wikidata', name: b.itemLabel?.value || '', description: b.itemDescription?.value || '',
      isins: new Set(), tickers: new Map(), types: new Set(), country: b.countryLabel?.value || ''
    };
    if (b.isin?.value) c.isins.add(b.isin.value.toUpperCase());
    if (b.ticker?.value) c.tickers.set(b.ticker.value, b.exchangeLabel?.value || '');
    if (b.typeLabel?.value) c.types.add(b.typeLabel.value);
    byItem.set(id, c);
  }
  return [...byItem.values()].map(c => {
    const isins = [...c.isins];
    const isinPick = byIsin && isins.includes(isin) ? isin : isins[0] || '';
    const tickers = [...c.tickers.entries()];
    // Bevorzugt Xetra/Frankfurt, sonst die erste Börse
    const tick = tickers.find(([, ex]) => /xetra|frankfurt/i.test(ex)) || tickers.find(([, ex]) => /nasdaq|new york/i.test(ex)) || tickers[0];
    return {
      source: c.source,
      name: c.name,
      description: c.description,
      isin: isinPick,
      allIsins: isins,
      symbol: tick?.[0] || '',
      exchange: tick?.[1] || '',
      type: typeFromWikidata([...c.types]),
      country: c.country
    };
  }).filter(c => c.name && !/^Q\d+$/.test(c.name));
}

/**
 * Sucht online nach einem Wertpapier. Gibt { candidates, errors, hint } zurück.
 * Kandidaten: { source, name, description, isin, wkn, symbol, exchange, type, country, searchTerm }
 */
export async function lookupSecurity(query) {
  query = String(query || '').trim();
  if (query.length < 2) return { candidates: [], errors: ['Bitte mindestens 2 Zeichen eingeben.'] };
  const errors = [];
  let hint = '';
  const id = query.toUpperCase().replace(/\s/g, '');
  let q = query;
  const isWkn = !isValidIsin(id) && looksLikeWkn(id);
  if (isWkn) q = isinFromDeWkn(id);

  let candidates = [];
  try {
    candidates = await searchWikidata(q);
  } catch (e) {
    errors.push(`Wikidata: ${e.name === 'AbortError' ? 'keine Antwort' : e.message}`);
  }
  if (isWkn && !candidates.length && !errors.length) {
    hint = 'Zu dieser WKN wurde nichts gefunden (nur deutsche WKNs lassen sich auflösen) – bitte Name oder ISIN eingeben.';
  }
  for (const c of candidates) {
    c.wkn = wknFromIsin(c.isin) || (isWkn ? id : '');
    c.country ||= countryOf(c.isin);
    c.searchTerm = suggestSearchTerm({ name: c.name, isin: c.isin, type: c.type });
  }
  candidates.sort((a, b) => (b.isin ? 1 : 0) - (a.isin ? 1 : 0));
  return { candidates: candidates.slice(0, 8), errors, hint };
}
