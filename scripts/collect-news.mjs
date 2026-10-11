// Sammelt Wirtschafts-Schlagzeilen anerkannter Quellen in eine JSON-Datei.
// Läuft als GitHub Action (siehe .github/workflows/news.yml) – dort gibt es keine
// CORS-Sperren wie im Browser. Die App lädt nur diese Datei und ordnet die Artikel
// lokal den eigenen Positionen zu; das Depot verlässt das Gerät dabei nicht.
//
// Aufruf: node scripts/collect-news.mjs <ausgabe.json> [vorherige.json]
// Keine Abhängigkeiten, Node ≥ 20.

import { readFileSync, writeFileSync, existsSync } from 'node:fs';

const OUT = process.argv[2] || 'news.json';
const PREV = process.argv[3];
const KEEP_DAYS = 7;
const MAX_ITEMS = 3000;
const TIMEOUT_MS = 20000;
const UA = 'Mozilla/5.0 (compatible; DepotNewsCollector/1.0; +https://github.com/)';

const root = new URL('../', import.meta.url);
const config = JSON.parse(readFileSync(new URL('news/feeds.json', root), 'utf8'));
const watchlist = readFileSync(new URL('news/watchlist.txt', root), 'utf8')
  .split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#'));

// ---------- RSS/Atom ohne Bibliothek parsen ----------

const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
function decode(s) {
  return String(s || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m);
}
const stripTags = s => decode(s).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

function tag(block, name) {
  const m = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i'));
  return m ? m[1] : '';
}
function attr(block, name, attribute) {
  const m = block.match(new RegExp(`<${name}\\s[^>]*${attribute}="([^"]*)"`, 'i'));
  return m ? decode(m[1]) : '';
}

export function parseFeed(xml) {
  const blocks = xml.match(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi) || [];
  return blocks.map(b => {
    let link = stripTags(tag(b, 'link')) || attr(b, 'link', 'href');
    const date = stripTags(tag(b, 'pubDate') || tag(b, 'published') || tag(b, 'updated') || tag(b, 'dc:date'));
    return {
      title: stripTags(tag(b, 'title')),
      url: link.trim(),
      summary: stripTags(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content')).slice(0, 240),
      ts: Date.parse(date) || null,
      sourceName: stripTags(tag(b, 'source')),
      sourceUrl: attr(b, 'source', 'url')
    };
  }).filter(a => a.title && a.url);
}

// ---------- Abruf ----------

async function get(url) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': UA, Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml, */*' } });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(t);
  }
}

const host = u => { try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch { return ''; } };
const quote = t => `"${t.replace(/"/g, '')}"`;

function googleUrl(q, lang) {
  const loc = lang === 'de' ? 'hl=de&gl=DE&ceid=DE:de' : 'hl=en-US&gl=US&ceid=US:en';
  return `https://news.google.com/rss/search?q=${encodeURIComponent(q)}&${loc}`;
}

async function pool(jobs, limit) {
  const out = [];
  let i = 0;
  await Promise.all(Array.from({ length: limit }, async () => {
    while (i < jobs.length) {
      const job = jobs[i++];
      try {
        out.push({ job, items: await job.run() });
      } catch (e) {
        out.push({ job, error: e.name === 'AbortError' ? 'Zeitüberschreitung' : e.message });
      }
      await new Promise(r => setTimeout(r, 300));
    }
  }));
  return out;
}

const jobs = [];
for (const f of config.feeds) {
  jobs.push({
    label: `RSS ${f.name} ${f.url}`,
    run: async () => parseFeed(await get(f.url)).map(a => ({ ...a, domain: f.domain, sourceName: f.name, lang: f.lang }))
  });
}
// Medien ohne eigenen Feed (z. B. Reuters) über Google News
for (const s of config.sites) {
  jobs.push({
    label: `Google site:${s.domain}`,
    run: async () => parseFeed(await get(googleUrl(`site:${s.domain} when:2d`, s.lang))).map(a => ({ ...a, lang: s.lang }))
  });
}
// Gezielte Suche nach den Begriffen der Watchlist, beschränkt auf die bekannten Quellen
const allSites = [...new Set([...config.feeds.map(f => f.domain), ...config.sites.map(s => s.domain)])];
for (let i = 0; i < watchlist.length; i += 5) {
  const terms = watchlist.slice(i, i + 5);
  for (const lang of ['de', 'en']) {
    const sites = allSites.filter(d => {
      const f = config.feeds.find(x => x.domain === d) || config.sites.find(x => x.domain === d);
      return f.lang === lang;
    });
    const q = `(${terms.map(quote).join(' OR ')}) (${sites.map(d => `site:${d}`).join(' OR ')}) when:3d`;
    jobs.push({
      label: `Google Suche ${lang}: ${terms.join(', ')}`,
      run: async () => parseFeed(await get(googleUrl(q, lang))).map(a => ({ ...a, lang }))
    });
  }
}

const started = Date.now();
const results = await pool(jobs, 4);

// ---------- Zusammenführen ----------

const now = Date.now();
const cutoff = now - KEEP_DAYS * 86400000;
const byKey = new Map();
const normTitle = t => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim().slice(0, 100);

function add(a, isNew) {
  let title = a.title;
  const src = a.sourceName;
  if (src && title.endsWith(' - ' + src)) title = title.slice(0, -(src.length + 3)); // Google-Suffix
  const domain = host(a.sourceUrl) || a.domain || host(a.url);
  const ts = a.ts && a.ts <= now + 3600000 ? a.ts : (isNew ? now : null);
  if (!ts || ts < cutoff || !domain) return;
  const key = normTitle(title);
  if (!key) return;
  const prev = byKey.get(key);
  if (prev) {
    // Direkt-Link (Feed) vor Google-Weiterleitung bevorzugen, frühesten Zeitpunkt behalten
    if (/news\.google\.com/.test(prev.u) && !/news\.google\.com/.test(a.url)) prev.u = a.url;
    if (!prev.x && a.summary) prev.x = a.summary;
    prev.ts = Math.min(prev.ts, ts);
    return;
  }
  byKey.set(key, { t: title, u: a.url, d: domain, s: src || domain, l: a.lang || '', ts, x: a.summary || '' });
}

if (PREV && existsSync(PREV)) {
  try {
    const prev = JSON.parse(readFileSync(PREV, 'utf8'));
    for (const p of prev.items || []) add({ title: p.t, url: p.u, domain: p.d, sourceName: p.s, lang: p.l, ts: p.ts, summary: p.x }, false);
    console.log(`Vorherige Sammlung: ${prev.items?.length || 0} Artikel übernommen`);
  } catch (e) {
    console.log('Vorherige Sammlung nicht lesbar:', e.message);
  }
}

const report = [];
for (const r of results) {
  if (r.error) { report.push(`✗ ${r.job.label}: ${r.error}`); continue; }
  report.push(`✓ ${r.job.label}: ${r.items.length}`);
  for (const a of r.items) add(a, true);
}

const items = [...byKey.values()].sort((a, b) => b.ts - a.ts).slice(0, MAX_ITEMS);
const ok = results.filter(r => !r.error).length;
writeFileSync(OUT, JSON.stringify({
  generatedAt: new Date(now).toISOString(),
  sourcesOk: ok,
  sourcesTotal: results.length,
  items
}));

console.log(report.sort().join('\n'));
console.log(`\n${ok}/${results.length} Abrufe erfolgreich, ${items.length} Artikel gespeichert, ${((Date.now() - started) / 1000).toFixed(1)} s`);
if (ok === 0) { console.error('Keine einzige Quelle erreichbar.'); process.exit(1); }
