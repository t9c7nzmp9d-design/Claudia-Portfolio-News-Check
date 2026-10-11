// Kleine Helfer ohne Abhängigkeiten.

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

export function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

export const sleep = ms => new Promise(r => setTimeout(r, ms));

/**
 * Wandelt Zahlen in vielen Schreibweisen um:
 * 1234.56 · "1.234,56" · "1,234.56" · "12,5 %" · "€ 610,43" · "(12,00)" · "-"
 * Gibt null zurück, wenn keine Zahl erkennbar ist.
 */
export function parseNumber(v, decimalComma = false) {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  s = s.replace(/[€$£¥%\s  ']|EUR|USD|CHF|GBP|Stk\.?|St\./gi, '');
  if (s.startsWith('-') || s.startsWith('−')) { neg = !neg; s = s.slice(1); }
  if (s.endsWith('-')) { neg = !neg; s = s.slice(0, -1); }
  if (!/^[\d.,]+$/.test(s) || !/\d/.test(s)) return null;
  const lastComma = s.lastIndexOf(',');
  const lastDot = s.lastIndexOf('.');
  if (lastComma > -1 && lastDot > -1) {
    // Das zuletzt stehende Trennzeichen ist das Dezimaltrennzeichen.
    if (lastComma > lastDot) s = s.replace(/\./g, '').replace(',', '.');
    else s = s.replace(/,/g, '');
  } else if (lastComma > -1) {
    // "1,234,567" → Tausendertrennung; "12,5" bzw. "1,234" → deutsches Dezimalkomma
    const parts = s.split(',');
    s = parts.length > 2 ? parts.join('') : s.replace(',', '.');
  } else if (lastDot > -1) {
    const parts = s.split('.');
    // "1.234.567" → Tausender; "12.500" in einer Spalte mit deutschem Format ebenfalls
    if (parts.length > 2 || (decimalComma && parts[parts.length - 1].length === 3)) s = parts.join('');
  }
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return neg ? -n : n;
}

const nfCache = {};
export function fmtNumber(n, digits = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  const k = 'n' + digits;
  nfCache[k] ??= new Intl.NumberFormat('de-DE', { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return nfCache[k].format(n);
}

export function fmtMoney(n, currency = 'EUR') {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  try {
    return new Intl.NumberFormat('de-DE', { style: 'currency', currency: currency || 'EUR' }).format(n);
  } catch {
    return fmtNumber(n) + ' ' + (currency || '');
  }
}

export function fmtPercent(n, digits = 2) {
  if (n === null || n === undefined || !Number.isFinite(n)) return '–';
  return fmtNumber(n, digits) + ' %';
}

export function timeAgo(ts) {
  const diff = (Date.now() - ts) / 1000;
  if (diff < 60) return 'gerade eben';
  if (diff < 3600) return `vor ${Math.floor(diff / 60)} Min.`;
  if (diff < 86400) return `vor ${Math.floor(diff / 3600)} Std.`;
  if (diff < 7 * 86400) {
    const d = Math.floor(diff / 86400);
    return d === 1 ? 'vor 1 Tag' : `vor ${d} Tagen`;
  }
  return new Date(ts).toLocaleDateString('de-DE');
}

export function fmtDateTime(ts) {
  if (!ts) return '–';
  return new Date(ts).toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' });
}

/** Normalisiert Text für Vergleiche: klein, ohne Umlaute/Akzente, nur a-z0-9 und Leerzeichen. */
export function norm(s) {
  return String(s ?? '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9%€&]+/g, ' ')
    .trim();
}

export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function hostOf(url) {
  try { return new URL(url).hostname.replace(/^www\./, '').toLowerCase(); }
  catch { return ''; }
}

/** Prüft, ob host zur Domain gehört (exakt oder Subdomain). */
export function hostMatches(host, domain) {
  host = (host || '').toLowerCase().replace(/^www\./, '');
  domain = (domain || '').toLowerCase().replace(/^www\./, '');
  return !!domain && (host === domain || host.endsWith('.' + domain));
}

export function downloadBlob(blob, filename) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
}

export function todayStamp() {
  const d = new Date();
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}`;
}
