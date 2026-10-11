// Vorgeschlagene, anerkannte Nachrichtenquellen (Qualitätsmedien, Nachrichtenagenturen, Börsenmedien).
// enabled = standardmäßig aktiv. Nutzer können Quellen an- und abwählen sowie eigene ergänzen.
// rss = optionaler Feed (nur nutzbar mit CORS-Proxy, siehe README).

export const DEFAULT_SOURCES = [
  // Deutschsprachig
  { name: 'Handelsblatt', domain: 'handelsblatt.com', lang: 'de', enabled: true, category: 'Wirtschaftspresse' },
  { name: 'FAZ', domain: 'faz.net', lang: 'de', enabled: true, category: 'Qualitätszeitung' },
  { name: 'tagesschau.de', domain: 'tagesschau.de', lang: 'de', enabled: true, category: 'Öffentlich-rechtlich', rss: 'https://www.tagesschau.de/wirtschaft/index~rss2.xml' },
  { name: 'Börsen-Zeitung', domain: 'boersen-zeitung.de', lang: 'de', enabled: true, category: 'Wirtschaftspresse' },
  { name: 'WirtschaftsWoche', domain: 'wiwo.de', lang: 'de', enabled: true, category: 'Wirtschaftspresse' },
  { name: 'manager magazin', domain: 'manager-magazin.de', lang: 'de', enabled: true, category: 'Wirtschaftspresse' },
  { name: 'Süddeutsche Zeitung', domain: 'sueddeutsche.de', lang: 'de', enabled: true, category: 'Qualitätszeitung' },
  { name: 'DER SPIEGEL', domain: 'spiegel.de', lang: 'de', enabled: false, category: 'Nachrichtenmagazin' },
  { name: 'ZEIT ONLINE', domain: 'zeit.de', lang: 'de', enabled: false, category: 'Qualitätszeitung' },
  { name: 'n-tv', domain: 'n-tv.de', lang: 'de', enabled: false, category: 'Nachrichtensender' },
  { name: 'Börse Frankfurt', domain: 'boerse-frankfurt.de', lang: 'de', enabled: false, category: 'Börse' },
  { name: 'finanzen.net', domain: 'finanzen.net', lang: 'de', enabled: false, category: 'Finanzportal' },
  { name: 'onvista', domain: 'onvista.de', lang: 'de', enabled: false, category: 'Finanzportal' },
  { name: 'Der Standard', domain: 'derstandard.at', lang: 'de', enabled: false, category: 'Qualitätszeitung (AT)' },
  { name: 'NZZ', domain: 'nzz.ch', lang: 'de', enabled: false, category: 'Qualitätszeitung (CH)' },
  // Englischsprachig
  { name: 'Reuters', domain: 'reuters.com', lang: 'en', enabled: true, category: 'Nachrichtenagentur' },
  { name: 'Associated Press', domain: 'apnews.com', lang: 'en', enabled: true, category: 'Nachrichtenagentur' },
  { name: 'Bloomberg', domain: 'bloomberg.com', lang: 'en', enabled: true, category: 'Wirtschaftspresse' },
  { name: 'Financial Times', domain: 'ft.com', lang: 'en', enabled: true, category: 'Wirtschaftspresse' },
  { name: 'The Wall Street Journal', domain: 'wsj.com', lang: 'en', enabled: true, category: 'Wirtschaftspresse' },
  { name: 'CNBC', domain: 'cnbc.com', lang: 'en', enabled: true, category: 'Wirtschaftssender' },
  { name: 'MarketWatch', domain: 'marketwatch.com', lang: 'en', enabled: true, category: 'Börse' },
  { name: 'The Economist', domain: 'economist.com', lang: 'en', enabled: false, category: 'Wirtschaftsmagazin' },
  { name: "Barron's", domain: 'barrons.com', lang: 'en', enabled: false, category: 'Börse' },
  { name: 'Nikkei Asia', domain: 'asia.nikkei.com', lang: 'en', enabled: false, category: 'Wirtschaftspresse (Asien)' },
  { name: 'BBC', domain: 'bbc.com', lang: 'en', enabled: false, category: 'Öffentlich-rechtlich' },
  { name: 'Yahoo Finance', domain: 'finance.yahoo.com', lang: 'en', enabled: false, category: 'Finanzportal' },
  { name: 'CoinDesk', domain: 'coindesk.com', lang: 'en', enabled: false, category: 'Krypto-Fachmedium' }
];

export function normalizeDomain(input) {
  let s = String(input || '').trim().toLowerCase();
  if (!s) return '';
  if (!/^https?:\/\//.test(s)) s = 'https://' + s;
  try { return new URL(s).hostname.replace(/^www\./, ''); } catch { return ''; }
}
