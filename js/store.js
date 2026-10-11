// Lokale Datenhaltung: Zustand in localStorage, Verzeichnis-/Datei-Handles in IndexedDB.
// Es werden keine Daten an einen Server der App übertragen.

import { DEFAULT_SOURCES } from './sources.js';
import { uid } from './util.js';

const KEY = 'pnc-state-v1';
export const SCHEMA_VERSION = 4;

export function defaultSettings() {
  return {
    languages: ['de', 'en'],
    timespanDays: 7,
    bucket: 'day',            // Zeitfenster für Sortierung
    displayMode: 'percent',   // 'percent' | 'value'
    notify: false,
    notifyMinWeight: 2,       // Benachrichtigung nur ab dieser Gewichtung (%)
    minValue: 10,             // eingelesene Positionen unter diesem Wert (€) nicht übernehmen (0 = aus)
    watchMinWeight: 2,        // gezielte News-Suche (lokal) für Positionen ab dieser Gewichtung (%)
    autoRefreshMin: 30,       // automatische Aktualisierung bei geöffneter App (0 = aus)
    autoBackup: true,         // Sicherung in gewähltes Verzeichnis (sofern unterstützt)
    askOnStart: true          // beim Start nach neuer Depot-Datei fragen (ohne Verzeichniszugriff)
  };
}

export function defaultState() {
  return {
    schema: SCHEMA_VERSION,
    onboarded: false,
    portfolio: { name: 'Mein Depot', source: null, positions: [], updatedAt: null },
    sources: DEFAULT_SOURCES.map(s => ({ id: uid(), builtin: true, ...s })),
    settings: defaultSettings(),
    news: { items: [], fetchedAt: null, known: [], read: [], errors: [] },
    lastBackupAt: null
  };
}

export function loadState() {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return defaultState();
    return migrate(JSON.parse(raw));
  } catch {
    return defaultState();
  }
}

export function migrate(s) {
  const d = defaultState();
  const out = { ...d, ...s };
  out.settings = { ...d.settings, ...(s.settings || {}) };
  out.portfolio = { ...d.portfolio, ...(s.portfolio || {}) };
  out.news = { ...d.news, ...(s.news || {}) };
  if (!Array.isArray(out.sources) || !out.sources.length) out.sources = d.sources;
  // neue Standardquellen nachtragen (deaktiviert), ohne Nutzerauswahl zu überschreiben
  for (const def of DEFAULT_SOURCES) {
    if (!out.sources.some(x => x.domain === def.domain)) out.sources.push({ id: uid(), builtin: true, ...def, enabled: false });
  }
  // v4: Live-Suche (GDELT/Google/Proxys) entfällt – alte Einstellungen entfernen
  for (const k of ['provider', 'poolUrl', 'proxyUrl', 'publicProxy', 'maxPositions', 'useFeeds', 'batchSize', 'githubToken']) delete out.settings[k];
  delete out.watchSync;
  out.schema = SCHEMA_VERSION;
  return out;
}

let saveTimer = null;
export function saveState(state, immediate = false) {
  const write = () => {
    try {
      // Nachrichtenliste begrenzen, damit localStorage nicht überläuft
      state.news.items = state.news.items.slice(0, 600);
      state.news.known = state.news.known.slice(-3000);
      state.news.read = state.news.read.slice(-3000);
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch (e) {
      console.warn('Speichern fehlgeschlagen', e);
    }
  };
  clearTimeout(saveTimer);
  if (immediate) write(); else saveTimer = setTimeout(write, 250);
}

export function clearAll() {
  localStorage.removeItem(KEY);
  return idbDel('dir').catch(() => {}).then(() => idbDel('file').catch(() => {}));
}

// ---------- Sicherung ----------

export function buildBackup(state) {
  return {
    app: 'portfolio-news-check',
    schema: SCHEMA_VERSION,
    createdAt: new Date().toISOString(),
    portfolio: state.portfolio,
    sources: state.sources,
    settings: state.settings,
    news: { read: state.news.read }
  };
}

export function restoreBackup(state, data) {
  if (!data || data.app !== 'portfolio-news-check') throw new Error('Das ist keine Sicherungsdatei dieser App.');
  const merged = migrate({ ...state, portfolio: data.portfolio, sources: data.sources, settings: data.settings, onboarded: true });
  merged.news.read = data.news?.read || [];
  return merged;
}

// ---------- IndexedDB (für File-System-Access-Handles) ----------

function idb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('pnc', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}
export async function idbGet(k) {
  const db = await idb();
  return new Promise((res, rej) => {
    const r = db.transaction('kv').objectStore('kv').get(k);
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });
}
export async function idbSet(k, v) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').put(v, k);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
export async function idbDel(k) {
  const db = await idb();
  return new Promise((res, rej) => {
    const tx = db.transaction('kv', 'readwrite');
    tx.objectStore('kv').delete(k);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error);
  });
}
