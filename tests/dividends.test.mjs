// Tests für den Dividenden-Bereich. Ausführen mit: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { summarizeDividends, needsRefresh, fetchDividends, shortName, currencyFromSymbol, DivStopError } = await import('../js/dividends.js');
const NOW = Date.parse('2026-10-12T12:00:00Z');

test('Kennzahlen: nächste, letzte, 12 Monate, schüttet aus', () => {
  const s = summarizeDividends([
    { ex: '2026-11-05', pay: '2026-11-09', amount: 0.5 },
    { ex: '2026-08-05', pay: '2026-08-09', amount: 0.5 },
    { ex: '2026-05-05', pay: '', amount: 0.4 },
    { ex: '2025-05-05', pay: '', amount: 0.3 }
  ], NOW);
  assert.equal(s.next.ex, '2026-11-05');
  assert.equal(s.last.ex, '2026-08-05');
  assert.equal(s.ttmCount, 2);
  assert.ok(Math.abs(s.ttmSum - 0.9) < 1e-9);
  assert.equal(s.pays, true);
});

test('Ohne Ausschüttung seit über 15 Monaten → ausblenden', () => {
  assert.equal(summarizeDividends([{ ex: '2024-05-16', pay: '', amount: 2.2 }], NOW).pays, false);
  assert.equal(summarizeDividends([], NOW).pays, false);
});

test('Neu abrufen nur wenn nötig (7 Tage, Dienst oder Kürzel geändert)', () => {
  const c = { provider: 'fmp', symbol: 'SAP.DE', fetchedAt: NOW - 86400000, events: [{ ex: '2026-05-06', amount: 2.5 }] };
  assert.equal(needsRefresh(c, { provider: 'fmp' }, NOW), false);
  assert.equal(needsRefresh(c, { provider: 'av' }, NOW), true);
  assert.equal(needsRefresh(c, { provider: 'fmp', symbol: 'SAP' }, NOW), true);
  assert.equal(needsRefresh({ ...c, fetchedAt: NOW - 8 * 86400000 }, { provider: 'fmp' }, NOW), true);
  assert.equal(needsRefresh(null, { provider: 'fmp' }, NOW), true);
});

test('Namen für die Suche kürzen, Währung aus dem Kürzel', () => {
  assert.equal(shortName('SAP SE Inhaber-Aktien o.N.'), 'SAP');
  assert.equal(shortName('Apple Inc. Registered Shares DL -,00001'), 'Apple');
  assert.equal(shortName('Allianz SE vink.Namens-Aktien o.N.'), 'Allianz');
  assert.equal(shortName('Vanguard FTSE All-World UCITS ETF USD Dis.'), 'Vanguard FTSE All-World');
  assert.equal(currencyFromSymbol('SAP.DE'), 'EUR');
  assert.equal(currencyFromSymbol('AAPL'), 'USD');
});

test('FMP: Kürzel über ISIN, Dividenden mit Ex- und Zahltag; Schlüssel und ISIN in der Adresse, keine Werte', async () => {
  const urls = [];
  globalThis.fetch = async url => {
    urls.push(String(url));
    if (url.includes('search-isin')) return new Response(JSON.stringify([{ symbol: 'SAP', exchange: 'NYSE', currency: 'USD' }, { symbol: 'SAP.DE', exchange: 'XETRA', currency: 'EUR' }]));
    return new Response(JSON.stringify([
      { symbol: 'SAP.DE', date: '2026-05-06', paymentDate: '2026-05-08', dividend: 2.5 },
      { symbol: 'SAP.DE', date: '2025-05-14', paymentDate: '2025-05-16', dividend: 2.35 }
    ]));
  };
  const r = await fetchDividends({ name: 'SAP SE', isin: 'DE0007164600', value: 12345, quantity: 50 }, { provider: 'fmp', key: 'k1' });
  assert.equal(r.symbol, 'SAP.DE');
  assert.equal(r.currency, 'EUR');
  assert.deepEqual(r.events[0], { ex: '2026-05-06', pay: '2026-05-08', amount: 2.5 });
  assert.equal(urls.length, 2);
  for (const u of urls) assert.doesNotMatch(u, /12345|quantity|value=/);
  // Mit gespeichertem Kürzel wird nicht erneut gesucht
  urls.length = 0;
  await fetchDividends({ name: 'SAP SE', isin: 'DE0007164600' }, { provider: 'fmp', key: 'k1', cached: r });
  assert.equal(urls.length, 1);
});

test('FMP: ungültiger Schlüssel bzw. Tageslimit stoppen den Abruf', async () => {
  globalThis.fetch = async () => new Response(JSON.stringify({ 'Error Message': 'Invalid API KEY.' }), { status: 401 });
  await assert.rejects(fetchDividends({ name: 'SAP', isin: 'DE0007164600' }, { provider: 'fmp', key: 'x' }), DivStopError);
  globalThis.fetch = async () => new Response(JSON.stringify({ 'Error Message': 'Limit Reach . Please upgrade your plan' }), { status: 429 });
  await assert.rejects(fetchDividends({ name: 'SAP', divSymbol: 'SAP.DE' }, { provider: 'fmp', key: 'x' }), DivStopError);
});

test('Alpha Vantage: Suche über Namen, Dividenden mit Ex- und Zahltag', async () => {
  globalThis.fetch = async url => {
    if (String(url).includes('SYMBOL_SEARCH')) return new Response(JSON.stringify({ bestMatches: [{ '1. symbol': 'IBM', '2. name': 'International Business Machines', '4. region': 'United States', '8. currency': 'USD' }] }));
    return new Response(JSON.stringify({ symbol: 'IBM', data: [{ ex_dividend_date: '2026-08-10', payment_date: '2026-09-10', amount: '1.68' }, { ex_dividend_date: '2026-05-08', payment_date: 'None', amount: '1.68' }] }));
  };
  const r = await fetchDividends({ name: 'IBM Corp.' }, { provider: 'av', key: 'k' });
  assert.equal(r.symbol, 'IBM');
  assert.equal(r.currency, 'USD');
  assert.deepEqual(r.events, [{ ex: '2026-08-10', pay: '2026-09-10', amount: 1.68 }, { ex: '2026-05-08', pay: '', amount: 1.68 }]);
  globalThis.fetch = async () => new Response(JSON.stringify({ Information: 'We have detected your API key as XYZ and our standard API rate limit is 25 requests per day.' }));
  await assert.rejects(fetchDividends({ name: 'IBM', divSymbol: 'IBM' }, { provider: 'av', key: 'k' }), DivStopError);
});

test('Kürzel ableiten (onvista-Basiskürzel → Format des Dienstes)', async () => {
  const { deriveSymbols } = await import('../js/dividends.js');
  assert.deepEqual(deriveSymbols('av', 'SAP', 'DE0007164600'), ['SAP.DEX', 'SAP']);
  assert.deepEqual(deriveSymbols('fmp', 'SAP', 'DE0007164600'), ['SAP.DE', 'SAP']);
  assert.deepEqual(deriveSymbols('av', 'AAPL', 'US0378331005'), ['AAPL', 'AAPL.DEX']);
  assert.deepEqual(deriveSymbols('av', '', 'DE0007164600'), []);
});

test('Alpha Vantage: abgeleitetes Kürzel zuerst (ohne Suche), bei leeren Daten das nächste', async () => {
  const calls = [];
  globalThis.fetch = async url => {
    const u = new URL(String(url)); calls.push(u.searchParams.get('function') + ':' + (u.searchParams.get('symbol') || u.searchParams.get('keywords')));
    if (u.searchParams.get('symbol') === 'ALV.DEX') return new Response(JSON.stringify({ symbol: 'ALV.DEX', data: [] }));
    if (u.searchParams.get('symbol') === 'ALV') return new Response(JSON.stringify({ 'Error Message': 'Invalid API call.' }));
    if (u.searchParams.get('function') === 'SYMBOL_SEARCH') return new Response(JSON.stringify({ bestMatches: [{ '1. symbol': 'ALIZF', '8. currency': 'USD' }] }));
    return new Response(JSON.stringify({ symbol: 'ALIZF', data: [{ ex_dividend_date: '2026-05-08', payment_date: '2026-05-12', amount: '17.10' }] }));
  };
  const r = await fetchDividends({ name: 'Allianz SE', isin: 'DE0008404005', baseSymbol: 'ALV' }, { provider: 'av', key: 'k' });
  assert.equal(calls[0], 'DIVIDENDS:ALV.DEX');
  assert.equal(r.symbol, 'ALIZF');
  assert.equal(r.events[0].amount, 17.1);
  assert.ok(calls.length <= 4);
});

test('Ohne Daten beim Dienst: noData statt stillem Ausblenden', async () => {
  globalThis.fetch = async url => String(url).includes('SYMBOL_SEARCH')
    ? new Response(JSON.stringify({ bestMatches: [] }))
    : new Response(JSON.stringify({ data: [] }));
  const r = await fetchDividends({ name: 'iShares Core MSCI World', isin: 'IE00B4L5Y983', baseSymbol: 'EUNL' }, { provider: 'av', key: 'k' });
  assert.equal(r.noData, true);
  assert.deepEqual(r.tried, ['EUNL.DEX', 'EUNL']);
});

test('Dividenden-CSV (Format des Claude-Prompts) einlesen – ohne Schätzungen', async () => {
  const { parseDividendRows, manualEntry } = await import('../js/dividends.js');
  const { parseCsv } = await import('../js/parser.js');
  const { DIV_PROMPT_HEADER, buildDividendPrompt } = await import('../js/prompt.js');
  const csv = [DIV_PROMPT_HEADER,
    'DE0008404005;Allianz;2026-05-08;2026-05-12;17,10;EUR;gezahlt;https://www.allianz.com/de/investor_relations/aktie/dividende.html',
    'IE00B3RBWM25;Vanguard FTSE All-World;2026-06-18;2026-07-01;0,9055;USD;gezahlt;https://www.vanguard.co.uk/x',
    'IE00B3RBWM25;Vanguard FTSE All-World;2026-03-19;2026-04-01;0,4576;USD;gezahlt;https://www.vanguard.co.uk/x',
    'IE00B4L5Y983;iShares Core MSCI World;;;;;keine;thesaurierend',
    'DE0007164600;SAP;;;;EUR;vorgeschlagen;https://x'].join('\n');
  const { entries, skipped } = parseDividendRows(parseCsv(csv));
  assert.equal(entries.length, 4);
  assert.equal(skipped.length, 1); // SAP ohne Ex-Tag/Betrag → nicht übernommen, nicht geschätzt
  const alv = manualEntry(entries.filter(e => e.isin === 'DE0008404005'), NOW);
  assert.equal(alv.manual, true);
  assert.deepEqual(alv.events[0], { ex: '2026-05-08', pay: '2026-05-12', amount: 17.1, currency: 'EUR', status: 'gezahlt', source: 'https://www.allianz.com/de/investor_relations/aktie/dividende.html' });
  const vg = manualEntry(entries.filter(e => e.isin === 'IE00B3RBWM25'), NOW);
  assert.equal(vg.events.length, 2);
  assert.equal(vg.events[0].currency, 'USD');
  const ish = manualEntry(entries.filter(e => e.isin === 'IE00B4L5Y983'), NOW);
  assert.equal(ish.noData, true);
  assert.equal(ish.note, 'keine Ausschüttung');
  // Eigene Daten werden vom Dienst nicht überschrieben
  assert.equal(needsRefresh(alv, { provider: 'av' }, NOW + 30 * 86400000), false);
  // Prompt enthält Titel, Kopfzeile und das Schätzverbot
  const p = buildDividendPrompt([{ name: 'Allianz', isin: 'DE0008404005', type: 'Aktie' }]);
  assert.ok(p.includes('DE0008404005') && p.includes(DIV_PROMPT_HEADER) && /keine Schätzungen/.test(p));
});

test('Datumsformate: ISO und deutsch', async () => {
  const { parseDay } = await import('../js/dividends.js');
  assert.equal(parseDay('2026-05-08'), '2026-05-08');
  assert.equal(parseDay('8.5.2026'), '2026-05-08');
  assert.equal(parseDay('Mai 2026'), '');
});
