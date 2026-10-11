// Tests für die Positionssuche (Antworten von onvista, wie am 11.10.2026 abgerufen).
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { candidateFromOnvista, lookupSecurity } = await import('../js/lookup.js');

const APPLE = { type: 'Instrument', entityType: 'STOCK', name: 'Apple', isin: 'US0378331005', wkn: '865985', symbol: 'APC', homeSymbol: 'AAPL', displayType: 'Aktie', urls: { WEBSITE: 'https://www.onvista.de/aktien/Apple-Aktie-US0378331005' } };
const MSCI = { type: 'Instrument', entityType: 'FUND', entitySubType: 'ETF', name: 'iShares Core MSCI World UCITS ETF USD Acc.', isin: 'IE00B4L5Y983', wkn: 'A0RPWH', symbol: 'EUNL', displayType: 'ETF' };
const BTC = { type: 'Instrument', entityType: 'CRYPTO', name: 'Bitcoin (BTC) Kurs in US Dollar', isin: 'XC000A2YY636', wkn: 'A2YY63', symbol: '', displayType: 'Kryptowährung' };
const GOLD = { type: 'Instrument', entityType: 'PRECIOUS_METAL', entitySubType: 'COMMODITY', name: 'Goldpreis', isin: 'XC0009655157', wkn: '965515', symbol: 'XAU', displayType: 'Rohstoff' };
const XGLD = { type: 'Instrument', entityType: 'DERIVATIVE', entitySubType: 'ETC_ETN_CERTIFICATE', name: 'Xetra Gold ETC', isin: 'DE000A0S9GB0', wkn: 'A0S9GB', symbol: '4GLD', displayType: 'ETC-/ETN-Zertifikat' };

test('onvista-Treffer werden korrekt übernommen', () => {
  const a = candidateFromOnvista(APPLE);
  assert.deepEqual([a.name, a.isin, a.wkn, a.symbol, a.type], ['Apple', 'US0378331005', '865985', 'APC', 'Aktie']);
  assert.equal(candidateFromOnvista(MSCI).type, 'ETF');
  assert.equal(candidateFromOnvista(BTC).type, 'Krypto');
  assert.equal(candidateFromOnvista(GOLD).type, 'Rohstoff');
  assert.equal(candidateFromOnvista(XGLD).type, 'ETC');
});

test('Suche per ausländischer WKN (865985 → Apple) über onvista', async () => {
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(String(url));
    return { ok: true, status: 200, json: async () => ({ list: [APPLE] }) };
  };
  const { candidates } = await lookupSecurity('865985');
  assert.equal(candidates.length, 1);
  assert.equal(candidates[0].isin, 'US0378331005');
  assert.equal(candidates[0].searchTerm, 'Apple');
  assert.match(calls[0], /api\.onvista\.de\/api\/v1\/instruments\/query\?searchValue=865985/);
});

test('ETF per WKN: Suchbegriff ist der Index', async () => {
  globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({ list: [MSCI] }) });
  const { candidates } = await lookupSecurity('A0RPWH');
  assert.equal(candidates[0].searchTerm, 'MSCI World');
  assert.equal(candidates[0].wkn, 'A0RPWH');
});

test('onvista nicht erreichbar → deutsche WKN über Wikidata', async () => {
  globalThis.fetch = async url => {
    if (String(url).includes('onvista')) throw new TypeError('Load failed');
    assert.match(decodeURIComponent(String(url)), /"DE0007164600"/);
    return { ok: true, status: 200, json: async () => ({ results: { bindings: [{ item: { value: 'Q1' }, itemLabel: { value: 'SAP' }, isin: { value: 'DE0007164600' } }] } }) };
  };
  const { candidates, errors } = await lookupSecurity('716460');
  assert.equal(candidates[0].name, 'SAP');
  assert.equal(candidates[0].wkn, '716460');
  assert.equal(errors.length, 1);
});

// Snapshot-Ausschnitte wie am 11.10.2026 von onvista geliefert
const snap = list => ({ quote: list[0], quoteList: { list } });
const q = (market, last, isoCurrency) => ({ market: { name: market }, last, isoCurrency, datetimeLast: '2026-10-09T20:00:00.000+00:00' });

test('Kurs: Euro an deutschem Handelsplatz wird bevorzugt', async () => {
  const { pickQuote } = await import('../js/lookup.js');
  const s = snap([q('Nasdaq', 336.64, 'USD'), q('Tradegate BSX', 300.5, 'EUR'), q('Xetra', 298.15, 'EUR'), q('gettex', 300.05, 'EUR')]);
  assert.deepEqual({ ...pickQuote(s), at: 0 }, { price: 298.15, currency: 'EUR', market: 'Xetra', at: 0 });
  assert.equal(pickQuote(snap([q('Spotpreis', 4194.145, 'USD')])).currency, 'USD'); // Gold nur in USD
  assert.equal(pickQuote({}), null);
});

test('Kurs: Suche per ISIN, dann passende Snapshot-Adresse je Typ', async () => {
  const { fetchQuote } = await import('../js/lookup.js');
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(String(url).replace('https://api.onvista.de/api/v1/', ''));
    if (String(url).includes('instruments/query')) return { ok: true, status: 200, json: async () => ({ list: [{ entityType: 'FUND', entitySubType: 'ETF', entityValue: '25096683', isin: 'IE00B4L5Y983', wkn: 'A0RPWH', name: 'iShares Core MSCI World' }] }) };
    return { ok: true, status: 200, json: async () => snap([q('Xetra', 131.64, 'EUR')]) };
  };
  const quote = await fetchQuote({ isin: 'IE00B4L5Y983', name: 'iShares Core MSCI World' });
  assert.equal(quote.price, 131.64);
  assert.deepEqual(calls, ['instruments/query?searchValue=IE00B4L5Y983', 'funds/ISIN:IE00B4L5Y983/snapshot']);
});

test('Kurs: Krypto in Euro (BTCUSD → BTCEUR)', async () => {
  const { fetchQuote } = await import('../js/lookup.js');
  const calls = [];
  globalThis.fetch = async url => {
    calls.push(String(url).replace('https://api.onvista.de/api/v1/', ''));
    if (String(url).includes('instruments/query')) return { ok: true, status: 200, json: async () => ({ list: [{ entityType: 'CRYPTO', entityValue: 'BTCUSD', isin: 'XC000A2YY636', name: 'Bitcoin (BTC) Kurs in US Dollar' }] }) };
    return { ok: true, status: 200, json: async () => snap([q('Bitfinex', 74298, 'EUR'), q('Bitfinex', 83152, 'USD')]) };
  };
  const quote = await fetchQuote({ name: 'Bitcoin', symbol: 'BTC_to_EUR', type: 'Krypto' });
  assert.equal(quote.price, 74298);
  assert.equal(quote.currency, 'EUR');
  assert.equal(calls[1], 'crypto/BTCEUR/snapshot');
});
