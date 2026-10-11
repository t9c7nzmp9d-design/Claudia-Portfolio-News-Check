// Tests für die Zuordnung von Schlagzeilen zu Positionen. Ausführen mit: npm test
import { test } from 'node:test';
import assert from 'node:assert/strict';

const { termMatchers, matchPositions, collapseSimilar, rankNews, defaultPoolUrl } = await import('../js/news.js');
const { splitTerms, excludedTerms } = await import('../js/assets.js');

const pos = (id, searchTerm, weight = 1) => ({ id, name: id, searchTerm, weight });
const match = (title, positions) => matchPositions(title, positions, new Map(positions.map(p => [p.id, termMatchers(p)])));

test('Suchbegriffe und Ausschlüsse zerlegen', () => {
  assert.deepEqual(splitTerms('Nikkei OR Topix -Nikkei Asia'), ['Nikkei', 'Topix']);
  assert.deepEqual(excludedTerms('Nikkei OR Topix -Nikkei Asia -Nikkei Business'), ['Nikkei Asia', 'Nikkei Business']);
  assert.deepEqual(splitTerms('Mercedes-Benz'), ['Mercedes-Benz']);
});

test('Ganze Wörter, Groß-/Kleinschreibung egal, Umlaute', () => {
  const ps = [pos('sap', 'SAP'), pos('gold', 'Goldpreis OR Gold price'), pos('sp', 'S&P 500')];
  assert.deepEqual(match('SAP hebt Prognose an', ps), ['sap']);
  assert.deepEqual(match('Sapporo meldet Rekord', ps), []);
  assert.deepEqual(match('Der Goldpreis steigt', ps), ['gold']);
  assert.deepEqual(match('Gold price hits record', ps), ['gold']);
  assert.deepEqual(match('S&P 500 closes higher', ps), ['sp']);
});

test('Ausschlussbegriffe verhindern Fehltreffer', () => {
  const ps = [pos('japan', 'Nikkei OR Topix -Nikkei Asia')];
  assert.deepEqual(match('Apple cuts iPhone orders, Nikkei Asia reports', ps), []);
  assert.deepEqual(match('Nikkei hits record high', ps), ['japan']);
  assert.deepEqual(match('Nikkei Asia: Nikkei climbs 2 %', ps), ['japan']);
});

test('Ähnliche Meldungen werden zusammengefasst', () => {
  const now = Date.now();
  const items = [
    { id: 1, title: 'Microsoft-Chef will „Notbremse“ bei Künstlicher Intelligenz', sourceName: 'Handelsblatt', ts: now, positionIds: ['ms'] },
    { id: 2, title: 'Business-Ticker: Microsoft-Chef will „Notbremse“ in Künstlicher Intelligenz', sourceName: 'FAZ', ts: now - 1e6, positionIds: ['ms'] },
    { id: 3, title: 'Microsoft übernimmt Start-up', sourceName: 'FAZ', ts: now, positionIds: ['ms'] }
  ];
  const out = collapseSimilar(items);
  assert.equal(out.length, 2);
  assert.deepEqual(out[0].also, ['FAZ']);
});

test('Sortierung: erst Zeitfenster, dann Gewichtung', () => {
  const day = 86400000;
  const now = new Date(); now.setHours(12, 0, 0, 0);
  const t = now.getTime();
  const map = new Map([['a', { weight: 1 }], ['b', { weight: 9 }]]);
  const items = [
    { id: 1, ts: t - day, positionIds: ['b'] },
    { id: 2, ts: t, positionIds: ['a'] },
    { id: 3, ts: t - 3600000, positionIds: ['b'] }
  ];
  assert.deepEqual(rankNews(items, map, 'day').map(i => i.id), [3, 2, 1]);
});

test('Adresse der News-Sammlung aus GitHub-Pages-Adresse', () => {
  assert.equal(defaultPoolUrl({ hostname: 'max.github.io', pathname: '/depot-news/' }),
    'https://raw.githubusercontent.com/max/depot-news/news-data/news.json');
});
