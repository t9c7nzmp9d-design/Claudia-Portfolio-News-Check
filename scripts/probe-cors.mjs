// Temporär: prüft, welche News-Endpunkte direkten Browserzugriff (CORS) erlauben.
const urls = process.argv.slice(2);
for (const u of urls) {
  try {
    const r = await fetch(u, { headers: { Origin: 'https://t9c7nzmp9d-design.github.io', 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1' }, signal: AbortSignal.timeout(15000) });
    const t = await r.text();
    console.log(`${r.status} ACAO=${r.headers.get('access-control-allow-origin')} type=${r.headers.get('content-type')} len=${t.length} ${u}`);
    console.log('   ', t.slice(0, 400).replace(/\s+/g, ' '));
  } catch (e) { console.log(`ERR ${e.message} ${u}`); }
}
