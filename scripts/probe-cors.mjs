// Temporär: prüft, ob der onvista-Snapshot News enthält.
for (const u of process.argv.slice(2)) {
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(15000) });
    const j = await r.json();
    console.log(r.status, r.headers.get('access-control-allow-origin'), u, 'keys:', Object.keys(j).join(','));
    const walk = (o, path) => {
      if (!o || typeof o !== 'object') return;
      for (const [k, v] of Object.entries(o)) {
        const p = path + '.' + k;
        if (/news|article|headline/i.test(k)) console.log('  ', p, JSON.stringify(v).slice(0, 700));
        else if (typeof v === 'object') walk(v, p);
      }
    };
    walk(j, '');
  } catch (e) { console.log('ERR', e.message, u); }
}
