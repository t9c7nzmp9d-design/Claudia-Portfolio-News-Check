// Einmalige Prüfung: Welche Feeds erlauben den direkten Abruf aus dem Browser (CORS)?
// Aufruf: node scripts/check-cors.mjs
import { readFileSync } from 'node:fs';
const cfg = JSON.parse(readFileSync(new URL('../news/feeds.json', import.meta.url), 'utf8'));
const extra = [
  'https://news.google.com/rss/search?q=SAP&hl=de&gl=DE&ceid=DE:de',
  'https://www.bing.com/news/search?q=SAP&format=rss',
  'https://api.gdeltproject.org/api/v2/doc/doc?query=SAP&mode=artlist&format=json&maxrecords=5',
  'https://www.finanzen.net/rss/news',
  'https://www.onvista.de/news/feed/rss.xml',
  'https://www.boerse-frankfurt.de/rss/news',
  'https://www.reddit.com/r/stocks/.rss',
  'https://hn.algolia.com/api/v1/search?query=SAP',
  'https://query.wikidata.org/sparql?query=ASK%7B%7D&format=json',
  'https://api.openfigi.com/v3/mapping'
];
const urls = [...cfg.feeds.map(f => f.url), ...extra];
for (const url of urls) {
  try {
    const r = await fetch(url, { headers: { Origin: 'https://t9c7nzmp9d-design.github.io', 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1' }, signal: AbortSignal.timeout(15000) });
    const acao = r.headers.get('access-control-allow-origin');
    console.log(`${acao ? 'CORS ✓' : 'CORS ✗'}  HTTP ${r.status}  ${acao || '-'}  ${url}`);
  } catch (e) {
    console.log(`FEHLER  ${e.message}  ${url}`);
  }
}
