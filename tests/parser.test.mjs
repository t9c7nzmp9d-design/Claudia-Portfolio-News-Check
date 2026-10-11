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

// ---- Typische Bank-Exporte (Spaltentitel aus der Praxis) ----
const names = res => res.positions.map(p => p.name);

test('DKB-Stil: „Wertpapierbezeichnung“, „Bestand“, „Kurswert in EUR“', () => {
  const res = rowsToPositions(parseCsv(
    'Bestand;Einheit;Wertpapierbezeichnung;ISIN;WKN;Kurs;Kurswert in EUR\n' +
    '10;Stück;SAP SE;DE0007164600;716460;178,40;1.784,00\n' +
    '5;Stück;Allianz SE;DE0008404005;840400;342,80;1.714,00\n'));
  assert.equal(res.mapping.name, 2);
  assert.equal(res.mapping.quantity, 0);
  assert.equal(res.mapping.value, 6);
  assert.deepEqual(names(res), ['SAP SE', 'Allianz SE']);
  assert.equal(res.positions[0].value, 1784);
});

test('Sparkasse-Stil: „Gattung“ ist der Name, „Nominal/Stück“, „Kurswert“', () => {
  const res = rowsToPositions(parseCsv(
    'Gattung;WKN;Nominal/Stück;Akt. Kurs;Kurswert;Währung\n' +
    'Siemens AG Namens-Aktien;723610;8;231,15;1.849,20;EUR\n' +
    'iShares Core MSCI World;A0RPWH;60;98,40;5.904,00;EUR\n'));
  assert.equal(res.mapping.name, 0);
  assert.equal(res.mapping.currency, 5);
  assert.equal(res.mapping.price, 3);
  assert.deepEqual(names(res), ['Siemens AG Namens-Aktien', 'iShares Core MSCI World']);
  assert.equal(res.positions[1].type, 'ETF');
});

test('comdirect-Stil: Einstandswert wird nicht als Wert genommen, Diff. % nicht als Gewicht', () => {
  const res = rowsToPositions(parseCsv(
    'Stück/Nom.;Bezeichnung;WKN;Einstandswert;Aktuell;Diff. %;Wert in EUR\n' +
    '12;SAP SE;716460;1.500,00;178,40;+42,72 %;2.140,80\n' +
    '40;Infineon;623100;1.200,00;36,12;+20,40 %;1.444,80\n'));
  assert.equal(res.mapping.value, 6);
  assert.equal(res.mapping.weight, undefined);
  assert.equal(res.positions[0].value, 2140.8);
});

test('ING-Stil: „Wertpapiername“, „Stück / Nominale“, „Einstandskurs“ ist kein Kurs', () => {
  const res = rowsToPositions(parseCsv(
    'Wertpapiername;ISIN;Stück / Nominale;Einstandskurs;Kurs;Kurswert;Gewinn / Verlust\n' +
    'Apple Inc.;US0378331005;10;150,00;219,50;2.195,00;695,00\n'));
  assert.equal(res.mapping.name, 0);
  assert.equal(res.mapping.price, 4);
  assert.equal(res.mapping.value, 5);
});

test('Falsch beschriftete Spalte wird über den Inhalt korrigiert', () => {
  // „Name“ enthält hier nur Zahlen (z. B. Depotnummer) → darf nicht als Name dienen
  const res = rowsToPositions(parseCsv(
    'Name;Titel;Wert\n' +
    '4711;Apple Inc.;1.000,00\n' +
    '4711;SAP SE;500,00\n'));
  assert.equal(res.mapping.name, 1);
  assert.deepEqual(names(res), ['Apple Inc.', 'SAP SE']);
});

test('Manuelle Spaltenzuordnung überschreibt die Automatik', () => {
  const rows = parseCsv('A;B;C\nApple;US0378331005;100\nSAP;DE0007164600;300\n');
  const res = rowsToPositions(rows, { name: 0, isin: 1, value: 2 });
  assert.deepEqual(names(res), ['Apple', 'SAP']);
  assert.equal(res.positions[1].weight, 75);
  assert.ok(res.columns.length === 3 && res.columns[2].field === 'value');
});

test('Kopfzeile der Nutzerin (Tabulator-getrennt, Gewicht als Bruch)', () => {
  const res = rowsToPositions(parseCsv(
    'ISIN\tName\tWert (in €)\tGewicht (in %)\n' +
    'US0378331005\tApple\t610,43\t0,061043\n' +
    'BTC_to_EUR\tBitcoin\t322,74\t0,032274\n' +
    '\tSumme\t933,17\t0,093317\n'));
  assert.deepEqual(res.mapping, { isin: 0, name: 1, value: 2, weight: 3 });
  assert.deepEqual(names(res), ['Apple', 'Bitcoin']);
  assert.equal(res.positions[0].value, 610.43);
  assert.equal(res.positions[1].symbol, 'BTC_to_EUR');
});
