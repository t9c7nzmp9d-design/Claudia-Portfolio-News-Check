// Online-Suche für „+ Position“: ergänzt Name, ISIN, WKN, Ticker und Typ.
//
//  1. onvista (api.onvista.de) – findet Wertpapiere per WKN, ISIN oder Name (Aktien, ETFs, Fonds,
//     Krypto, Rohstoffe, ETCs) und erlaubt den Abruf aus dem Browser.
//  2. Wikidata (query.wikidata.org) – Rückfall, falls onvista nicht antwortet (nur ISIN und Name).
//
// Gesendet wird nur der eingegebene Suchbegriff, nie das Depot.

import { isValidIsin, looksLikeWkn, wknFromIsin, isinFromDeWkn, countryOf, suggestSearchTerm } from './assets.js';

const ONVISTA_SEARCH = 'https://api.onvista.de/api/v1/instruments/query';
const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const TIMEOUT_MS = 12000;

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

// ---------- onvista ----------

const ONVISTA_TYPES = {
  STOCK: 'Aktie', FUND: 'Fonds', CRYPTO: 'Krypto', PRECIOUS_METAL: 'Rohstoff', COMMODITY: 'Rohstoff', BOND: 'Anleihe'
};

export function typeFromOnvista(it) {
  if (it.entitySubType === 'ETF' || /\bETF\b/.test(it.displayType || '')) return 'ETF';
  if (it.entitySubType === 'ETC_ETN_CERTIFICATE' || /ETC|ETN/.test(it.displayType || '')) return 'ETC';
  return ONVISTA_TYPES[it.entityType] || 'Sonstiges';
}

/** Wandelt einen onvista-Treffer in einen Kandidaten um (auch für Tests exportiert). */
export function candidateFromOnvista(it) {
  const type = typeFromOnvista(it);
  return {
    source: 'onvista',
    name: it.name || it.tinyName || '',
    description: [it.displayType, it.symbol || it.homeSymbol].filter(Boolean).join(' · '),
    isin: (it.isin || '').toUpperCase(),
    wkn: (it.wkn || '').toUpperCase(),
    symbol: it.symbol || it.homeSymbol || '',
    exchange: '',
    type,
    country: countryOf(it.isin),
    url: it.urls?.WEBSITE || ''
  };
}

async function searchOnvista(query) {
  const data = await fetchJson(`${ONVISTA_SEARCH}?searchValue=${encodeURIComponent(query)}`);
  return (data.list || [])
    // Hebelprodukte/Optionsscheine o. ä. sind für ein Depot selten gemeint
    .filter(it => it.entityType !== 'DERIVATIVE' || it.entitySubType === 'ETC_ETN_CERTIFICATE')
    .map(candidateFromOnvista)
    .filter(c => c.name);
}

// ---------- Wikidata (Rückfall) ----------

const sparqlString = s => '"' + String(s).replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';

function typeFromWikidata(types) {
  const t = types.join(' ').toLowerCase();
  if (/exchange-traded fund|börsengehandelter fonds|\betf\b/.test(t)) return 'ETF';
  if (/investment fund|investmentfonds|mutual fund|fonds/.test(t)) return 'Fonds';
  if (/cryptocurrency|kryptowährung/.test(t)) return 'Krypto';
  return 'Aktie';
}

async function searchWikidata(query) {
  const isin = query.toUpperCase().replace(/\s/g, '');
  const where = isValidIsin(isin)
    ? `?item wdt:P946 ${sparqlString(isin)} .`
    : `SERVICE wikibase:mwapi {
         bd:serviceParam wikibase:endpoint "www.wikidata.org"; wikibase:api "EntitySearch";
                         mwapi:search ${sparqlString(query)}; mwapi:language "de"; mwapi:limit "15" .
         ?item wikibase:apiOutputItem mwapi:item .
       }`;
  const q = `SELECT ?item ?itemLabel ?itemDescription ?isin ?ticker ?typeLabel WHERE {
      ${where}
      OPTIONAL { ?item wdt:P946 ?isin . }
      OPTIONAL { ?item p:P414 ?st . OPTIONAL { ?st pq:P249 ?ticker . } }
      OPTIONAL { ?item wdt:P31 ?type . }
      FILTER(BOUND(?isin))
      SERVICE wikibase:label { bd:serviceParam wikibase:language "de,en". }
    } LIMIT 80`;
  const data = await fetchJson(`${WIKIDATA_SPARQL}?format=json&query=${encodeURIComponent(q)}`, { headers: { Accept: 'application/sparql-results+json' } });
  const byItem = new Map();
  for (const b of data.results?.bindings || []) {
    const c = byItem.get(b.item.value) || { name: b.itemLabel?.value || '', description: b.itemDescription?.value || '', isins: new Set(), tickers: new Set(), types: new Set() };
    if (b.isin?.value) c.isins.add(b.isin.value.toUpperCase());
    if (b.ticker?.value) c.tickers.add(b.ticker.value);
    if (b.typeLabel?.value) c.types.add(b.typeLabel.value);
    byItem.set(b.item.value, c);
  }
  return [...byItem.values()].filter(c => c.name && !/^Q\d+$/.test(c.name)).map(c => {
    const isins = [...c.isins];
    const pick = isins.includes(isin) ? isin : isins[0] || '';
    return {
      source: 'Wikidata', name: c.name, description: c.description, isin: pick, wkn: wknFromIsin(pick),
      symbol: [...c.tickers][0] || '', exchange: '', type: typeFromWikidata([...c.types]), country: countryOf(pick), url: ''
    };
  });
}

// ---------- Suche ----------

/**
 * Sucht online nach einem Wertpapier (WKN, ISIN oder Name). Gibt { candidates, errors, hint } zurück.
 */
export async function lookupSecurity(query) {
  query = String(query || '').trim();
  if (query.length < 2) return { candidates: [], errors: ['Bitte mindestens 2 Zeichen eingeben.'] };
  const id = query.toUpperCase().replace(/\s/g, '');
  const isIsin = isValidIsin(id);
  const isWkn = !isIsin && looksLikeWkn(id);
  const errors = [];
  let hint = '';

  let candidates = [];
  try {
    candidates = await searchOnvista(isIsin || isWkn ? id : query);
  } catch (e) {
    errors.push(`onvista: ${e.name === 'AbortError' ? 'keine Antwort' : e.message}`);
  }
  if (!candidates.length && !isWkn) {
    try { candidates = await searchWikidata(query); }
    catch (e) { errors.push(`Wikidata: ${e.name === 'AbortError' ? 'keine Antwort' : e.message}`); }
  }
  // WKN ohne onvista: bei deutschen Wertpapieren ISIN berechnen und über Wikidata prüfen
  if (!candidates.length && isWkn) {
    try { candidates = (await searchWikidata(isinFromDeWkn(id))).map(c => ({ ...c, wkn: id })); }
    catch (e) { errors.push(`Wikidata: ${e.message}`); }
    if (!candidates.length) hint = 'Zu dieser WKN wurde nichts gefunden. Bitte WKN prüfen oder Name/ISIN eingeben.';
  }

  // Exakte Treffer (WKN/ISIN) nach vorne, sonst Reihenfolge des Dienstes beibehalten
  const exact = c => (isIsin && c.isin === id) || (isWkn && c.wkn === id);
  candidates.sort((a, b) => (exact(b) ? 1 : 0) - (exact(a) ? 1 : 0));
  if ((isIsin || isWkn) && candidates.some(exact)) candidates = candidates.filter(exact);
  for (const c of candidates) {
    c.wkn ||= wknFromIsin(c.isin);
    c.searchTerm = suggestSearchTerm({ name: c.name, isin: c.isin, type: c.type });
  }
  return { candidates: candidates.slice(0, 8), errors, hint };
}
