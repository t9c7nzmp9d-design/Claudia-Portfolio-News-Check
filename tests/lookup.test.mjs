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
