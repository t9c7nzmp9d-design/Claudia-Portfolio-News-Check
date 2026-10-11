// Einmalige Prüfung: Welche News-Schnittstelle nutzt die onvista-Seite intern?
const H = { Origin: 'https://t9c7nzmp9d-design.github.io', 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1' };
const html = await (await fetch('https://www.onvista.de/news/aktien/SAP-News-DE0007164600', { headers: H })).text();
const nd = html.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
if (nd) {
  const j = JSON.parse(nd[1]);
  const walk = (o, p = '', d = 0) => {
    if (!o || typeof o !== 'object' || d > 6) return;
    for (const [k, v] of Object.entries(o)) {
      if (/news/i.test(k) && d < 6) console.log(`NEXT ${p}${k}: ${JSON.stringify(v).slice(0, 400)}`);
      walk(v, `${p}${k}.`, d + 1);
    }
  };
  walk(j.props?.pageProps || j);
}
const apis = [...new Set(html.match(/https?:\/\/api\.onvista\.de\/api\/v1\/[A-Za-z0-9_\-\/{}.:?=&%]+/g) || [])];
console.log('API-Adressen im HTML:', apis.slice(0, 30));
const chunks = [...new Set(html.match(/\/_next\/static\/chunks\/[A-Za-z0-9_\-\/.]+\.js/g) || [])];
const found = new Set();
for (const c of chunks.slice(0, 60)) {
  try {
    const js = await (await fetch('https://www.onvista.de' + c, { headers: H })).text();
    for (const m of js.matchAll(/["'`](\/?(?:api\/v1\/)?news[A-Za-z0-9_\-\/{}$.:?=&]*)["'`]/g)) found.add(m[1]);
    for (const m of js.matchAll(/["'`](\/api\/v1\/[A-Za-z0-9_\-\/{}$.:?=&]*news[A-Za-z0-9_\-\/{}$.:?=&]*)["'`]/gi)) found.add(m[1]);
  } catch {}
}
console.log('News-Pfade in Skripten:', [...found].slice(0, 60));
for (const path of ['/api/v1/news/latest', '/api/v1/news/byEntity/STOCK/82849', '/api/v1/news/entity/STOCK/82849', '/api/v1/stocks/82849/newsList', '/api/v1/news/list/STOCK/82849', '/api/v1/news/topic/STOCK/82849', '/api/v1/news/instrument/82849']) {
  const r = await fetch('https://api.onvista.de' + path + '?limit=3', { headers: H });
  console.log(r.status, r.headers.get('access-control-allow-origin'), path, (await r.text()).slice(0, 160));
}
