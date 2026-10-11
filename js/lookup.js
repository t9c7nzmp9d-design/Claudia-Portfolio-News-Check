// Online-Suche für „+ Position“: ergänzt Name, ISIN, WKN, Ticker und Typ.
//
// Quellen (beide kostenlos, ohne Schlüssel, direkt aus dem Browser nutzbar):
//  • Wikidata (query.wikidata.org) – Name ↔ ISIN, Börsenkürzel, Art des Objekts
//  • OpenFIGI (api.openfigi.com) – ISIN/WKN → Name, Ticker, Wertpapiertyp
// Gesendet wird nur der eingegebene Suchbegriff (Name, ISIN oder WKN), nie das Depot.

import { isValidIsin, looksLikeWkn, wknFromIsin, countryOf, suggestSearchTerm, cleanCompanyName } from './assets.js';

const WIKIDATA_SPARQL = 'https://query.wikidata.org/sparql';
const OPENFIGI_MAPPING = 'https://api.openfigi.com/v3/mapping';
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

function typeFromFigi(d) {
  const t = `${d.securityType || ''} ${d.securityType2 || ''} ${d.marketSector || ''}`.toLowerCase();
  if (/etp|etf/.test(t)) return 'ETF';
  if (/fund/.test(t)) return 'Fonds';
  if (/corp|govt|bond|note/.test(t) && !/equity/.test(t)) return 'Anleihe';
  if (/comdty/.test(t)) return 'Rohstoff';
  return 'Aktie';
}

/** OpenFIGI: ISIN oder WKN → Name, Ticker, Typ (bevorzugt deutsche Börsenplätze). */
async function searchOpenFigi(query) {
  const id = query.toUpperCase().replace(/\s/g, '');
  const idType = isValidIsin(id) ? 'ID_ISIN' : looksLikeWkn(id) ? 'ID_WERTPAPIER' : null;
  if (!idType) return [];
  const data = await fetchJson(OPENFIGI_MAPPING, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify([{ idType, idValue: id }])
  });
  const rows = data?.[0]?.data || [];
  if (!rows.length) return [];
  const pick = rows.find(r => r.exchCode === 'GY') || rows.find(r => r.exchCode === 'GR') || rows.find(r => r.exchCode === 'US') || rows[0];
  return [{
    source: 'OpenFIGI',
    name: titleCase(pick.name || ''),
    description: [pick.securityType, pick.exchCode].filter(Boolean).join(' · '),
    isin: idType === 'ID_ISIN' ? id : '',
    wkn: idType === 'ID_WERTPAPIER' ? id : '',
    symbol: pick.ticker || '',
    exchange: pick.exchCode || '',
    type: typeFromFigi(pick)
  }];
}

// OpenFIGI liefert Namen in Großbuchstaben („APPLE INC“) → lesbarer machen
function titleCase(s) {
  if (s !== s.toUpperCase()) return s;
  return s.toLowerCase().replace(/\b([a-zäöü])/g, m => m.toUpperCase())
    .replace(/\b(Ag|Se|Nv|Plc|Sa|Inc|Etf|Ucits|Msci|Usd|Eur|Spdr)\b/g, m => m.toUpperCase().replace('INC', 'Inc'));
}

/**
 * Sucht online nach einem Wertpapier. Gibt { candidates, errors } zurück.
 * Kandidaten: { source, name, description, isin, wkn, symbol, exchange, type, country, searchTerm }
 */
export async function lookupSecurity(query) {
  query = String(query || '').trim();
  if (query.length < 2) return { candidates: [], errors: ['Bitte mindestens 2 Zeichen eingeben.'] };
  const errors = [];
  const settle = async (name, p) => { try { return await p; } catch (e) { errors.push(`${name}: ${e.name === 'AbortError' ? 'keine Antwort' : e.message}`); return []; } };

  let [wd, figi] = await Promise.all([settle('Wikidata', searchWikidata(query)), settle('OpenFIGI', searchOpenFigi(query))]);

  // WKN: Wikidata kennt keine WKN → mit dem Namen aus OpenFIGI nachsuchen, um die ISIN zu finden
  const id = query.toUpperCase().replace(/\s/g, '');
  if (!isValidIsin(id) && looksLikeWkn(id) && figi[0]?.name) {
    const more = await settle('Wikidata', searchWikidata(cleanCompanyName(figi[0].name)));
    figi[0].isin ||= more.find(c => c.isin)?.isin || '';
    wd = more;
  }

  const all = [...figi, ...wd];
  // Zusammenführen: gleiche ISIN → ein Kandidat
  const merged = [];
  for (const c of all) {
    const same = c.isin && merged.find(m => m.isin === c.isin);
    if (same) {
      same.symbol ||= c.symbol; same.exchange ||= c.exchange; same.country ||= c.country;
      if (c.source === 'Wikidata' && same.source === 'OpenFIGI') { same.name = c.name; same.description = c.description || same.description; }
      same.source = 'Wikidata + OpenFIGI';
      continue;
    }
    merged.push({ ...c });
  }
  for (const c of merged) {
    c.wkn ||= wknFromIsin(c.isin) || (looksLikeWkn(id) && !isValidIsin(id) ? id : '');
    c.country ||= countryOf(c.isin);
    c.searchTerm = suggestSearchTerm({ name: c.name, isin: c.isin, type: c.type });
  }
  // Kandidaten mit ISIN zuerst
  merged.sort((a, b) => (b.isin ? 1 : 0) - (a.isin ? 1 : 0));
  return { candidates: merged.slice(0, 8), errors };
}
