// Einmalige Prüfung: Liefert onvista News je Wertpapier, abrufbar aus dem Browser?
const H = { Origin: 'https://t9c7nzmp9d-design.github.io', 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1', Accept: 'application/json' };
const urls = [
  'https://api.onvista.de/api/v1/stocks/ISIN:DE0007164600/snapshot',
  'https://api.onvista.de/api/v1/news/list?entityType=STOCK&entityValue=82849&limit=5',
  'https://api.onvista.de/api/v1/instruments/STOCK/82849/news?limit=5',
  'https://api.onvista.de/api/v1/stocks/82849/news?limit=5',
  'https://api.onvista.de/api/v1/news/STOCK/82849?limit=5',
  'https://api.onvista.de/api/v1/news/instrument/STOCK/82849?limit=5',
  'https://api.onvista.de/api/v1/news/stock/82849?limit=5',
  'https://api.onvista.de/api/v1/news?entityType=STOCK&entityValue=82849&limit=5',
  'https://api.onvista.de/api/v1/news/latest?limit=5',
  'https://api.onvista.de/api/v1/news/list?limit=5',
  'https://api.onvista.de/api/v1/funds/ISIN:IE00B4L5Y983/snapshot',
  'https://api.onvista.de/api/v1/cryptos/BTCEUR/snapshot',
  'https://www.onvista.de/news/aktien/SAP-News-DE0007164600'
];
for (const url of urls) {
  try {
    const r = await fetch(url, { headers: H, signal: AbortSignal.timeout(15000) });
    const t = await r.text();
    let info = t.replace(/\s+/g, ' ').slice(0, 220);
    try {
      const j = JSON.parse(t);
      const keys = Object.keys(j);
      info = 'Schlüssel: ' + keys.join(',');
      const findNews = (o, path = '', depth = 0) => {
        if (!o || typeof o !== 'object' || depth > 4) return;
        for (const [k, v] of Object.entries(o)) {
          if (/news/i.test(k)) console.log(`   ↳ ${path}${k}: ${JSON.stringify(v).slice(0, 500)}`);
          findNews(v, `${path}${k}.`, depth + 1);
        }
      };
      findNews(j);
    } catch {}
    console.log(`${r.headers.get('access-control-allow-origin') ? 'CORS ✓' : 'CORS ✗'} ${r.status} ${url}\n   ${info}`);
  } catch (e) { console.log(`FEHLER ${e.message} ${url}`); }
}
