// Prüft Wertpapier-Suchdienste: liefern sie zu einer WKN Name/ISIN, und erlauben sie den Abruf aus dem Browser (CORS)?
const ORIGIN = 'https://t9c7nzmp9d-design.github.io';
const UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Safari/604.1';
const urls = [
  'https://api.onvista.de/api/v1/instruments/search/facet?searchValue=865985',
  'https://api.onvista.de/api/v1/instruments/query?searchValue=865985',
  'https://api.onvista.de/api/v1/main/search?searchValue=865985',
  'https://www.onvista.de/api/header/search?q=865985',
  'https://api.boerse-frankfurt.de/v1/global_search/limitedsearch/de?searching=865985',
  'https://www.ls-tc.de/_rpc/json/.lstc/instrument/search/main?q=865985&localeId=2',
  'https://www.tradegate.de/json/search.php?q=865985',
  'https://www.finanzen.net/suchergebnis.asp?_search=865985',
  'https://query2.finance.yahoo.com/v1/finance/search?q=US0378331005',
  'https://www.justetf.com/api/etfs/search?query=A0RPWH',
  'https://www.wikidata.org/w/api.php?action=query&list=search&srsearch=865985&format=json&origin=*',
  'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent('SELECT ?p WHERE { ?p wikibase:propertyType ?t . ?p rdfs:label ?l FILTER(LANG(?l)="de" && CONTAINS(LCASE(?l),"wertpapierkenn")) } LIMIT 5'),
  'https://query.wikidata.org/sparql?format=json&query=' + encodeURIComponent('SELECT ?p ?l WHERE { ?p a wikibase:Property ; rdfs:label ?l FILTER(LANG(?l)="en" && (CONTAINS(LCASE(?l),"wkn") || CONTAINS(LCASE(?l),"wertpapier"))) } LIMIT 5')
];
for (const url of urls) {
  try {
    const r = await fetch(url, { headers: { Origin: ORIGIN, 'User-Agent': UA, Accept: 'application/json, text/html;q=0.8, */*;q=0.5' }, signal: AbortSignal.timeout(15000) });
    const acao = r.headers.get('access-control-allow-origin');
    const body = (await r.text()).replace(/\s+/g, ' ').slice(0, 260);
    console.log(`${acao ? 'CORS ✓' : 'CORS ✗'} HTTP ${r.status} ${acao || '-'} ${url}\n      ${body}`);
  } catch (e) {
    console.log(`FEHLER ${e.message} ${url}`);
  }
}
