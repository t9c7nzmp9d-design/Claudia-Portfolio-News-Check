// Zeigt das Antwortformat der onvista-Suche (für die Positionssuche per WKN/ISIN/Name).
const ORIGIN = 'https://t9c7nzmp9d-design.github.io';
for (const q of ['865985', 'A0RPWH', 'SAP', 'Bitcoin', 'IE00B3YCGJ38', 'Gold']) {
  const r = await fetch(`https://api.onvista.de/api/v1/instruments/query?searchValue=${encodeURIComponent(q)}`, { headers: { Origin: ORIGIN } });
  const d = await r.json();
  console.log(`=== ${q}: HTTP ${r.status}, CORS ${r.headers.get('access-control-allow-origin')}, ${d.list?.length} Treffer`);
  for (const it of (d.list || []).slice(0, 3)) {
    const { entityAttributes, ...rest } = it;
    console.log(JSON.stringify(rest).slice(0, 700));
  }
}
