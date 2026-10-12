// Dividenden: Abruf direkt vom Gerät über einen eigenen (kostenlosen) API-Schlüssel des Nutzers.
// Übertragen werden nur ISIN, Name bzw. Börsenkürzel des jeweiligen Titels – keine Stückzahlen oder Werte.
// Der Schlüssel bleibt im lokalen Speicher des Geräts.

export const DIV_PROVIDERS = {
  fmp: {
    label: 'Financial Modeling Prep',
    keyUrl: 'https://site.financialmodelingprep.com/register',
    note: 'kostenlos bis 250 Abrufe pro Tag'
  },
  av: {
    label: 'Alpha Vantage',
    keyUrl: 'https://www.alphavantage.co/support/#api-key',
    note: 'kostenlos bis 25 Abrufe pro Tag'
  }
};

/** Daten gelten so lange als aktuell (Abrufe sparen – die Tageslimits sind knapp). */
export const DIV_MAX_AGE_MS = 7 * 86400000;
const TIMEOUT_MS = 15000;

/** Fehler, nach dem keine weiteren Abrufe mehr sinnvoll sind (Limit erreicht, Schlüssel ungültig). */
export class DivStopError extends Error {}

async function getJson(url, signal) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal, referrerPolicy: 'no-referrer', credentials: 'omit' });
    let data = null;
    try { data = await r.json(); } catch { /* kein JSON */ }
    return { status: r.status, data };
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

// ---------------------------------------------------------------- Financial Modeling Prep

const FMP = 'https://financialmodelingprep.com/stable/';

function fmpCheck({ status, data }) {
  const msg = data && !Array.isArray(data) ? (data['Error Message'] || data.message || data.error || '') : '';
  if (status === 401 || /invalid api key/i.test(msg)) throw new DivStopError('API-Schlüssel ungültig – bitte unter „Einstellungen“ prüfen.');
  if (status === 429 || /limit reach/i.test(msg)) throw new DivStopError('Tageslimit des Dienstes erreicht – morgen geht es weiter.');
  if (status === 402 || status === 403 || /premium|restricted|subscription|not available under your current/i.test(msg)) {
    const e = new Error('mit dem kostenlosen Zugang nicht verfügbar'); e.restricted = true; throw e;
  }
  if (status >= 400) throw new Error(`HTTP ${status}`);
  return Array.isArray(data) ? data : [];
}

const EXCHANGE_PREF = ['XETRA', 'XETR', 'GER', 'FSX', 'NASDAQ', 'NYSE', 'LSE', 'EURONEXT', 'AMS', 'PAR', 'SIX', 'MIL'];
const rankExchange = ex => { const i = EXCHANGE_PREF.indexOf(String(ex || '').toUpperCase()); return i < 0 ? 99 : i; };

async function fmpSymbol(t, key, signal) {
  if (t.isin) {
    try {
      const hits = fmpCheck(await getJson(`${FMP}search-isin?isin=${encodeURIComponent(t.isin)}&apikey=${encodeURIComponent(key)}`, signal));
      if (hits.length) {
        const best = [...hits].sort((a, b) => rankExchange(a.exchange || a.exchangeShortName) - rankExchange(b.exchange || b.exchangeShortName))[0];
        return { symbol: best.symbol, currency: best.currency || '', name: best.name || '' };
      }
    } catch (e) { if (e instanceof DivStopError) throw e; /* sonst über den Namen versuchen */ }
  }
  const q = shortName(t.name);
  if (!q) return null;
  const hits = fmpCheck(await getJson(`${FMP}search-name?query=${encodeURIComponent(q)}&apikey=${encodeURIComponent(key)}`, signal));
  if (!hits.length) return null;
  const best = [...hits].sort((a, b) => rankExchange(a.exchange || a.exchangeShortName) - rankExchange(b.exchange || b.exchangeShortName))[0];
  return { symbol: best.symbol, currency: best.currency || '', name: best.name || '' };
}

async function fmpDividends(symbol, key, signal) {
  const rows = fmpCheck(await getJson(`${FMP}dividends?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`, signal));
  return rows.map(r => ({
    ex: r.date || r.exDividendDate || '',
    pay: r.paymentDate || '',
    amount: Number(r.dividend ?? r.adjDividend),
    frequency: r.frequency || ''
  }));
}

// ---------------------------------------------------------------- Alpha Vantage

const AV = 'https://www.alphavantage.co/query?';

function avCheck({ status, data }) {
  const info = data && (data.Information || data.Note || data['Error Message'] || '');
  if (/api key|apikey/i.test(info) && /invalid|demo/i.test(info)) throw new DivStopError('API-Schlüssel ungültig – bitte unter „Einstellungen“ prüfen.');
  if (/rate limit|requests per day|call frequency|premium/i.test(info)) throw new DivStopError('Tageslimit des Dienstes erreicht – morgen geht es weiter.');
  if (status >= 400) throw new Error(`HTTP ${status}`);
  if (info && !data.data && !data.bestMatches) throw new Error(info.slice(0, 120));
  return data || {};
}

async function avSymbol(t, key, signal) {
  const q = shortName(t.name) || t.isin;
  if (!q) return null;
  const data = avCheck(await getJson(`${AV}function=SYMBOL_SEARCH&keywords=${encodeURIComponent(q)}&apikey=${encodeURIComponent(key)}`, signal));
  const hits = (data.bestMatches || []).map(m => ({ symbol: m['1. symbol'], name: m['2. name'], region: m['4. region'], currency: m['8. currency'] }));
  if (!hits.length) return null;
  // Deutsche ISIN → bevorzugt XETRA-Notierung (Kürzel mit .DEX), sonst die erste Fundstelle
  const de = /^DE/.test(t.isin || '') ? hits.find(h => /\.DEX$|\.FRK$/.test(h.symbol)) : null;
  const best = de || hits[0];
  return { symbol: best.symbol, currency: best.currency || '', name: best.name || '' };
}

async function avDividends(symbol, key, signal) {
  const data = avCheck(await getJson(`${AV}function=DIVIDENDS&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`, signal));
  return (data.data || []).map(r => ({
    ex: r.ex_dividend_date && r.ex_dividend_date !== 'None' ? r.ex_dividend_date : '',
    pay: r.payment_date && r.payment_date !== 'None' ? r.payment_date : '',
    amount: Number(r.amount),
    frequency: ''
  }));
}

// ---------------------------------------------------------------- Gemeinsam

/** Name für die Suche kürzen: Rechtsform, Aktiengattung und Zusätze entfernen. */
const NAME_STOP = new Set(['inc', 'corp', 'corporation', 'co', 'ltd', 'plc', 'ag', 'se', 'sa', 'nv', 'kgaa', 'gmbh', 'holding', 'holdings',
  'group', 'registered', 'reg', 'share', 'shares', 'namens-aktien', 'namensaktien', 'inhaber-aktien', 'inhaberaktien', 'vink', 'vz', 'st',
  'o.n', 'on', 'dl', 'eo', 'sf', 'ucits', 'etf', 'acc', 'dis', 'dist', 'thesaurierend', 'ausschüttend', 'usd', 'eur', 'class', 'cl', 'a', 'b']);

/** Name für die Suche kürzen: Rechtsform, Aktiengattung, Währungen und Zusätze entfernen. */
export function shortName(name) {
  return String(name || '').replace(/[(),;:]/g, ' ').split(/[\s.]+/)
    .filter(w => w.length > 1 && !/\d/.test(w) && /[a-zäöüß]/i.test(w) && !NAME_STOP.has(w.toLowerCase()))
    .slice(0, 4).join(' ');
}

const PROVIDER_FNS = { fmp: { symbol: fmpSymbol, dividends: fmpDividends }, av: { symbol: avSymbol, dividends: avDividends } };

/**
 * Börsenkürzel im Format des Dienstes aus einem Basiskürzel (z. B. von onvista: „SAP“) ableiten.
 * US-Werte: Kürzel ohne Zusatz. Sonst die Xetra-Notierung (für Anleger in Deutschland die übliche):
 * Alpha Vantage „SAP.DEX“, Financial Modeling Prep „SAP.DE“.
 */
export function deriveSymbols(provider, base, isin = '') {
  base = String(base || '').trim().toUpperCase().replace(/\s+/g, '');
  if (!base || !/^[A-Z0-9.\-]{1,12}$/.test(base)) return [];
  if (base.includes('.')) return [base];
  const cc = String(isin || '').slice(0, 2).toUpperCase();
  const xetra = provider === 'av' ? `${base}.DEX` : `${base}.DE`;
  if (cc === 'US' || cc === 'CA') return [base, xetra];
  if (cc === 'GB') return [provider === 'av' ? `${base}.LON` : `${base}.L`, xetra];
  if (cc === 'CH') return [provider === 'av' ? `${base}.SWX` : `${base}.SW`, xetra];
  return [xetra, base];
}

function cleanEvents(list) {
  return list
    .filter(e => /^\d{4}-\d{2}-\d{2}/.test(e.ex) && Number.isFinite(e.amount) && e.amount > 0)
    .map(e => ({ ex: e.ex.slice(0, 10), pay: /^\d{4}-\d{2}-\d{2}/.test(e.pay) ? e.pay.slice(0, 10) : '', amount: e.amount }))
    .sort((a, b) => b.ex.localeCompare(a.ex))
    .slice(0, 24);
}

/**
 * Dividenden eines Titels abrufen. Reihenfolge der Kürzel: von Hand eingetragen → bereits gefunden →
 * aus dem Basiskürzel abgeleitet (`t.baseSymbol`, z. B. von onvista – kostet kein Kontingent) → Suche beim Dienst.
 * Liefert ein Kürzel keine Daten, wird das nächste versucht (höchstens 4 Abrufe pro Titel, meist genügt einer).
 * `noData: true` heißt: Der Dienst kennt zu diesem Titel keine Ausschüttungen (thesaurierend oder nicht abgedeckt).
 */
export async function fetchDividends(t, { provider, key, cached, signal }) {
  const fns = PROVIDER_FNS[provider];
  if (!fns) throw new DivStopError('Unbekannter Dienst.');
  if (!key) throw new DivStopError('Kein API-Schlüssel hinterlegt.');
  const same = cached?.provider === provider;
  const tried = [];
  let budget = 4;
  const attempt = async (symbol, currency = '') => {
    if (!symbol || tried.includes(symbol) || budget <= 0) return null;
    tried.push(symbol);
    budget--;
    let raw;
    try { raw = await fns.dividends(symbol, key, signal); }
    catch (e) { if (e instanceof DivStopError || e.name === 'AbortError') throw e; return null; } // unbekanntes Kürzel → nächstes versuchen
    const events = cleanEvents(raw);
    return events.length ? { provider, symbol, currency: currency || currencyFromSymbol(symbol), events, fetchedAt: Date.now(), error: '' } : null;
  };
  if (t.divSymbol) {
    return (await attempt(t.divSymbol)) || { provider, symbol: t.divSymbol, currency: currencyFromSymbol(t.divSymbol), events: [], fetchedAt: Date.now(), error: '', noData: true };
  }
  let hit = same && cached.symbol && cached.events?.length ? await attempt(cached.symbol, cached.currency) : null;
  for (const sym of deriveSymbols(provider, t.baseSymbol, t.isin)) {
    if (hit || budget <= 2) break; // zwei Abrufe für Suche + Versuch übrig lassen
    hit = await attempt(sym);
  }
  if (!hit && budget > 1) {
    const found = await fns.symbol(t, key, signal);
    budget--;
    if (found) hit = await attempt(found.symbol, found.currency);
  }
  if (hit) return hit;
  return { provider, symbol: tried[0] || '', currency: currencyFromSymbol(tried[0]), events: [], fetchedAt: Date.now(), error: '', noData: true,
    tried };
}

export function currencyFromSymbol(symbol) {
  const s = String(symbol || '').toUpperCase();
  if (/\.(DE|DEX|F|FRK|PA|AS|MI|MC|BR|VI|HE|LS|IR)$/.test(s)) return 'EUR';
  if (/\.(L|LON)$/.test(s)) return 'GBp';
  if (/\.(SW|SWX)$/.test(s)) return 'CHF';
  if (!s.includes('.')) return 'USD';
  return '';
}

/**
 * Kennzahlen aus der Dividendenhistorie: nächste (bereits angekündigte) und letzte Ausschüttung,
 * Summe und Anzahl der letzten 12 Monate. `pays` = schüttet aus (in den letzten ~15 Monaten oder angekündigt).
 */
export function summarizeDividends(events, now = Date.now()) {
  const today = new Date(now).toISOString().slice(0, 10);
  const yearAgo = new Date(now - 365 * 86400000).toISOString().slice(0, 10);
  const recentLimit = new Date(now - 456 * 86400000).toISOString().slice(0, 10);
  const sorted = [...(events || [])].sort((a, b) => a.ex.localeCompare(b.ex));
  const next = sorted.find(e => e.ex >= today) || null;
  const last = [...sorted].reverse().find(e => e.ex < today) || null;
  const ttm = sorted.filter(e => e.ex >= yearAgo && e.ex < today);
  const ttmSum = ttm.reduce((s, e) => s + e.amount, 0);
  const pays = !!next || (last && last.ex >= recentLimit);
  return { next, last, ttmSum, ttmCount: ttm.length, pays: !!pays };
}

/** Muss neu abgerufen werden? (nie abgerufen, zu alt, anderer Dienst oder anderes Kürzel) */
export function needsRefresh(cached, { provider, symbol }, now = Date.now()) {
  if (!cached || cached.provider !== provider) return true;
  // Einträge aus v2.3.0 ohne Daten sofort neu versuchen (damals noch ohne Kürzel-Ableitung)
  if ((cached.v || 1) < 2 && !cached.events?.length) return true;
  if (symbol && cached.symbol !== symbol) return true;
  if (cached.error && !cached.events?.length) return now - (cached.fetchedAt || 0) > 86400000;
  return now - (cached.fetchedAt || 0) > DIV_MAX_AGE_MS;
}
