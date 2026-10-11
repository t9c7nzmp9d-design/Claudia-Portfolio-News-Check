// Minimaler, eingeschränkter CORS-Proxy für Depot-News (optional).
//
// Wozu? Browser dürfen RSS-Feeds (z. B. Google News, tagesschau.de) wegen CORS meist nicht direkt
// abrufen. Dieser Worker holt den Feed und gibt ihn mit CORS-Header an die App weiter.
//
// Einrichtung (kostenlos, ca. 5 Minuten): siehe README → „Optional: eigener CORS-Proxy“.
// In der App unter Mehr → CORS-Proxy eintragen:  https://<name>.<konto>.workers.dev/?url={url}
//
// Sicherheit: Nur GET, nur erlaubte Ziel-Hosts, nur deine App-Herkunft (ALLOWED_ORIGIN).
// Der Worker speichert nichts. Es werden nur Suchbegriffe/Feed-Adressen weitergeleitet.

const ALLOWED_ORIGIN = 'https://t9c7nzmp9d-design.github.io'; // ggf. anpassen
const ALLOWED_HOSTS = [
  'news.google.com',
  'www.tagesschau.de',
  // eigene Feed-Hosts hier ergänzen, z. B. 'www.handelsblatt.com'
];

export default {
  async fetch(request) {
    const origin = request.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN,
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Vary': 'Origin'
    };
    if (request.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (request.method !== 'GET') return new Response('Nur GET erlaubt', { status: 405, headers: cors });
    if (origin && origin !== ALLOWED_ORIGIN) return new Response('Herkunft nicht erlaubt', { status: 403, headers: cors });

    const target = new URL(request.url).searchParams.get('url');
    let url;
    try { url = new URL(target); } catch { return new Response('Parameter url fehlt', { status: 400, headers: cors }); }
    if (url.protocol !== 'https:' || !ALLOWED_HOSTS.includes(url.hostname)) {
      return new Response('Ziel nicht erlaubt', { status: 403, headers: cors });
    }
    const upstream = await fetch(url.toString(), {
      headers: { 'User-Agent': 'Mozilla/5.0 (DepotNews private RSS reader)', 'Accept': 'application/rss+xml, application/xml, text/xml, */*' },
      cf: { cacheTtl: 300, cacheEverything: true }
    });
    const body = await upstream.text();
    return new Response(body, {
      status: upstream.status,
      headers: { ...cors, 'Content-Type': upstream.headers.get('Content-Type') || 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=300' }
    });
  }
};
