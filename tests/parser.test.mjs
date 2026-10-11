// Tests für Import & Erkennung. Ausführen mit: node --test tests/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

// SheetJS wie im Browser als globales Skript laden
const sandbox = { console, Uint8Array, ArrayBuffer, DataView, TextDecoder, TextEncoder, Date, Math };
sandbox.self = sandbox;
vm.runInNewContext(readFileSync(new URL('../vendor/xlsx.full.min.js', import.meta.url), 'utf8'), sandbox);
globalThis.window = { XLSX: sandbox.XLSX };

const { importFile, rowsToPositions, parseCsv } = await import('../js/parser.js');
const { isValidIsin, wknFromIsin, recognize } = await import('../js/assets.js');
const { parseNumber } = await import('../js/util.js');

const fakeFile = (path, name = path.split('/').pop()) => ({
  name,
  lastModified: 0,
  arrayBuffer: async () => { const b = readFileSync(new URL('../' + path, import.meta.url)); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); }
});

test('Zahlenformate', () => {
  assert.equal(parseNumber('1.234,56'), 1234.56);
  assert.equal(parseNumber('1,234.56'), 1234.56);
  assert.equal(parseNumber('12,5 %'), 12.5);
  assert.equal(parseNumber('€ 610,43'), 610.43);
  assert.equal(parseNumber('(12,00)'), -12);
  assert.equal(parseNumber('12.500', true), 12500);
  assert.equal(parseNumber('abc'), null);
  assert.equal(parseNumber(''), null);
});

test('ISIN-Prüfung & WKN', () => {
  assert.ok(isValidIsin('US0378331005'));
  assert.ok(isValidIsin('DE0007164600'));
  assert.ok(!isValidIsin('US0378331006'));
  assert.equal(wknFromIsin('DE0007164600'), '716460');
});

test('Musterdepot.xlsx wird erkannt', async () => {
  const res = await importFile(fakeFile('sample/Musterdepot.xlsx'));
  assert.equal(res.positions.length, 29);
  const apple = res.positions.find(p => p.isin === 'US0378331005');
  assert.equal(apple.name, 'Apple');
  assert.equal(apple.value, 610.43);
  assert.ok(Math.abs(apple.weight - 6.1043) < 1e-6);
  const btc = res.positions.find(p => p.name === 'Bitcoin');
  assert.equal(btc.type, 'Krypto');
  assert.equal(btc.symbol, 'BTC_to_EUR');
  assert.equal(res.positions.find(p => p.name === 'Gold (EUR)').type, 'Rohstoff');
  assert.equal(res.positions.find(p => p.isin === 'IE00B3YCGJ38').type, 'ETF');
  assert.equal(res.positions.find(p => p.isin === 'IE00B3YCGJ38').searchTerm, 'S&P 500');
  assert.equal(res.positions.find(p => p.isin === 'DE0008404005').wkn, '840400');
  assert.ok(!res.positions.some(p => /summe/i.test(p.name)));
});

test('CSV mit deutschem Format, Semikolon, anderer Spaltenreihenfolge und Vorspann', async () => {
  const res = await importFile(fakeFile('sample/Musterdepot_Bank-Export.csv'));
  assert.ok(res.positions.length >= 10, 'Positionen erkannt');
  const sap = res.positions.find(p => p.wkn === '716460');
  assert.ok(sap, 'SAP über WKN gefunden');
  assert.ok(sap.value > 1000);
  const sum = res.positions.reduce((a, p) => a + p.weight, 0);
  assert.ok(Math.abs(sum - 100) < 0.01);
});

test('Transponierte Tabelle (Felder in Zeilen)', () => {
  const rows = [
    ['Bezeichnung', 'Apple', 'SAP', 'Gold'],
    ['ISIN', 'US0378331005', 'DE0007164600', 'XC0009655157'],
    ['Anteil', '50 %', '30 %', '20 %']
  ];
  const res = rowsToPositions(rows);
  assert.equal(res.transposed, true);
  assert.equal(res.positions.length, 3);
  assert.equal(res.positions[1].weight, 30);
});

test('Tabelle ohne Kopfzeile', () => {
  const rows = parseCsv('US0378331005;Apple Inc.;1.200,00\nDE0007164600;SAP SE;800,00\n');
  const res = rowsToPositions(rows);
  assert.equal(res.positions.length, 2);
  assert.equal(res.positions[0].isin, 'US0378331005');
  assert.equal(res.positions[0].weight, 60);
});

test('ISIN im Namen', () => {
  const p = recognize({ name: 'Apple Inc. (US0378331005)' });
  assert.equal(p.isin, 'US0378331005');
});
