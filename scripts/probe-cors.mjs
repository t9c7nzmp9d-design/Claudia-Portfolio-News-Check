// Temporär: prüft, welche Dividenden-Daten direkt (CORS) abrufbar sind.
const RX = /divid|aussch|distribut|payout|exdate|ex_date|exDate|payment|ertrag|yield|rendite/i;
for (const u of process.argv.slice(2)) {
  try {
    const r = await fetch(u, { headers: { Origin: 'https://t9c7nzmp9d-design.github.io' }, signal: AbortSignal.timeout(15000) });
    const t = await r.text();
    console.log(`\n### ${r.status} ACAO=${r.headers.get('access-control-allow-origin')} len=${t.length} ${u}`);
    let j; try { j = JSON.parse(t); } catch { console.log('  (kein JSON)', t.slice(0, 200).replace(/\s+/g, ' ')); continue; }
    if (j.instrument) console.log('  instrument:', j.instrument.entityType, j.instrument.entityValue, j.instrument.name);
    const seen = new Set();
    const walk = (o, path, depth) => {
      if (!o || typeof o !== 'object' || depth > 7) return;
      for (const [k, v] of Object.entries(o)) {
        const p = path + '.' + k;
        if (RX.test(k) && !seen.has(p.replace(/\.\d+/g, '[]'))) {
          seen.add(p.replace(/\.\d+/g, '[]'));
          console.log('  ', p, '=', JSON.stringify(v).slice(0, 700));
        } else if (typeof v === 'object') walk(v, p, depth + 1);
      }
    };
    walk(j, '', 0);
    if (!seen.size) console.log('  Inhalt:', t.slice(0, 600).replace(/\s+/g, ' '));
  } catch (e) { console.log('ERR', e.message, u); }
}
