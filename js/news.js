// News laden und den Positionen zuordnen – bewusst einfach gehalten:
//
//  1. News-Sammlung: Eine GitHub Action (.github/workflows/news.yml) sammelt alle 30 Minuten die
//     Schlagzeilen aller Quellen in news.json. Die App lädt nur diese eine Datei
//     (raw.githubusercontent.com erlaubt den Abruf aus dem Browser) und sucht darin lokal nach den
//     Positionen. Das Depot verlässt das Gerät nicht.
//  2. Ist die Sammlung nicht erreichbar, liest die App die wenigen Feeds, die den direkten Abruf aus
//     dem Browser erlauben (geprüft: tagesschau, CNBC, MarketWatch, WSJ, onvista).
//
// Live-Suchdienste (GDELT, Google News) sind im Browser gesperrt (CORS bzw. HTTP 429) und
// werden deshalb nicht mehr verwendet.

import { hostOf, hostMatches, escapeRegExp, norm } from './util.js';
import { splitTerms, excludedTerms } from './assets.js';

const TIMEOUT_MS = 20000;
// Stellenanzeigen u. ä. sind keine Nachrichten („SAP Berater (m/w/d)“, stellenmarkt.sueddeutsche.de)
export const isJobAd = a => /\((?:[mwdfx]\s*\/\s*){2}[mwdfx]\)/i.test(a.title || '') || /^(stellenmarkt|jobs?|karriere)\./.test(a.domain || '');

/** Feeds, die nachweislich ohne Umweg aus dem Browser abrufbar sind (CORS-Header gesetzt). */
export const DIRECT_FEEDS = [
  { name: 'tagesschau.de', domain: 'tagesschau.de', lang: 'de', url: 'https://www.tagesschau.de/wirtschaft/index~rss2.xml' },
  { name: 'tagesschau.de', domain: 'tagesschau.de', lang: 'de', url: 'https://www.tagesschau.de/wirtschaft/finanzen/index~rss2.xml' },
  { name: 'onvista', domain: 'onvista.de', lang: 'de', url: 'https://www.onvista.de/news/feed/rss.xml' },
  { name: 'CNBC', domain: 'cnbc.com', lang: 'en', url: 'https://www.cnbc.com/id/100003114/device/rss/rss.html' },
  { name: 'CNBC', domain: 'cnbc.com', lang: 'en', url: 'https://www.cnbc.com/id/10001147/device/rss/rss.html' },
  { name: 'CNBC', domain: 'cnbc.com', lang: 'en', url: 'https://www.cnbc.com/id/15839069/device/rss/rss.html' },
  { name: 'MarketWatch', domain: 'marketwatch.com', lang: 'en', url: 'https://feeds.content.dowjones.io/public/rss/mw_topstories' },
  { name: 'MarketWatch', domain: 'marketwatch.com', lang: 'en', url: 'https://feeds.content.dowjones.io/public/rss/mw_marketpulse' },
  { name: 'The Wall Street Journal', domain: 'wsj.com', lang: 'en', url: 'https://feeds.content.dowjones.io/public/rss/RSSMarketsMain' }
];

export function termMatchers(position) {
  const re = t => new RegExp(`(^|\\s)${escapeRegExp(norm(t)).replace(/\s+/g, '\\s+')}(?=\\s|$)`, 'g');
  const term = position.searchTerm || position.name;
  return { pos: splitTerms(term).map(re), neg: excludedTerms(term).map(re) };
}

export function matchPositions(title, positions, matcherCache) {
  const n = ' ' + norm(title) + ' ';
  const hits = [];
  for (const p of positions) {
    const ms = matcherCache.get(p.id);
    if (!ms) continue;
    // Ausschlussbegriffe aus dem Text entfernen, dann nach den Suchbegriffen suchen
    const text = ms.neg.reduce((t, re) => t.replace(re, ' '), n);
    if (ms.pos.some(re => { re.lastIndex = 0; return re.test(text); })) hits.push(p.id);
  }
  return hits;
}

/** Parst RSS/Atom zu Artikeln (im Browser). */
export function parseFeed(xmlText, fallbackSource = '') {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('Feed konnte nicht gelesen werden.');
  return [...doc.querySelectorAll('item, entry')].map(it => {
    const get = sel => it.querySelector(sel)?.textContent?.trim() || '';
    const linkEl = it.querySelector('link');
    const url = linkEl?.getAttribute('href') || linkEl?.textContent?.trim() || '';
    const date = get('pubDate') || get('published') || get('updated');
    const summary = get('description') || get('summary');
    return {
      url, title: get('title'), domain: hostOf(url), sourceName: fallbackSource,
      ts: Date.parse(date) || Date.now(),
      summary: summary.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 240)
    };
  }).filter(a => a.url && a.title);
}

/** Übersetzt Browser-Fehler wie Safaris „Load failed“ in verständlichen Text. */
export function friendlyError(e, what) {
  if (e?.name === 'TimeoutError' || e?.name === 'AbortError') return `${what}: keine Antwort`;
  if (e instanceof TypeError || /load failed|failed to fetch|networkerror/i.test(e?.message || '')) {
    return `${what}: nicht erreichbar`;
  }
  return `${what}: ${e?.message || e}`;
}

async function fetchWithTimeout(url, signal) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { signal: ctrl.signal, referrerPolicy: 'no-referrer', credentials: 'omit' });
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

/** Adresse der News-Sammlung: aus der GitHub-Pages-Adresse abgeleitet oder fest für dieses Repository. */
export function defaultPoolUrl(loc = globalThis.location) {
  const h = loc?.hostname || '';
  if (h.endsWith('.github.io')) {
    const owner = h.split('.')[0];
    const repo = (loc.pathname || '').split('/').filter(Boolean)[0];
    if (repo) return `https://raw.githubusercontent.com/${owner}/${repo}/news-data/news.json`;
  }
  return 'https://raw.githubusercontent.com/t9c7nzmp9d-design/Claudia-Portfolio-News-Check/news-data/news.json';
}

async function fetchPool(signal) {
  const url = defaultPoolUrl() + `?t=${Math.floor(Date.now() / 120000)}`;
  const r = await fetchWithTimeout(url, signal);
  if (r.status === 404) throw new Error('noch nicht vorhanden – die GitHub Action „News sammeln“ muss einmal gelaufen sein');
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const data = await r.json();
  return {
    generatedAt: Date.parse(data.generatedAt) || null,
    items: (data.items || []).map(a => ({ url: a.u, title: a.t, domain: a.d, sourceName: a.s, lang: a.l, ts: a.ts, summary: a.x || '' }))
  };
}

async function fetchFeed(feed, signal) {
  const r = await fetchWithTimeout(feed.url, signal);
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return parseFeed(await r.text(), feed.name).map(a => ({ ...a, domain: feed.domain || a.domain, lang: feed.lang }));
}

/**
 * Holt News und ordnet sie den Positionen zu.
 * @returns {Promise<{items: object[], errors: string[], poolInfo: object|null}>}
 */
export async function fetchNews({ positions, sources, settings, onProgress = () => {}, signal }) {
  const langs = settings.languages?.length ? settings.languages : ['de', 'en'];
  const enabledSources = sources.filter(s => s.enabled && (!s.lang || s.lang === 'any' || langs.includes(s.lang)));
  const days = settings.timespanDays || 7;
  const errors = [];
  const raw = [];
  let poolInfo = null;

  // Lokale Suchliste: eingeschaltete Positionen ab der eingestellten Gewichtung (Standard 2 %)
  const minWeight = Number(settings.watchMinWeight ?? 0);
  const offTypes = new Set(settings.newsOffTypes || []);
  positions = positions.filter(p => p.newsEnabled !== false && p.type !== 'Cash' && !offTypes.has(p.type || 'Sonstiges') && (p.weight || 0) >= minWeight
    && splitTerms(p.searchTerm || p.name).length);
  if (!positions.length) return { items: [], errors: [`Keine Position ab ${minWeight} % Gewichtung mit eingeschalteten News.`], poolInfo };
  if (!enabledSources.length) return { items: [], errors: ['Keine Nachrichtenquelle aktiv (siehe „Quellen“).'], poolInfo };

  onProgress(0, 2);
  try {
    const pool = await fetchPool(signal);
    raw.push(...pool.items);
    poolInfo = { generatedAt: pool.generatedAt, count: pool.items.length };
    if (pool.generatedAt && Date.now() - pool.generatedAt > 6 * 3600000) {
      errors.push(`Die News-Sammlung ist ${Math.round((Date.now() - pool.generatedAt) / 3600000)} Std. alt – läuft die GitHub Action „News sammeln“?`);
    }
  } catch (e) {
    if (signal?.aborted) throw e;
    errors.push(`${friendlyError(e, 'News-Sammlung')} – es werden nur die direkt erreichbaren Quellen gelesen.`);
    const res = await Promise.allSettled(DIRECT_FEEDS.map(f => fetchFeed(f, signal)));
    res.forEach(r => { if (r.status === 'fulfilled') raw.push(...r.value); });
  }
  onProgress(1, 2);

  // Eigene Quellen mit RSS-Feed (nur wenn der Feed den direkten Abruf erlaubt)
  const own = enabledSources.filter(s => s.rss && !s.builtin);
  const ownRes = await Promise.allSettled(own.map(s => fetchFeed({ name: s.name, domain: s.domain, lang: s.lang, url: s.rss }, signal)));
  ownRes.forEach((r, i) => {
    if (r.status === 'fulfilled') raw.push(...r.value);
    else errors.push(`${friendlyError(r.reason, own[i].name)} – der Feed erlaubt keinen direkten Abruf. Tipp: in news/feeds.json eintragen.`);
  });
  onProgress(2, 2);

  // Nur aktivierte Quellen, nur gewählte Sprachen, nur gewählter Zeitraum
  const matcherCache = new Map(positions.map(p => [p.id, termMatchers(p)]));
  const weightOf = new Map(positions.map(p => [p.id, p.weight || 0]));
  const cutoff = Date.now() - days * 86400000;
  const byKey = new Map();
  for (const a of raw) {
    const src = enabledSources.find(s => hostMatches(a.domain, s.domain));
    if (!src || !a.title || a.ts < cutoff || isJobAd(a)) continue;
    if ((a.lang === 'de' || a.lang === 'en') && !langs.includes(a.lang)) continue;
    // Überschrift zählt; zusätzlich der Anreißertext
    let ids = matchPositions(a.title, positions, matcherCache);
    if (!ids.length && a.summary) ids = matchPositions(a.summary, positions, matcherCache);
    if (!ids.length) continue;
    const key = norm(a.title).slice(0, 90);
    const prev = byKey.get(key);
    if (prev) {
      prev.positionIds = [...new Set([...prev.positionIds, ...ids])];
      prev.ts = Math.min(prev.ts, a.ts);
      continue;
    }
    byKey.set(key, {
      id: a.url, url: a.url, title: a.title, domain: src.domain, sourceName: src.name, ts: a.ts, lang: a.lang,
      positionIds: ids.sort((x, y) => weightOf.get(y) - weightOf.get(x))
    });
  }
  return { items: [...byKey.values()], errors: [...new Set(errors)], poolInfo };
}

// ---------- Sortierung: 1. Aktualität (Zeitfenster), 2. Gewichtung ----------

export const BUCKETS = {
  hour: { label: 'Stunde', ms: 3600000 },
  '6h': { label: '6 Stunden', ms: 6 * 3600000 },
  day: { label: 'Tag', ms: 0 },
  none: { label: 'exakt', ms: 1 }
};

export function bucketOf(ts, mode) {
  if (mode === 'day') {
    const d = new Date(ts);
    return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  }
  const ms = BUCKETS[mode]?.ms || 3600000;
  return Math.floor(ts / ms) * ms;
}

export function itemWeight(item, positionsById) {
  return Math.max(0, ...item.positionIds.map(id => positionsById.get(id)?.weight || 0));
}

/** Sortiert: neueres Zeitfenster zuerst; innerhalb des Fensters höhere Gewichtung zuerst; dann Zeit. */
export function rankNews(items, positionsById, mode = 'day') {
  return items
    .filter(it => it.positionIds.some(id => positionsById.has(id)))
    .map(it => ({ ...it, weight: itemWeight(it, positionsById), bucket: bucketOf(it.ts, mode) }))
    .sort((a, b) => b.bucket - a.bucket || b.weight - a.weight || b.ts - a.ts);
}

const STOP = new Set(['der', 'die', 'das', 'und', 'mit', 'für', 'fuer', 'von', 'den', 'dem', 'des', 'ein', 'eine', 'auf', 'ist', 'im', 'in', 'zu', 'bei', 'nach', 'the', 'and', 'for', 'with', 'from', 'that', 'its', 'will', 'says', 'over', 'into']);
const words = t => new Set(norm(t).split(' ').filter(w => w.length >= 3 && !STOP.has(w)));

/**
 * Fasst sehr ähnliche Meldungen (gleiche Hauptposition, ≥ 50 % gemeinsame Wörter, innerhalb von 36 Std.)
 * zu einer zusammen; die übrigen Quellen werden als „auch bei …“ angehängt. Erwartet sortierte Liste.
 */
export function collapseSimilar(items) {
  const kept = [];
  for (const it of items) {
    const w = words(it.title);
    const twin = kept.find(k => k.positionIds[0] === it.positionIds[0] && Math.abs(k.ts - it.ts) < 36 * 3600000 && (() => {
      let common = 0;
      for (const x of w) if (k._w.has(x)) common++;
      return common / Math.max(1, Math.min(w.size, k._w.size)) >= 0.5;
    })());
    if (twin) {
      twin.also = [...new Set([...(twin.also || []), it.sourceName])].filter(s => s !== twin.sourceName);
      twin.alsoIds = [...(twin.alsoIds || []), it.id];
      continue;
    }
    kept.push({ ...it, _w: w });
  }
  return kept;
}

export function bucketLabel(bucket, mode) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  if (mode === 'day') {
    if (bucket === today) return 'Heute';
    if (bucket === today - 86400000) return 'Gestern';
    return new Date(bucket).toLocaleDateString('de-DE', { weekday: 'long', day: '2-digit', month: '2-digit' });
  }
  const d = new Date(bucket);
  const end = new Date(bucket + (BUCKETS[mode]?.ms || 3600000));
  const day = bucket >= today ? 'Heute' : bucket >= today - 86400000 ? 'Gestern' : d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' });
  const t = x => x.toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' });
  return `${day}, ${t(d)}–${t(end)} Uhr`;
}
