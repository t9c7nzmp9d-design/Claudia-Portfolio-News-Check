// Einmalige Prüfung: onvista-News-Finder – Parameter ermitteln und News je Wertpapier abrufen.
const H = { Origin: 'https://t9c7nzmp9d-design.github.io', 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1', Accept: 'application/json' };
const get = async (path, n = 900) => {
  const r = await fetch('https://api.onvista.de' + path, { headers: H });
  const t = await r.text();
  console.log(`${r.status} CORS=${r.headers.get('access-control-allow-origin')} ${path}\n   ${t.replace(/\s+/g, ' ').slice(0, n)}`);
  try { return JSON.parse(t); } catch { return null; }
};
const cfg = await get('/api/v1/articles/finder/configuration_query?application=WEBSITE', 0);
for (const g of cfg?.finderConfiguration?.groups || []) {
  console.log(`GRUPPE ${g.type} ${g.category} „${g.label}“: ${[...new Set((g.items || []).map(i => i.parameterName))].join(',')} | Beispiele: ${(g.items || []).slice(0, 4).map(i => i.label + '=' + i.parameterValue).join(' ; ')}`);
}
console.log('defaultParameters', JSON.stringify(cfg?.finderConfiguration?.defaultParameters), 'Schlüssel', Object.keys(cfg?.finderConfiguration || {}));
for (const p of [
  '/api/v1/articles/finder?timestampPublication=2026-09-11;',
  '/api/v1/articles/finder/query?timestampPublication=2026-09-11;',
  '/api/v1/articles/query?timestampPublication=2026-09-11;',
  '/api/v1/articles/finder?idInstrument=82849',
  '/api/v1/articles/finder?entityValue=82849',
  '/api/v1/articles/finder?isin=DE0007164600',
  '/api/v1/articles/finder?searchValue=SAP',
  '/api/v1/articles/finder?idInstrument=82849&timestampPublication=2026-09-11;',
  '/api/v1/articles/query?idInstrument=82849'
]) await get(p, 600);
