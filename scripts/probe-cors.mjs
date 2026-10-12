// Temporär: prüft DivvyDiary-Endpunkte (CORS und Inhalt).
for (const u of process.argv.slice(2)) {
  try {
    const r = await fetch(u, { headers: { Origin: 'https://t9c7nzmp9d-design.github.io', Accept: 'application/json' }, signal: AbortSignal.timeout(15000) });
    const t = await r.text();
    console.log(`\n### ${r.status} ACAO=${r.headers.get('access-control-allow-origin')} type=${r.headers.get('content-type')} len=${t.length} ${u}`);
    console.log('   ', t.slice(0, 1500).replace(/\s+/g, ' '));
  } catch (e) { console.log('ERR', e.message, u); }
}
// Preflight-Test (OPTIONS) wie ein Browser
try {
  const r = await fetch('https://api.divvydiary.com/symbols/DE0008404005', { method: 'OPTIONS', headers: { Origin: 'https://t9c7nzmp9d-design.github.io', 'Access-Control-Request-Method': 'GET' } });
  console.log('\nOPTIONS', r.status, [...r.headers].filter(([k]) => k.startsWith('access-control')).map(h => h.join('=')).join(' | '));
} catch (e) { console.log('OPTIONS ERR', e.message); }
