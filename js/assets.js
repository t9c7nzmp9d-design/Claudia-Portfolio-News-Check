// Erkennung von Wertpapieren/Assets: ISIN, WKN, Typ, Land und Suchbegriffe für News.

import { norm } from './util.js';

export const ISIN_RE = /\b([A-Z]{2}[A-Z0-9]{9}[0-9])\b/;
export const WKN_RE = /^[A-HJ-NP-Z0-9]{6}$/;

/** Prüft die ISIN-Prüfziffer (ISO 6166, Luhn über die in Ziffern umgewandelten Zeichen). */
export function isValidIsin(isin) {
  isin = String(isin || '').trim().toUpperCase();
  if (!/^[A-Z]{2}[A-Z0-9]{9}[0-9]$/.test(isin)) return false;
  const digits = isin.slice(0, 11).split('').map(c => (/[A-Z]/.test(c) ? String(c.charCodeAt(0) - 55) : c)).join('');
  let sum = 0;
  let double = true; // von rechts beginnend wird jede zweite Ziffer verdoppelt
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = Number(digits[i]);
    if (double) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    double = !double;
  }
  return (10 - (sum % 10)) % 10 === Number(isin[11]);
}

export function looksLikeWkn(s) {
  s = String(s || '').trim().toUpperCase();
  // reine Buchstabenfolgen (z. B. "APPLE1") sind selten, daher mindestens eine Ziffer verlangen
  return WKN_RE.test(s) && /\d/.test(s);
}

/** Deutsche ISINs (DE000xxxxxxP) enthalten die WKN an Stelle 6–11. */
export function wknFromIsin(isin) {
  isin = String(isin || '').toUpperCase();
  if (/^DE000[A-Z0-9]{6}\d$/.test(isin)) return isin.slice(5, 11);
  return '';
}

const COUNTRIES = {
  US: 'USA', DE: 'Deutschland', IE: 'Irland', LU: 'Luxemburg', FR: 'Frankreich', NL: 'Niederlande',
  ES: 'Spanien', IT: 'Italien', GB: 'Großbritannien', CH: 'Schweiz', AT: 'Österreich', JP: 'Japan',
  TW: 'Taiwan', CN: 'China', HK: 'Hongkong', KR: 'Südkorea', CA: 'Kanada', AU: 'Australien',
  DK: 'Dänemark', SE: 'Schweden', NO: 'Norwegen', FI: 'Finnland', BE: 'Belgien', JE: 'Jersey',
  KY: 'Kaimaninseln', BM: 'Bermuda', IN: 'Indien', BR: 'Brasilien', XC: 'Rohstoff', XS: 'International'
};

export function countryOf(isin) {
  const cc = String(isin || '').slice(0, 2).toUpperCase();
  return COUNTRIES[cc] || '';
}

const CRYPTO = {
  bitcoin: 'BTC', btc: 'BTC', ethereum: 'ETH', eth: 'ETH', solana: 'SOL', sol: 'SOL', cardano: 'ADA',
  ripple: 'XRP', xrp: 'XRP', dogecoin: 'DOGE', polkadot: 'DOT', litecoin: 'LTC', chainlink: 'LINK',
  avalanche: 'AVAX', tether: 'USDT', 'usd coin': 'USDC', polygon: 'POL', tron: 'TRX', bnb: 'BNB'
};
const COMMODITIES = [
  [/\bgold\b/, 'Goldpreis OR Gold price'],
  [/\bsilber\b|\bsilver\b/, 'Silberpreis OR Silver price'],
  [/\bplatin\b|\bplatinum\b/, 'Platinpreis OR Platinum price'],
  [/\bpalladium\b/, 'Palladium'],
  [/\bkupfer\b|\bcopper\b/, 'Kupferpreis OR Copper price'],
  [/\bbrent\b|\boel\b|\bcrude\b|\bwti\b/, 'Ölpreis OR Oil price']
];
// Indizes, die in ETF-Namen vorkommen → als Suchbegriff deutlich treffsicherer als der Fondsname.
const INDEXES = [
  [/s ?& ?p ?500|s p 500|sp500/, 'S&P 500'],
  [/nasdaq ?100/, 'Nasdaq'],
  [/msci world/, 'MSCI World'],
  [/msci (acwi|all country)/, 'MSCI ACWI'],
  [/ftse all ?world/, 'FTSE All-World'],
  [/msci (em|emerging)/, 'Emerging Markets'],
  [/msci europe|stoxx europe 600|stoxx 600/, 'Stoxx 600 OR europäische Aktien'],
  [/euro ?stoxx 50/, 'Euro Stoxx 50'],
  [/msci japan|nikkei|topix/, 'Nikkei'],
  [/msci china|csi 300/, 'China Aktien OR CSI 300'],
  [/\bdax\b/, 'DAX'],
  [/mdax/, 'MDAX'],
  [/msci usa/, 'Wall Street'],
  [/dow jones/, 'Dow Jones']
];

// Feinschliff für häufige Namen, bei denen der reine Firmenname zu viele Fehltreffer liefert.
const SEARCH_OVERRIDES = {
  US02079K3059: 'Alphabet OR Google',
  US02079K1079: 'Alphabet OR Google',
  US30303M1027: 'Meta Platforms OR Facebook',
  TW0002330008: 'TSMC OR Taiwan Semiconductor',
  US88160R1014: 'Tesla',
  US0378331005: 'Apple',
  DE0007164600: 'SAP',
  US5324571083: 'Eli Lilly',
  US4781601046: 'Johnson & Johnson',
  JP3143600009: 'Itochu'
};

const LEGAL_SUFFIX = /[,\s]+(inc\.?|incorporated|corp\.?|corporation|co\.?|company|ag|se|sa|s\.a\.|nv|n\.v\.|plc|ltd\.?|limited|kgaa|kga a|gmbh|holding|holdings|group|class [abc]|reg\.?|registered|shares?|namens-?aktien|inhaber-?aktien|vz|st|adr|\(a\)|\(b\)|\(c\))$/i;

export function cleanCompanyName(name) {
  let s = String(name || '').trim();
  s = s.replace(/\.com\b/i, '');
  s = s.replace(/\s*\([^)]*\)\s*$/, ''); // "(A)", "(EUR)" am Ende
  let prev;
  do { prev = s; s = s.replace(LEGAL_SUFFIX, '').trim(); } while (s !== prev && s.length > 2);
  return s;
}

/**
 * Bestimmt Typ, WKN, Land und Suchbegriff einer Position.
 * Gibt ein Objekt mit erkannten Feldern zurück; bereits gesetzte Werte haben Vorrang.
 */
export function recognize(pos) {
  const out = { ...pos };
  const rawId = String(pos.isin || pos.symbol || '').trim();
  const name = String(pos.name || '').trim();
  const n = norm(name + ' ' + rawId);

  // ISIN aus Namen extrahieren, falls keine eigene Spalte existiert ("Apple Inc. (US0378331005)")
  if (!out.isin) {
    const m = name.toUpperCase().match(ISIN_RE);
    if (m && isValidIsin(m[1])) out.isin = m[1];
  }
  if (out.isin) out.isin = String(out.isin).trim().toUpperCase();
  if (!out.wkn && out.isin) out.wkn = wknFromIsin(out.isin);
  if (out.wkn) out.wkn = String(out.wkn).trim().toUpperCase();

  const validIsin = isValidIsin(out.isin);
  out.isinValid = validIsin;

  if (!out.type) {
    let type = 'Aktie';
    const cryptoKey = Object.keys(CRYPTO).find(k => new RegExp(`(^|\\s)${k}(\\s|$)`).test(n));
    if (cryptoKey || /_to_|crypto|krypto|coin\b/.test(n) || /^[A-Z]{2,5}_TO_[A-Z]{3}$/i.test(rawId)) type = 'Krypto';
    else if (/^XC/.test(out.isin || '') || COMMODITIES.some(([re]) => re.test(n)) && !/\b(etf|fonds|fund|mining|minen|corp|inc|ag)\b/.test(n)) type = 'Rohstoff';
    else if (/\b(etf|ucits|index ?fonds|ishares|xtrackers|amundi|vanguard|spdr|lyxor|invesco|wisdomtree)\b/.test(n)) type = /\betc\b/.test(n) ? 'ETC' : 'ETF';
    else if (/\b(etc|etn)\b/.test(n)) type = 'ETC';
    else if (/\b(fonds|fund|sicav|investmentfonds)\b/.test(n)) type = 'Fonds';
    else if (/\b(anleihe|bond|bund|treasury|schuldverschreibung|pfandbrief|notes?)\b|\d+[,.]?\d*\s?%/.test(n) || /^XS/.test(out.isin || '')) type = 'Anleihe';
    else if (/\b(cash|konto|tagesgeld|liquiditaet|verrechnungskonto|geldmarkt)\b/.test(n)) type = 'Cash';
    out.type = type;
  }

  if (!out.country && out.isin) out.country = countryOf(out.isin);

  if (!out.searchTerm) out.searchTerm = suggestSearchTerm({ ...out, name });
  return out;
}

export function suggestSearchTerm(pos) {
  const name = String(pos.name || '');
  const n = norm(name);
  if (pos.isin && SEARCH_OVERRIDES[pos.isin]) return SEARCH_OVERRIDES[pos.isin];
  switch (pos.type) {
    case 'Krypto': {
      const key = Object.keys(CRYPTO).find(k => new RegExp(`(^|\\s)${k}(\\s|$)`).test(n));
      if (key && key.length > 3) return cap(key);
      return cleanCompanyName(name);
    }
    case 'Rohstoff': {
      const hit = COMMODITIES.find(([re]) => re.test(n));
      return hit ? hit[1] : cleanCompanyName(name);
    }
    case 'ETF': case 'Fonds': case 'ETC': {
      const hit = INDEXES.find(([re]) => re.test(n));
      if (hit) return hit[1];
      const com = COMMODITIES.find(([re]) => re.test(n));
      if (com) return com[1];
      return cleanCompanyName(name.replace(/\b(UCITS|ETF|Acc|Dist|EUR|USD|\(.*?\))\b/gi, ''));
    }
    case 'Cash': return '';
    default: return cleanCompanyName(name);
  }
}

function cap(s) { return s.charAt(0).toUpperCase() + s.slice(1); }

/** Zerlegt "A OR B | C" in einzelne Suchbegriffe. */
export function splitTerms(term) {
  return String(term || '')
    .split(/\s+OR\s+|\s*\|\s*|\s*;\s*/)
    .map(s => s.trim().replace(/^"|"$/g, ''))
    .filter(s => s.length >= 2);
}

export const ASSET_TYPES = ['Aktie', 'ETF', 'Fonds', 'ETC', 'Anleihe', 'Krypto', 'Rohstoff', 'Cash', 'Sonstiges'];
