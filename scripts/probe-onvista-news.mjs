// Einmalige Prüfung der onvista-„articles“-Schnittstelle (News je Wertpapier, aus dem Browser abrufbar?)
const H = { Origin: 'https://t9c7nzmp9d-design.github.io', 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1', Accept: 'application/json' };
const get = async path => {
  const r = await fetch('https://api.onvista.de' + path, { headers: H });
  const t = await r.text();
  console.log(`${r.status} CORS=${r.headers.get('access-control-allow-origin')} ${path}\n   ${t.replace(/\s+/g, ' ').slice(0, 700)}`);
  return r.ok ? JSON.parse(t) : null;
};
await get('/api/v1/articles/finder/configuration_query?application=WEBSITE');
for (const p of [
  '/api/v1/articles/query?entityType=STOCK&entityValue=82849&limit=5',
  '/api/v1/articles/query?entityValue=82849&limit=5',
  '/api/v1/articles/query?isin=DE0007164600&limit=5',
  '/api/v1/articles/finder/query?entityType=STOCK&entityValue=82849&limit=5',
  '/api/v1/articles/finder/query?instrument=STOCK:82849&limit=5',
  '/api/v1/articles/finder?entityType=STOCK&entityValue=82849&limit=5',
  '/api/v1/articles/list?entityType=STOCK&entityValue=82849&limit=5',
  '/api/v1/articles/instrument/STOCK/82849?limit=5',
  '/api/v1/articles/STOCK/82849?limit=5',
  '/api/v1/articles/latest?limit=5',
  '/api/v1/stocks/82849/articles?limit=5',
  '/api/v1/stocks/ISIN:DE0007164600/articles?limit=5'
]) await get(p);
