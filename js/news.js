// News abrufen, Positionen zuordnen und sortieren.
//
// Anbieter (Einstellung „provider“):
//  • auto (Standard): GDELT direkt; ist GDELT nicht erreichbar (z. B. Safari „Load failed“ durch
//    CORS-Sperre, Überlastung oder Zeitüberschreitung), automatisch Google News RSS über Proxy.
//  • gdelt: GDELT DOC 2.0 API – kostenlos, ohne Schlüssel. Limit 1 Anfrage / 5 s → Begriffe gebündelt.
//  • gnews: Google News RSS – benötigt einen CORS-Proxy (eigener oder öffentlicher Ausweich-Proxy).
//  • Eigene RSS-Feeds je Quelle: direkt (falls CORS erlaubt) oder über Proxy.

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

async function fetchGdelt(terms, domains, days, signal, fetcher) {
  const params = new URLSearchParams({
    query: buildGdeltQuery(terms, domains),
    mode: 'artlist',
    format: 'json',
    maxrecords: '150',
    sort: 'datedesc',
    timespan: `${Math.max(1, Math.min(90, days))}d`
  });
  const text = await fetcher(`${GDELT_URL}?${params}`);
  if (!text.trim().startsWith('{')) {
    const err = new Error('GDELT: ' + text.trim().replace(/<[^>]+>/g, ' ').slice(0, 160));
    err.gdeltText = true; // Antwort kam an, Anfrage aber abgelehnt (z. B. Begriff zu kurz)
    throw err;
  }
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

// Öffentliche Ausweich-Proxys (nur genutzt, wenn erlaubt; sie sehen die Suchanfrage, nicht das Depot).
export const PUBLIC_PROXIES = [
  'https://api.allorigins.win/raw?url={url}',
  'https://api.codetabs.com/v1/proxy?quest={url}'
];
const TIMEOUT_MS = 20000;

/** Übersetzt Browser-Fehler wie Safaris „Load failed“ / Chromes „Failed to fetch“ in verständlichen Text. */
export function friendlyError(e, what) {
  if (e?.timeout) return `${what}: keine Antwort (Zeitüberschreitung)`;
  if (e instanceof TypeError || /load failed|failed to fetch|networkerror/i.test(e?.message || '')) {
    return `${what}: nicht erreichbar oder vom Browser blockiert (CORS/Netzwerk)`;
  }
  return `${what}: ${e?.message || e}`;
}

async function fetchWithTimeout(url, signal, ms = TIMEOUT_MS) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  signal?.addEventListener('abort', onAbort);
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { signal: ctrl.signal, referrerPolicy: 'no-referrer', credentials: 'omit' });
  } catch (e) {
    if (ctrl.signal.aborted && !signal?.aborted) { const t = new Error('Zeitüberschreitung'); t.timeout = true; throw t; }
    throw e;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', onAbort);
  }
}

function proxyChain(settings) {
  const list = [];
  if (settings.proxyUrl) list.push(settings.proxyUrl);
  if (settings.publicProxy !== false) list.push(...PUBLIC_PROXIES);
  return list;
}

const proxyLabel = p => hostOf(p.replace('{url}', '')) || 'Proxy';

/**
 * Holt eine URL als Text: optional direkt, danach nacheinander über die Proxy-Kette.
 * Wirft den letzten Fehler (verständlich formuliert), wenn alles scheitert.
 */
async function fetchText(url, settings, signal, { direct = true, proxies = true } = {}) {
  const attempts = [];
  if (direct) attempts.push({ label: hostOf(url) || 'direkt', url });
  if (proxies) for (const p of proxyChain(settings)) attempts.push({ label: `über ${proxyLabel(p)}`, url: proxied(p, url) });
  if (!attempts.length) throw new Error('Direkter Abruf blockiert (CORS) – CORS-Proxy eintragen oder Ausweich-Proxy erlauben.');
  let last;
  for (const a of attempts) {
    try {
      const r = await fetchWithTimeout(a.url, signal);
      if (!r.ok) { last = new Error(`${a.label}: HTTP ${r.status}`); continue; }
      const text = await r.text();
      if (text.trim()) return text;
      last = new Error(`${a.label}: leere Antwort`);
    } catch (e) {
      if (signal?.aborted) throw e;
      last = new Error(friendlyError(e, a.label));
      last.network = true;
    }
  }
  throw last;
}

/** GDELT direkt, mit einem Wiederholversuch nach Netzwerkfehler (Rate-Limit-Antworten haben oft keinen CORS-Header). */
function gdeltDirectFetcher(settings, signal) {
  return async url => {
    try { return await fetchText(url, settings, signal, { proxies: false }); }
    catch (e) {
      if (signal?.aborted || !e.network) throw e;
      await sleep(GDELT_GAP_MS);
      return fetchText(url, settings, signal, { proxies: false });
    }
  };
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

  const provider = settings.provider || 'auto';
  const termsOf = p => splitTerms(p.searchTerm || p.name);

  // Google News: Begriffe mehrerer Positionen bündeln (weniger Anfragen über den Proxy).
  const runGoogle = async () => {
    const groups = chunk([...new Set(active.flatMap(termsOf))], 6);
    const tasks = [];
    for (const lang of langs) {
      const ds = enabledSources.filter(s => s.lang === lang || s.lang === 'any' || !s.lang).map(s => s.domain);
      if (!ds.length) continue;
      for (const g of groups) {
        tasks.push(async () => {
          const xml = await fetchText(googleNewsUrl(g, ds, days, lang), settings, signal, { direct: false });
          return parseFeed(xml).map(a => ({ ...a, lang, provider: 'Google News' }));
        });
      }
    }
    if (!tasks.length) return 0;
    if (!proxyChain(settings).length) {
      errors.push('Google News benötigt einen CORS-Proxy – bitte unter „Mehr“ eintragen oder den Ausweich-Proxy erlauben.');
      return 0;
    }
    let done = 0;
    const res = await pool(tasks.map(t => async () => { const r = await t(); onProgress(++done, tasks.length); return r; }), 2);
    const failed = res.filter(r => r instanceof Error);
    res.forEach(r => { if (!(r instanceof Error)) raw.push(...r); });
    if (failed.length) errors.push(`Google News: ${failed.length} von ${tasks.length} Abrufen fehlgeschlagen (${failed[0].message}).`);
    return tasks.length - failed.length;
  };

  // GDELT: Suchbegriffe bündeln, um das Anfrage-Limit einzuhalten.
  const runGdelt = async () => {
    const termGroups = chunk([...new Set(active.flatMap(termsOf))], settings.batchSize || 8);
    let useDomainFilter = domains.length <= 25;
    let viaProxy = false;
    let ok = 0;
    for (let i = 0; i < termGroups.length; i++) {
      if (signal?.aborted) break;
      onProgress(i, termGroups.length);
      if (i > 0) await sleep(GDELT_GAP_MS);
      const terms = termGroups[i];
      const fetcher = viaProxy
        ? url => fetchText(url, settings, signal, { direct: false })
        : gdeltDirectFetcher(settings, signal);
      try {
        raw.push(...await fetchGdelt(terms, useDomainFilter ? domains : [], days, signal, fetcher));
        ok++;
      } catch (e) {
        if (signal?.aborted) break;
        if (e.network && ok === 0 && i === 0) {
          // GDELT direkt nicht erreichbar
          if (provider === 'auto') return { unreachable: e };
          if (!viaProxy && proxyChain(settings).length) { viaProxy = true; i--; continue; }
        }
        if (e.gdeltText && useDomainFilter) {
          // Fallback: ohne Domain-Filter abfragen und lokal filtern
          useDomainFilter = false;
          await sleep(GDELT_GAP_MS);
          try { raw.push(...await fetchGdelt(terms, [], days, signal, fetcher)); ok++; continue; }
          catch (e2) { errors.push(e2.message); continue; }
        }
        errors.push(e.message);
      }
    }
    onProgress(termGroups.length, termGroups.length);
    raw = raw.filter(a => !a.lang || langs.includes(a.lang));
    return { ok };
  };

  if (provider === 'gnews') {
    await runGoogle();
  } else {
    const r = await runGdelt();
    if (r?.unreachable) {
      const why = r.unreachable.message.replace(/^[^:]+: /, '');
      const okCount = await runGoogle();
      errors.unshift(okCount
        ? `GDELT ist gerade nicht erreichbar (${why}) – News wurden stattdessen über Google News geladen.`
        : `Keine Verbindung zu den Nachrichtendiensten: GDELT ${why}, Google News über Proxy ebenfalls nicht erreichbar. Bitte später erneut versuchen oder einen eigenen Proxy eintragen (README).`);
    }
  }

  // Eigene RSS-Feeds (Quellen mit Feed-URL)
  const feedSources = enabledSources.filter(s => s.rss);
  if (feedSources.length && (settings.useFeeds ?? true)) {
    const res = await pool(feedSources.map(s => async () => {
      const xml = await fetchText(s.rss, settings, signal);
      return parseFeed(xml, s.name).map(a => ({ ...a, domain: a.domain || s.domain, lang: s.lang, provider: 'RSS' }));
    }), 3);
    res.forEach((r, idx) => {
      // Ohne Proxy sind blockierte Feeds der Normalfall – dann nicht als Fehler melden.
      if (r instanceof Error) { if (!feedSources[idx].builtin) errors.push(`${feedSources[idx].name}: ${r.message}`); }
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
