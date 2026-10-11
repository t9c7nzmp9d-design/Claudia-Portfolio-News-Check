// Einmalige Prüfung: Wo liefert onvista aktuelle Kurse (aus dem Browser abrufbar)?
const H = { Origin: 'https://t9c7nzmp9d-design.github.io', 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1', Accept: 'application/json' };
const get = async path => {
  const r = await fetch('https://api.onvista.de' + path, { headers: H });
  const t = await r.text();
  let j = null; try { j = JSON.parse(t); } catch {}
  const q = j?.quote ? JSON.stringify(j.quote).slice(0, 500) : t.replace(/\s+/g, ' ').slice(0, 200);
  const ql = j?.quoteList?.list ? ' | quoteList: ' + j.quoteList.list.slice(0, 6).map(x => `${x.market?.name}:${x.last} ${x.isoCurrency}`).join(', ') : '';
  console.log(`${r.status} CORS=${r.headers.get('access-control-allow-origin')} ${path}\n   ${q}${ql}`);
};
const search = async q => (await (await fetch('https://api.onvista.de/api/v1/instruments/query?searchValue=' + q, { headers: H })).json()).list?.[0];
for (const q of ['US0378331005', 'IE00B4L5Y983', 'XC000A2YY636', 'XC0009655157', 'DE000A0S9GB0']) {
  const it = await search(q);
  console.log(`=== ${q}: ${it?.entityType}/${it?.entitySubType} entityValue=${it?.entityValue} keys=${Object.keys(it || {}).join(',')}`);
}
for (const p of [
  '/api/v1/stocks/ISIN:US0378331005/snapshot',
  '/api/v1/funds/ISIN:IE00B4L5Y983/snapshot',
  '/api/v1/cryptos/ISIN:XC000A2YY636/snapshot',
  '/api/v1/cryptocurrencies/ISIN:XC000A2YY636/snapshot',
  '/api/v1/crypto/BTCEUR/snapshot',
  '/api/v1/precious_metals/ISIN:XC0009655157/snapshot',
  '/api/v1/preciousMetals/ISIN:XC0009655157/snapshot',
  '/api/v1/commodities/ISIN:XC0009655157/snapshot',
  '/api/v1/derivatives/ISIN:DE000A0S9GB0/snapshot',
  '/api/v1/instruments/STOCK/86627/simple_chart_history?chartType=PRICE&withEarnings=false',
  '/api/v1/quotes/STOCK/86627',
  '/api/v1/instruments/query?searchValue=US0378331005&withQuote=true'
]) await get(p);
