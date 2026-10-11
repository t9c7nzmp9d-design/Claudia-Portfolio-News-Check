// News abrufen, Positionen zuordnen und sortieren.
//
// Anbieter:
//  • GDELT DOC 2.0 API (Standard): kostenlos, ohne Schlüssel, direkt aus dem Browser abrufbar.
//    Limit: 1 Anfrage alle 5 Sekunden → mehrere Positionen werden pro Anfrage gebündelt.
//  • Google News RSS: genauere Treffer, benötigt aber einen CORS-Proxy (siehe proxy/ und README).
//  • Eigene RSS-Feeds je Quelle: ebenfalls über Proxy (oder direkt, falls der Feed CORS erlaubt).

import { sleep, hostOf, hostMatches, escapeRegExp, norm } from './util.js';
import { splitTerms } from './assets.js';

const GDELT_URL = 'https://api.gdeltproject.org/api/v2/doc/doc';
const GDELT_GAP_MS = 5600;
const LANG_GDELT = { de: 'german', en: 'english' };

/** Baut aus "A OR B" Regexe, die ganze Wörter im Titel finden. */
export function termMatchers(position) {
  return splitTerms(position.searchTerm || position.name).map(t => {
    const body = escapeRegExp(norm(t)).replace(/\\ |\s+/g, '\\s+');
    return new RegExp(`(^|\\s)${body}(\\s|$)`);
  });
}

export function matchPositions(title, positions, matcherCache) {
  const n = ' ' + norm(title) + ' ';
  const hits = [];
  for (const p of positions) {
    const ms = matcherCache.get(p.id);
    if (ms && ms.some(re => re.test(n))) hits.push(p.id);
  }
  return hits;
}

function parseGdeltDate(s) {
  // 20261011T093000Z
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(s || '');
  return m ? Date.UTC(+m[1], m[2] - 1, +m[3], +m[4], +m[5], +m[6]) : Date.now();
}

function quote(t) {
  return `"${t.replace(/"/g, '')}"`;
}

export function buildGdeltQuery(terms, domains) {
  const t = terms.length === 1 ? quote(terms[0]) : `(${terms.map(quote).join(' OR ')})`;
  if (!domains.length) return t;
  const d = domains.length === 1 ? `domain:${domains[0]}` : `(${domains.map(x => `domain:${x}`).join(' OR ')})`;
  return `${t} ${d}`;
}

async function fetchGdelt(terms, domains, days, signal) {
  const params = new URLSearchParams({
    query: buildGdeltQuery(terms, domains),
    mode: 'artlist',
    format: 'json',
    maxrecords: '150',
    sort: 'datedesc',
    timespan: `${Math.max(1, Math.min(90, days))}d`
  });
  const res = await fetch(`${GDELT_URL}?${params}`, { signal });
  const text = await res.text();
  if (!res.ok) throw new Error(`GDELT antwortet mit ${res.status}`);
  if (!text.trim().startsWith('{')) throw new Error('GDELT: ' + text.trim().slice(0, 160));
  const data = JSON.parse(text);
  return (data.articles || []).map(a => ({
    url: a.url,
    title: a.title,
    domain: a.domain || hostOf(a.url),
    ts: parseGdeltDate(a.seendate),
    lang: /german/i.test(a.language) ? 'de' : /english/i.test(a.language) ? 'en' : (a.language || '').slice(0, 2).toLowerCase(),
    image: a.socialimage || '',
    provider: 'GDELT'
  }));
}

export function proxied(proxyUrl, url) {
  if (!proxyUrl) return url;
  if (proxyUrl.includes('{url}')) return proxyUrl.replace('{url}', encodeURIComponent(url));
  return proxyUrl + encodeURIComponent(url);
}

/** Parst RSS/Atom zu Artikeln. */
export function parseFeed(xmlText, fallbackSource = '') {
  const doc = new DOMParser().parseFromString(xmlText, 'text/xml');
  if (doc.querySelector('parsererror')) throw new Error('Feed konnte nicht gelesen werden.');
  const items = [...doc.querySelectorAll('item, entry')];
  return items.map(it => {
    const get = sel => it.querySelector(sel)?.textContent?.trim() || '';
    const linkEl = it.querySelector('link');
    const url = linkEl?.getAttribute('href') || linkEl?.textContent?.trim() || '';
    const srcEl = it.querySelector('source');
    const sourceUrl = srcEl?.getAttribute('url') || '';
    const sourceName = srcEl?.textContent?.trim() || fallbackSource;
    let title = get('title');
    if (sourceName && title.endsWith(' - ' + sourceName)) title = title.slice(0, -(sourceName.length + 3));
    const date = get('pubDate') || get('published') || get('updated') || get('dc\\:date');
    const ts = Date.parse(date) || Date.now();
    return { url, title, domain: hostOf(sourceUrl || url), sourceName, ts, provider: 'RSS' };
  }).filter(a => a.url && a.title);
}

async function fetchText(url, proxyUrl, signal) {
  // Erst direkt versuchen (manche Feeds erlauben CORS), dann über Proxy.
  try {
    const r = await fetch(url, { signal });
    if (r.ok) return await r.text();
  } catch (e) { if (e.name === 'AbortError') throw e; }
  if (!proxyUrl) throw new Error('Direkter Abruf blockiert (CORS) – bitte CORS-Proxy in den Einstellungen eintragen.');
  const r = await fetch(proxied(proxyUrl, url), { signal });
  if (!r.ok) throw new Error(`Proxy antwortet mit ${r.status}`);
  return r.text();
}

function googleNewsUrl(terms, domains, days, lang) {
  const t = terms.length === 1 ? quote(terms[0]) : `(${terms.map(quote).join(' OR ')})`;
  const d = domains.length ? ` (${domains.map(x => `site:${x}`).join(' OR ')})` : '';
  const q = `${t}${d} when:${Math.max(1, days)}d`;
  const loc = lang === 'de' ? 'hl=de&gl=DE&ceid=DE:de' : 'hl=en-US&gl=US&ceid=US:en';
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&${loc}`;
}

function chunk(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function pool(tasks, limit) {
  const results = [];
  let i = 0;
  const workers = Array.from({ length: Math.min(limit, tasks.length) }, async () => {
    while (i < tasks.length) {
      const idx = i++;
      try { results[idx] = await tasks[idx](); } catch (e) { results[idx] = e; }
    }
  });
  await Promise.all(workers);
  return results;
}

/**
 * Holt News für die Positionen.
 * @returns {Promise<{items: object[], errors: string[]}>}
 */
export async function fetchNews({ positions, sources, settings, onProgress = () => {}, signal }) {
  const active = positions
    .filter(p => p.type !== 'Cash' && splitTerms(p.searchTerm || p.name).length && p.newsEnabled !== false)
    .sort((a, b) => (b.weight || 0) - (a.weight || 0))
    .slice(0, settings.maxPositions || 20);
  const langs = settings.languages?.length ? settings.languages : ['de', 'en'];
  const enabledSources = sources.filter(s => s.enabled && (!s.lang || langs.includes(s.lang) || s.lang === 'any'));
  const domains = enabledSources.map(s => s.domain).filter(Boolean);
  const days = settings.timespanDays || 7;
  const errors = [];
  let raw = [];

  positions = positions.filter(p => p.newsEnabled !== false);
  const matcherCache = new Map(positions.map(p => [p.id, termMatchers(p)]));

  if (!active.length) return { items: [], errors: ['Keine Positionen mit Suchbegriff vorhanden.'] };
  if (!domains.length) return { items: [], errors: ['Keine Nachrichtenquelle aktiv.'] };

  if (settings.provider === 'gnews') {
    const tasks = [];
    for (const p of active) {
      for (const lang of langs) {
        const ds = enabledSources.filter(s => s.lang === lang || s.lang === 'any' || !s.lang).map(s => s.domain);
        if (!ds.length) continue;
        tasks.push(async () => {
          const xml = await fetchText(googleNewsUrl(splitTerms(p.searchTerm || p.name), ds, days, lang), settings.proxyUrl, signal);
          return parseFeed(xml).map(a => ({ ...a, lang, provider: 'Google News', hint: p.id }));
        });
      }
    }
    let done = 0;
    const wrapped = tasks.map(t => async () => { const r = await t(); onProgress(++done, tasks.length); return r; });
    const res = await pool(wrapped, 4);
    res.forEach(r => (r instanceof Error ? errors.push(r.message) : raw.push(...r)));
  } else {
    // GDELT: Suchbegriffe bündeln, um das Anfrage-Limit einzuhalten.
    const termGroups = chunk(active.flatMap(p => splitTerms(p.searchTerm || p.name).map(t => ({ t, p }))), settings.batchSize || 8);
    let useDomainFilter = domains.length <= 25;
    for (let i = 0; i < termGroups.length; i++) {
      if (signal?.aborted) break;
      onProgress(i, termGroups.length);
      if (i > 0) await sleep(GDELT_GAP_MS);
      const terms = [...new Set(termGroups[i].map(x => x.t))];
      try {
        raw.push(...await fetchGdelt(terms, useDomainFilter ? domains : [], days, signal));
      } catch (e) {
        if (e.name === 'AbortError') break;
        if (useDomainFilter) {
          // Fallback: ohne Domain-Filter abfragen und lokal filtern
          useDomainFilter = false;
          await sleep(GDELT_GAP_MS);
          try { raw.push(...await fetchGdelt(terms, [], days, signal)); continue; } catch (e2) { errors.push(e2.message); continue; }
        }
        errors.push(e.message);
      }
    }
    onProgress(termGroups.length, termGroups.length);
    raw = raw.filter(a => !a.lang || langs.includes(a.lang));
  }

  // Eigene RSS-Feeds (Quellen mit Feed-URL)
  const feedSources = enabledSources.filter(s => s.rss);
  if (feedSources.length && (settings.useFeeds ?? true)) {
    const res = await pool(feedSources.map(s => async () => {
      const xml = await fetchText(s.rss, settings.proxyUrl, signal);
      return parseFeed(xml, s.name).map(a => ({ ...a, domain: a.domain || s.domain, lang: s.lang, provider: 'RSS' }));
    }), 3);
    res.forEach((r, idx) => {
      // Ohne Proxy sind blockierte Feeds der Normalfall – dann nicht als Fehler melden.
      if (r instanceof Error) { if (settings.proxyUrl || !feedSources[idx].builtin) errors.push(`${feedSources[idx].name}: ${r.message}`); }
      else raw.push(...r.map(a => ({ ...a, fromFeed: feedSources[idx].domain })));
    });
  }

  // Nur anerkannte Quellen (Whitelist) zulassen
  const sourceFor = a => enabledSources.find(s => hostMatches(a.domain, s.domain) || (a.fromFeed && s.domain === a.fromFeed));
  const weightOf = new Map(positions.map(p => [p.id, p.weight || 0]));
  const byKey = new Map();
  const cutoff = Date.now() - days * 86400000;
  for (const a of raw) {
    const src = sourceFor(a);
    if (!src || !a.title) continue;
    if (a.ts < cutoff) continue;
    let ids = matchPositions(a.title, positions, matcherCache);
    if (!ids.length && a.hint && settings.provider === 'gnews') ids = [a.hint]; // Google hat im Volltext gefunden
    if (!ids.length) continue;
    const key = norm(a.title).slice(0, 90);
    const prev = byKey.get(key);
    const item = {
      id: a.url,
      url: a.url,
      title: a.title,
      domain: src.domain,
      sourceName: src.name,
      ts: a.ts,
      lang: a.lang,
      image: a.image || '',
      provider: a.provider,
      positionIds: ids.sort((x, y) => weightOf.get(y) - weightOf.get(x))
    };
    if (prev) {
      prev.positionIds = [...new Set([...prev.positionIds, ...item.positionIds])];
      if (item.ts < prev.ts) prev.ts = item.ts; // frühester Zeitpunkt
    } else byKey.set(key, item);
  }
  return { items: [...byKey.values()], errors: [...new Set(errors)] };
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
