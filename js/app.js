// Hauptlogik der Oberfläche.

import { $, $$, esc, uid, parseNumber, fmtMoney, fmtNumber, fmtPercent, fmtDateTime, timeAgo, norm, downloadBlob, todayStamp } from './util.js';
import { importFile, parseSheets, recomputeWeights, FIELD_LABELS } from './parser.js';
import { recognize, suggestSearchTerm, isValidIsin, looksLikeWkn, wknFromIsin, splitTerms, ASSET_TYPES } from './assets.js';
import { fetchNews, rankNews, bucketLabel, defaultPoolUrl, collapseSimilar } from './news.js';
import { lookupSecurity, fetchQuote } from './lookup.js';
import { DEFAULT_SOURCES, normalizeDomain } from './sources.js';
import { loadState, saveState, defaultState, buildBackup, restoreBackup, clearAll, idbGet, idbSet, idbDel } from './store.js';

const APP_VERSION = '1.7.0';
const TABLE_EXT = /\.(csv|txt|tsv|xlsx|xlsm|xls|ods|numbers)$/i;
const BACKUP_NAME = 'depot-news-sicherung.json';
const supportsDir = 'showDirectoryPicker' in window;
const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

let state = loadState();
let dirHandle = null;
let pendingImport = null;
let fileTarget = 'import';   // wofür der Dateidialog gerade geöffnet ist
let newsFilter = null;       // Positions-ID, nach der die News gefiltert werden
let refreshing = null;       // AbortController des laufenden Abrufs
let autoTimer = null;
let editingId = null;

const posById = () => new Map(state.portfolio.positions.map(p => [p.id, p]));
const newsOn = p => p.newsEnabled !== false;
/** Nur Positionen, für die der Nutzer News sehen möchte. */
const newsPosById = () => { const ids = newsTopIds(); return new Map(state.portfolio.positions.filter(p => ids.has(p.id)).map(p => [p.id, p])); };
const save = (now) => saveState(state, now);

// ---------------------------------------------------------------- Hilfen UI

function toast(msg, ms = 3500) {
  const t = $('#toast');
  t.textContent = msg;
  t.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { t.hidden = true; }, ms);
}

function showBanner(html, actions = []) {
  const b = $('#banner');
  b.innerHTML = `<div class="banner-text">${html}</div><div class="banner-actions"></div>`;
  const box = $('.banner-actions', b);
  for (const a of actions) {
    const btn = document.createElement('button');
    btn.className = 'btn small ' + (a.primary ? 'primary' : 'ghost');
    btn.type = 'button';
    btn.textContent = a.label;
    btn.onclick = () => { if (!a.keep) hideBanner(); a.onClick?.(); };
    box.appendChild(btn);
  }
  b.hidden = false;
}
function hideBanner() { $('#banner').hidden = true; }

/** Meldung als Dialog (bleibt auch über anderen Dialogen sichtbar). */
function showMessage(title, text) {
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dlg';
    dlg.innerHTML = `<form method="dialog" class="dlg-body"><h2>${esc(title)}</h2><p>${esc(text)}</p>
      <div class="btn-row"><button class="btn primary" value="ok">OK</button></div></form>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => { dlg.remove(); resolve(); });
    dlg.showModal();
  });
}

/** Kleiner Auswahldialog (Action Sheet). */
function choose(title, options) {
  return new Promise(resolve => {
    const dlg = document.createElement('dialog');
    dlg.className = 'dlg';
    dlg.innerHTML = `<form method="dialog" class="dlg-body"><h2>${esc(title)}</h2><div class="btn-col">${
      options.map((o, i) => `<button class="btn ${i === 0 ? 'primary' : ''}" value="${i}">${esc(o)}</button>`).join('')
    }<button class="btn ghost" value="-1">Abbrechen</button></div></form>`;
    document.body.appendChild(dlg);
    dlg.addEventListener('close', () => { resolve(Number(dlg.returnValue ?? -1)); dlg.remove(); });
    dlg.showModal();
  });
}

function displayMode() { return state.settings.displayMode === 'value' ? 'value' : 'percent'; }

function fmtPos(p, mode = displayMode()) {
  if (mode === 'value') return Number.isFinite(p.value) ? fmtMoney(p.value) : 'Wert n. v.';
  return Number.isFinite(p.weight) ? fmtPercent(p.weight) : '–';
}

/** IDs der Positionen, für die News abgerufen werden (größte N mit aktiviertem Abruf). */
function newsTopIds() {
  const min = Number(state.settings.watchMinWeight ?? 0);
  return new Set(state.portfolio.positions
    .filter(p => p.newsEnabled !== false && p.type !== 'Cash' && (p.weight || 0) >= min)
    .map(p => p.id));
}

function totalValue() {
  const ps = state.portfolio.positions;
  return ps.some(p => Number.isFinite(p.value)) ? ps.reduce((a, p) => a + (Number.isFinite(p.value) ? p.value : 0), 0) : null;
}

// ---------------------------------------------------------------- Navigation

function showTab(name) {
  $$('.view').forEach(v => { v.hidden = v.dataset.view !== name; });
  $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === name));
  if (name === 'depot') renderDepot();
  if (name === 'sources') renderSources();
  if (name === 'more') renderSettings();
  window.scrollTo({ top: 0 });
}

// ---------------------------------------------------------------- Rendering

function renderHeader() {
  const ps = state.portfolio.positions;
  const total = totalValue();
  const src = state.portfolio.source;
  const parts = [`${ps.length} Positionen`];
  if (total) parts.push(fmtMoney(total));
  if (src?.kind === 'sample') parts.push('Musterdepot');
  $('#portfolioSummary').textContent = ps.length ? parts.join(' · ') : 'Noch kein Depot geladen';
  $('#modeSwitch').checked = displayMode() === 'value';
  $$('.toggle-label').forEach(l => l.classList.toggle('on', l.dataset.for === displayMode()));
  // Vorschläge für das Eingabefeld
  $('#lookupList').innerHTML = ps.slice(0, 300).map(p =>
    `<option value="${esc(p.name)}">${esc([p.isin, p.wkn].filter(Boolean).join(' · '))}</option>`).join('');
}

function renderNews() {
  const map = newsPosById();
  const mode = state.settings.bucket || 'day';
  let items = rankNews(state.news.items, map, mode);
  if (newsFilter) items = items.filter(it => it.positionIds.includes(newsFilter));
  items = collapseSimilar(items);
  const read = new Set(state.news.read);

  const chip = $('#filterChip');
  const allMap = posById();
  if (newsFilter && allMap.get(newsFilter)) {
    chip.innerHTML = `<button class="chip filter" type="button">Nur: ${esc(allMap.get(newsFilter).name)} ✕</button>`;
    $('button', chip).onclick = () => { newsFilter = null; renderNews(); };
  } else chip.innerHTML = '';

  const errs = state.news.errors || [];
  $('#newsErrors').innerHTML = errs.length
    ? `<details class="card warn small"><summary>${errs.length} Hinweis(e) beim Abruf</summary><ul>${errs.map(e => `<li>${esc(e)}</li>`).join('')}</ul></details>`
    : '';

  $('#newsStatus').textContent = state.news.fetchedAt
    ? `Aktualisiert ${timeAgo(state.news.fetchedAt)} · ${items.length} Artikel`
    : 'Noch nicht aktualisiert';

  const list = $('#newsList');
  if (!state.portfolio.positions.length) {
    list.innerHTML = `<div class="empty card"><p>Noch kein Depot geladen.</p><button class="btn primary" type="button" data-act="onboard">Depot einrichten</button></div>`;
    return;
  }
  if (!items.length) {
    list.innerHTML = `<div class="empty card"><p>${state.news.fetchedAt ? 'Keine passenden News im gewählten Zeitraum.' : 'Tippe auf ↻, um News zu laden.'}</p>
      ${state.news.fetchedAt ? '<p class="muted small">Tipp: Zeitraum verlängern, weitere Quellen aktivieren oder Suchbegriffe der Positionen anpassen.</p>' : ''}
      <button class="btn primary" type="button" data-act="refresh">News laden</button></div>`;
    return;
  }
  let html = '';
  let lastBucket = null;
  for (const it of items) {
    if (it.bucket !== lastBucket) {
      if (lastBucket !== null) html += '</div>';
      html += `<h3 class="bucket">${esc(bucketLabel(it.bucket, mode))}</h3><div class="news-group">`;
      lastBucket = it.bucket;
    }
    const chips = it.positionIds.filter(id => map.has(id)).slice(0, 3).map(id => {
      const p = map.get(id);
      return `<button type="button" class="chip" data-pos="${esc(id)}">${esc(p.name)} <b>${esc(fmtPos(p))}</b></button>`;
    }).join('');
    const unread = !read.has(it.id);
    html += `<article class="news-item ${unread ? 'unread' : ''}">
      <a href="${esc(it.url)}" target="_blank" rel="noopener noreferrer" data-id="${esc(it.id)}">${unread ? '<span class="dot" aria-label="neu"></span>' : ''}${esc(it.title)}</a>
      <div class="meta"><span class="src">${esc(it.sourceName)}</span>${it.also?.length ? ` <span class="also">+ ${esc(it.also.join(', '))}</span>` : ''} · <time datetime="${new Date(it.ts).toISOString()}" title="${esc(fmtDateTime(it.ts))}">${esc(timeAgo(it.ts))}</time></div>
      <div class="chips">${chips}</div>
    </article>`;
  }
  html += '</div>';
  list.innerHTML = html;
}

function renderLookup() {
  const q = $('#lookupInput').value.trim();
  const out = $('#lookupResult');
  if (!q) { out.innerHTML = ''; return; }
  const nq = norm(q);
  const up = q.toUpperCase().replace(/\s/g, '');
  const ps = state.portfolio.positions;
  let hits = ps.filter(p => p.isin === up || p.wkn === up || (p.symbol && p.symbol.toUpperCase() === up));
  if (!hits.length) hits = ps.filter(p => norm(p.name).includes(nq) || (p.isin || '').startsWith(up) || (p.wkn || '').startsWith(up));
  if (!hits.length) {
    let hint = 'Nicht im Depot gefunden.';
    if (isValidIsin(up)) hint = `Gültige ISIN (${esc(up)}), aber nicht im Depot.`;
    else if (looksLikeWkn(up)) hint = `Mögliche WKN (${esc(up)}), aber nicht im Depot.`;
    out.innerHTML = `<p class="muted">${hint}</p><button class="btn small" type="button" data-act="add-from-lookup">Als Position hinzufügen</button>`;
    return;
  }
  const mode = displayMode();
  const top = newsTopIds();
  out.innerHTML = hits.slice(0, 5).map(p => {
    const main = fmtPos(p, mode);
    const other = fmtPos(p, mode === 'value' ? 'percent' : 'value');
    const n = state.news.items.filter(it => it.positionIds.includes(p.id)).length;
    return `<div class="lookup-hit">
      <div>
        <div class="hit-name">${esc(p.name)}</div>
        <div class="muted small">${esc([p.isin, p.wkn && 'WKN ' + p.wkn, p.symbol, p.type].filter(Boolean).join(' · '))}</div>
      </div>
      <div class="hit-num"><div class="big">${esc(main)}</div><div class="muted small">${esc(other)}</div></div>
      <div class="hit-actions">
        <button class="btn small" type="button" data-act="filter" data-pos="${esc(p.id)}">News (${n})</button>
        <button class="btn small ghost" type="button" data-act="edit" data-pos="${esc(p.id)}">Bearbeiten</button>
      </div>
      ${top.has(p.id) ? '' : `<p class="muted small hit-note">${p.newsEnabled === false
        ? 'Für diese Position sind News abgeschaltet (Schalter unter „Depot“).'
        : `Keine News: Gewichtung unter ${esc(String(state.settings.watchMinWeight))} % (unter „Mehr“ einstellbar).`}</p>`}
    </div>`;
  }).join('') + (hits.length > 5 ? `<p class="muted small">… und ${hits.length - 5} weitere</p>` : '');
}

function renderDepot() {
  const pf = state.portfolio;
  const src = pf.source;
  $('#depotName').textContent = pf.name || 'Mein Depot';
  const total = totalValue();
  const srcText = !src ? 'Keine Datei eingelesen'
    : src.kind === 'sample' ? 'Musterdepot (Beispieldaten)'
      : `${src.fileName}${src.sheet && src.sheetCount > 1 ? ' – Blatt „' + src.sheet + '“' : ''} · eingelesen ${fmtDateTime(src.importedAt)}`;
  $('#depotMeta').innerHTML = `${esc(srcText)}${total ? '<br>Gesamtwert ' + esc(fmtMoney(total)) : ''}`;

  const f = norm($('#depotFilter').value);
  const sort = $('#depotSort').value;
  let ps = pf.positions.filter(p => !f || norm([p.name, p.isin, p.wkn, p.symbol, p.type].join(' ')).includes(f));
  ps = [...ps].sort(sort === 'name' ? (a, b) => a.name.localeCompare(b.name, 'de')
    : sort === 'type' ? (a, b) => (a.type || '').localeCompare(b.type || '', 'de') || (b.weight || 0) - (a.weight || 0)
      : (a, b) => (b.weight || 0) - (a.weight || 0));
  const maxW = Math.max(1, ...pf.positions.map(p => p.weight || 0));
  const topIds = newsTopIds();
  const onCount = pf.positions.filter(newsOn).length;
  $('#newsCount').textContent = `News für ${onCount} von ${pf.positions.length} Positionen`;
  $('#positionList').innerHTML = ps.map(p => `
    <li class="pos-row ${newsOn(p) && topIds.has(p.id) ? '' : 'news-off'}"><button type="button" class="pos" data-pos="${esc(p.id)}">
      <div class="pos-main">
        <span class="pos-name">${esc(p.name)}</span>
        <span class="muted small">${esc([p.type, p.isin || p.wkn || p.symbol].filter(Boolean).join(' · '))}${p.manual ? ' · manuell' : ''}${newsOn(p) && !topIds.has(p.id) && p.type !== 'Cash' ? ` · unter ${esc(String(state.settings.watchMinWeight))} %` : ''}</span>
        <span class="wbar"><span style="width:${Math.max(1, (p.weight || 0) / maxW * 100).toFixed(1)}%"></span></span>
      </div>
      <div class="pos-num"><b>${esc(fmtPercent(p.weight))}</b><span class="muted small">${esc(Number.isFinite(p.value) ? fmtMoney(p.value) : '')}</span>${p.priceAt ? `<span class="muted tiny">${esc(fmtQuote(p))}</span>` : ''}</div>
    </button>${newsSwitch(p.id, newsOn(p), p.name, 'data-news')}</li>`).join('') || '<li class="muted empty">Keine Positionen.</li>';
}

/** Schiebeschalter „News an/aus“ für eine Position. */
function newsSwitch(id, on, name, attr) {
  return `<label class="switch news-switch" title="News für ${esc(name)} ${on ? 'abwählen' : 'anzeigen'}">
    <input type="checkbox" role="switch" ${attr}="${esc(id)}" ${on ? 'checked' : ''} aria-label="News für ${esc(name)}">
    <span class="slider"></span></label>`;
}

function setNewsEnabled(ids, on) {
  const set = new Set(ids);
  for (const p of state.portfolio.positions) if (set.has(p.id)) p.newsEnabled = on;
  if (!on && set.has(newsFilter)) newsFilter = null;
  state.portfolio.updatedAt = Date.now();
  save();
  renderAll();
  renderDepot();
  autoBackup();
}

function renderSources() {
  const groups = { de: 'Deutschsprachig', en: 'Englischsprachig', any: 'Weitere' };
  let html = '';
  for (const [lang, label] of Object.entries(groups)) {
    const list = state.sources.filter(s => (s.lang || 'any') === lang);
    if (!list.length) continue;
    html += `<h3 class="bucket">${label}</h3><ul class="card src-list">` + list.map(s => `
      <li>
        <label class="check grow">
          <input type="checkbox" data-src="${esc(s.id)}" ${s.enabled ? 'checked' : ''}>
          <span><strong>${esc(s.name)}</strong> <span class="muted small">${esc(s.domain)}${s.category ? ' · ' + esc(s.category) : ''}${s.rss ? ' · RSS' : ''}</span></span>
        </label>
        ${s.builtin ? '' : `<button type="button" class="link-btn small danger-text" data-del-src="${esc(s.id)}">Entfernen</button>`}
      </li>`).join('') + '</ul>';
  }
  $('#sourceList').innerHTML = html;
}

async function renderSettings() {
  const f = $('#settingsForm');
  const s = state.settings;
  f.lang_de.checked = s.languages.includes('de');
  f.lang_en.checked = s.languages.includes('en');
  f.timespanDays.value = String(s.timespanDays);
  const pi = state.news.poolInfo;
  $('#poolHint').textContent = 'News kommen aus der News-Sammlung: Alle 30 Minuten werden die Schlagzeilen aller Quellen '
    + 'gesammelt; die App sucht darin auf deinem Gerät nach deinen Positionen.'
    + (pi?.generatedAt ? ` Stand: ${fmtDateTime(pi.generatedAt)}, ${pi.count} Artikel.` : '');
  f.bucket.value = s.bucket;
  f.autoRefreshMin.value = String(s.autoRefreshMin);
  f.askOnStart.checked = s.askOnStart;
  f.notify.checked = s.notify && ('Notification' in window) && Notification.permission === 'granted';
  f.notifyMinWeight.value = s.notifyMinWeight;
  f.watchMinWeight.value = s.watchMinWeight;
  f.minValue.value = s.minValue ?? 10;
  let hint = '';
  if (!('Notification' in window)) {
    hint = isIOS && !isStandalone
      ? 'Auf dem iPhone/iPad funktionieren Benachrichtigungen nur, wenn die App über „Teilen → Zum Home-Bildschirm“ installiert ist (ab iOS 16.4).'
      : 'Dieser Browser unterstützt keine Benachrichtigungen.';
  } else {
    hint = `Status: ${Notification.permission === 'granted' ? 'erlaubt' : Notification.permission === 'denied' ? 'blockiert (in den Systemeinstellungen ändern)' : 'noch nicht erlaubt'}. `
      + 'Benachrichtigt wird, sobald die App neue News findet – beim Öffnen und bei automatischer Aktualisierung. Echte Push-Nachrichten bei geschlossener App benötigen einen Server (siehe README).';
  }
  $('#notifyHint').textContent = hint;
  $('#backupInfo').textContent = state.lastBackupAt ? `Letzte Sicherung: ${fmtDateTime(state.lastBackupAt)}` : 'Noch keine Sicherung erstellt.';
  $('#autoBackupChk').checked = s.autoBackup;
  $('#dirInfo').textContent = !supportsDir
    ? 'Dieser Browser kann kein Verzeichnis dauerhaft verbinden (z. B. Safari auf iPhone). Sicherungen werden über „Teilen → In Dateien sichern“ oder als Download gespeichert.'
    : dirHandle ? `Verbunden: „${dirHandle.name}“. Neue Tabellen darin werden beim Start automatisch eingelesen.` : 'Kein Verzeichnis verbunden.';
  $('#forgetDirBtn').hidden = !dirHandle;
  $('#chooseDirBtn').hidden = !supportsDir;
  $('#autoBackupChk').closest('label').hidden = !supportsDir;
  $('#versionInfo').textContent = `Version ${APP_VERSION}`;
}

function renderAll() {
  renderHeader();
  renderNews();
  renderLookup();
  if (!$('#view-depot').hidden) renderDepot();
}

// ---------------------------------------------------------------- Import

/** Eingelesene Position mit bekanntem Wert unter der Mindestgrenze (unter „Mehr“ einstellbar)? */
function belowMin(p) {
  const min = Number(state.settings.minValue) || 0;
  return min > 0 && !p.manual && Number.isFinite(p.value) && p.value < min;
}

/** Entfernt eingelesene Positionen unter der Mindestgrenze; gibt die entfernten zurück. */
function removeBelowMin() {
  const gone = state.portfolio.positions.filter(belowMin);
  if (gone.length) {
    state.portfolio.positions = state.portfolio.positions.filter(p => !belowMin(p));
    recomputeWeights(state.portfolio.positions);
  }
  return gone;
}

function keyMatches(a, b) {
  return (a.isin && a.isin === b.isin) || (a.wkn && a.wkn === b.wkn) || (a.symbol && a.symbol === b.symbol)
    || (!a.isin && !b.isin && norm(a.name) === norm(b.name));
}

function applyImport(res, mode, kind) {
  const old = state.portfolio.positions;
  const incoming = res.positions.map(p => {
    const o = old.find(x => keyMatches(x, p));
    if (!o) return { ...p, newsEnabled: p.newsChoice ?? p.type !== 'Cash' };
    return {
      ...p,
      id: o.id,
      searchTerm: o.searchTermCustom ? o.searchTerm : p.searchTerm,
      searchTermCustom: !!o.searchTermCustom,
      newsEnabled: p.newsChoice ?? o.newsEnabled !== false,
      type: o.typeCustom ? o.type : p.type,
      typeCustom: !!o.typeCustom,
      // Kurs wurde schon einmal geholt → nicht erneut abfragen
      ...(o.priceAt || o.priceTried ? { priceTried: true, priceAt: o.priceAt, priceCurrency: o.priceCurrency, priceMarket: o.priceMarket, price: p.price ?? o.price } : {})
    };
  });
  let result;
  if (mode === 'merge') {
    result = old.map(o => incoming.find(n => n.id === o.id) || o);
    for (const n of incoming) if (!result.some(r => r.id === n.id)) result.push(n);
  } else {
    result = [...incoming, ...old.filter(o => o.manual && !incoming.some(n => n.id === o.id))];
  }
  for (const r of result) delete r.newsChoice;
  // Positionen unter der Mindestgrenze (Standard 10 €) nicht übernehmen bzw. entfernen
  const dropped = result.filter(belowMin);
  result = result.filter(p => !belowMin(p));
  recomputeWeights(result);
  state.portfolio.positions = result;
  if (dropped.length) setTimeout(() => toast(`${dropped.length} Position${dropped.length === 1 ? '' : 'en'} unter ${state.settings.minValue} € nicht übernommen.`, 5000), 900);
  state.portfolio.source = {
    kind, fileName: res.fileName, lastModified: res.lastModified, importedAt: Date.now(),
    sheet: res.sheet, sheetCount: res.sheetCount, mapping: res.mapping, transposed: res.transposed
  };
  state.portfolio.updatedAt = Date.now();
  state.onboarded = true;
  save(true);
  renderAll();
  autoBackup();
  setTimeout(fetchMissingQuotes, 400); // einmalig Kurse für neue Positionen
}

const FIELD_OPTIONS = [['', 'ignorieren'], ...Object.entries(FIELD_LABELS)];

function importReportHtml(res, { colsOpen = false } = {}) {
  // Vorbelegung der News-Schalter: bisherige Auswahl bei bekannten Positionen, sonst an (Cash aus)
  const old = state.portfolio.positions;
  for (const p of res.positions) {
    const o = old.find(x => keyMatches(x, p));
    p.newsChoice ??= o ? o.newsEnabled !== false : p.type !== 'Cash';
  }
  const hasMoney = res.positions.some(p => Number.isFinite(p.value));
  const dropped = res.positions.filter(belowMin);
  const rows = res.positions.map((p, i) => ({ p, i })).sort((a, b) => (b.p.weight || 0) - (a.p.weight || 0)).map(({ p, i }) =>
    `<tr class="${belowMin(p) ? 'dropped' : ''}"><td><b>${esc(p.name)}</b><div class="muted small">${esc([p.isin || p.wkn || p.symbol, p.type].filter(Boolean).join(' · '))}${belowMin(p) ? ` · <span class="warn-text">unter ${esc(String(state.settings.minValue))} € – wird nicht übernommen</span>` : ''}</div></td>
      ${hasMoney ? `<td class="num">${esc(Number.isFinite(p.value) ? fmtMoney(p.value) : '–')}</td>` : ''}
      <td class="num">${esc(fmtPercent(p.weight))}</td>
      <td class="num">${newsSwitch(String(i), p.newsChoice, p.name, 'data-imp')}</td></tr>`).join('');
  const types = Object.entries(res.positions.reduce((m, p) => { m[p.type] = (m[p.type] || 0) + 1; return m; }, {}))
    .map(([t, n]) => `${n}× ${t}`).join(', ');
  const missingName = res.mapping.name === undefined;
  const missingAmount = res.mapping.value === undefined && res.mapping.weight === undefined && res.mapping.quantity === undefined;
  const colRows = (res.columns || []).map(c => `
    <tr>
      <td><b>${esc(c.header || `Spalte ${c.index + 1}`)}</b><div class="muted small">${esc(c.samples.join(' · ') || '(leer)')}</div></td>
      <td><select data-col="${c.index}" aria-label="Bedeutung von ${esc(c.header || 'Spalte ' + (c.index + 1))}">
        ${FIELD_OPTIONS.map(([v, l]) => `<option value="${v}" ${c.field === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}
      </select></td>
    </tr>`).join('');
  const sheetSel = res.sheetNames?.length > 1
    ? `<label class="small">Tabellenblatt <select id="impSheet">${res.sheetNames.map(n => `<option ${n === res.sheet ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>`
    : '';
  return `<p><strong>${esc(res.fileName)}</strong>${res.sheetCount > 1 ? ` – Blatt „${esc(res.sheet)}“` : ''}:
      <strong>${res.positions.length} Positionen</strong>${types ? ` (${esc(types)})` : ''}.</p>
    ${dropped.length ? `<p class="small warn-text">${dropped.length} Position${dropped.length === 1 ? '' : 'en'} mit einem Wert unter ${esc(String(state.settings.minValue))} € ${dropped.length === 1 ? 'wird' : 'werden'} nicht übernommen (unter „Mehr“ einstellbar): ${esc(dropped.map(p => p.name).join(', '))}.</p>` : ''}
    ${res.autoTransposed || res.orientationCorrected ? `<p class="small ok-text">✓ Plausibilitätsprüfung: ${res.transposed
      ? 'Die Tabelle hat Felder in Zeilen und Positionen in Spalten – Zeilen und Spalten wurden automatisch getauscht.'
      : 'Zeilen und Spalten sind richtig ausgerichtet – eine Drehung wurde geprüft und verworfen.'}</p>` : ''}
    <label class="check small"><input type="checkbox" id="impTranspose" ${res.transposed ? 'checked' : ''}> Zeilen und Spalten tauschen</label>
    ${res.warnings?.length ? `<p class="warn-text small">${res.warnings.map(esc).join('<br>')}</p>` : ''}
    <details class="advanced" ${colsOpen || missingName || missingAmount || !res.positions.length ? 'open' : ''}>
      <summary>Spalten prüfen und korrigieren</summary>
      <p class="muted small">Falls eine Spalte falsch gedeutet wurde, hier die richtige Bedeutung wählen – die Positionen werden sofort neu eingelesen.</p>
      ${sheetSel}
      <table class="mini cols"><thead><tr><th>Spalte in deiner Datei</th><th>Bedeutung</th></tr></thead><tbody>${colRows}</tbody></table>
    </details>
    ${res.positions.length ? `
    <div class="row-between imp-head">
      <strong>Erkannte Positionen</strong>
      <span class="small">News: <button type="button" class="link-btn small" data-imp-all="1">alle an</button> · <button type="button" class="link-btn small" data-imp-all="0">alle aus</button></span>
    </div>
    <div class="imp-scroll"><table class="mini"><thead><tr><th>Position</th>${hasMoney ? '<th class="num">Wert</th>' : ''}<th class="num">Anteil</th><th class="num">News</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p id="impCount" class="muted small"></p>` : '<p id="impCount" class="warn-text">Noch keine Positionen erkannt – bitte oben mindestens die Spalte „Name“ oder „ISIN / Kennung“ zuordnen.</p>'}`;
}

/** Liest die Tabelle mit geänderter Spaltenzuordnung bzw. anderem Blatt neu ein. */
function reparseImport({ sheet = null, changedCol = null, field = null, orientation = null } = {}) {
  const prev = pendingImport.res;
  let mapping = null;
  if (changedCol !== null) {
    mapping = { ...prev.mapping };
    for (const [f, c] of Object.entries(mapping)) if (c === changedCol || f === field) delete mapping[f];
    if (field) mapping[field] = changedCol;
  }
  // Spaltenkorrektur behält die aktuelle Ausrichtung; der Schalter legt sie neu fest
  const orient = orientation || (sheet ? 'auto' : prev.transposed ? 'cols' : 'rows');
  const res = parseSheets(prev.sheets, { sheet: sheet ?? prev.sheet, mapping: sheet || orientation ? null : mapping, orientation: orient });
  // Bereits gesetzte News-Schalter übernehmen
  for (const p of res.positions) {
    const o = prev.positions.find(x => keyMatches(x, p));
    if (o) p.newsChoice = o.newsChoice;
  }
  pendingImport.res = { ...prev, ...res, fileName: prev.fileName, lastModified: prev.lastModified, sheets: prev.sheets };
  $('#importReport').innerHTML = importReportHtml(pendingImport.res, { colsOpen: true });
  updateImpCount();
}

function updateImpCount() {
  const ps = pendingImport?.res.positions || [];
  const okBtn = $('#importDlg button[value=ok]');
  if (okBtn) okBtn.disabled = !ps.length;
  const kept = ps.filter(p => !belowMin(p));
  if (okBtn) okBtn.disabled = !kept.length;
  if (ps.length) $('#impCount').textContent = `News für ${kept.filter(p => p.newsChoice).length} von ${kept.length} übernommenen Positionen`;
}

async function handleFile(file, { auto = false, kind = 'file' } = {}) {
  try {
    const res = await importFile(file);
    if (auto && !res.positions.length) throw new Error('keine Positionen erkannt – bitte die Datei über „Datei einlesen“ wählen und die Spalten zuordnen.');
    if (auto) {
      applyImport(res, 'replace', kind);
      toast(`„${file.name}“ eingelesen – ${res.positions.length} Positionen`);
      return true;
    }
    pendingImport = { res, kind };
    $('#importReport').innerHTML = importReportHtml(res);
    updateImpCount();
    const dlg = $('#importDlg');
    $('input[name=mode][value=replace]', dlg).checked = true;
    dlg.showModal();
    return true;
  } catch (e) {
    console.error(e);
    await showMessage('Tabelle nicht eingelesen', e.message);
    return false;
  }
}

async function loadSample() {
  const r = await fetch('sample/Musterdepot.xlsx');
  const blob = await r.blob();
  const file = new File([blob], 'Musterdepot.xlsx', { lastModified: Date.now() });
  const res = await importFile(file);
  state.portfolio.name = 'Musterdepot';
  applyImport(res, 'replace', 'sample');
  toast('Musterdepot geladen – du kannst später jederzeit deine eigene Tabelle einlesen.');
}

function pickFile(target) {
  fileTarget = target;
  const inp = $('#fileInput');
  inp.value = '';
  inp.click();
}

// ---------------------------------------------------------------- Verzeichnis (File System Access API)

async function newestTableFile(handle) {
  let best = null;
  for await (const entry of handle.values()) {
    if (entry.kind !== 'file' || !TABLE_EXT.test(entry.name) || entry.name.startsWith('~$') || entry.name.startsWith('.')) continue;
    const file = await entry.getFile();
    if (!best || file.lastModified > best.lastModified) best = file;
  }
  return best;
}

async function chooseDirectory() {
  if (!supportsDir) { toast('Verzeichniswahl wird hier nicht unterstützt – bitte Datei wählen.'); pickFile('import'); return false; }
  try {
    const h = await window.showDirectoryPicker({ id: 'depot-news', mode: 'readwrite' });
    dirHandle = h;
    await idbSet('dir', h);
    const file = await newestTableFile(h);
    if (!file) {
      toast(`Im Verzeichnis „${h.name}“ wurde keine Tabelle gefunden. Bitte Datei hineinlegen oder direkt hochladen.`, 6000);
      renderSettings();
      return true;
    }
    await handleFile(file, { kind: 'dir' });
    renderSettings();
    return true;
  } catch (e) {
    if (e.name !== 'AbortError') toast('Verzeichnis konnte nicht geöffnet werden: ' + e.message, 6000);
    return false;
  }
}

async function checkDirectoryOnStart() {
  try { dirHandle = await idbGet('dir'); } catch { dirHandle = null; }
  if (!dirHandle) return false;
  const perm = await dirHandle.queryPermission?.({ mode: 'readwrite' });
  if (perm === 'granted') { await scanDirForUpdate(); return true; }
  showBanner(`Verzeichnis „${esc(dirHandle.name)}“ erneut verbinden, um nach einer neuen Depot-Datei zu suchen?`, [
    { label: 'Verbinden', primary: true, onClick: async () => {
      const p = await dirHandle.requestPermission({ mode: 'readwrite' });
      if (p === 'granted') await scanDirForUpdate(true);
    } },
    { label: 'Später' }
  ]);
  return true;
}

async function scanDirForUpdate(announceNone = false) {
  const file = await newestTableFile(dirHandle);
  const src = state.portfolio.source;
  if (!file) { if (announceNone) toast('Keine Tabelle im Verzeichnis gefunden.'); return; }
  const isNewer = !src || src.kind !== 'dir' || src.fileName !== file.name || (file.lastModified || 0) > (src.lastModified || 0);
  if (isNewer) await handleFile(file, { auto: true, kind: 'dir' });
  else if (announceNone) toast('Depot ist aktuell.');
}

// ---------------------------------------------------------------- Sicherung

async function writeBackupToDir() {
  if (!dirHandle) return false;
  if ((await dirHandle.queryPermission({ mode: 'readwrite' })) !== 'granted') return false;
  const fh = await dirHandle.getFileHandle(BACKUP_NAME, { create: true });
  const w = await fh.createWritable();
  await w.write(JSON.stringify(buildBackup(state), null, 2));
  await w.close();
  return true;
}

async function autoBackup() {
  if (!state.settings.autoBackup || !dirHandle) return;
  try {
    if (await writeBackupToDir()) { state.lastBackupAt = Date.now(); save(); }
  } catch (e) { console.warn('Auto-Sicherung fehlgeschlagen', e); }
}

async function manualBackup() {
  const json = JSON.stringify(buildBackup(state), null, 2);
  const name = `depot-news-sicherung_${todayStamp()}.json`;
  const file = new File([json], name, { type: 'application/json' });
  try {
    if (dirHandle && await writeBackupToDir()) {
      toast(`Gesichert in „${dirHandle.name}/${BACKUP_NAME}“`);
    } else if (navigator.canShare?.({ files: [file] }) && isIOS) {
      await navigator.share({ files: [file], title: 'Depot-News Sicherung' });
    } else {
      downloadBlob(file, name);
    }
    state.lastBackupAt = Date.now();
    save();
    renderSettings();
  } catch (e) {
    if (e.name !== 'AbortError') toast('Sicherung fehlgeschlagen: ' + e.message, 6000);
  }
}

async function restoreFromFile(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!confirm('Sicherung laden? Depot, Quellen und Einstellungen werden durch die Sicherung ersetzt.')) return;
    state = restoreBackup(state, data);
    save(true);
    renderAll();
    renderSettings();
    toast('Sicherung wiederhergestellt.');
  } catch (e) {
    toast('Sicherung konnte nicht geladen werden: ' + e.message, 6000);
  }
}

/** Exportiert das Depot als CSV mit 6 Spalten – so lässt es sich jederzeit wieder einlesen. */
function exportPositions() {
  const head = ['ISIN', 'WKN', 'Name', 'Typ', 'Wert (in €)', 'Gewicht (in %)'];
  const num = (v, d) => (Number.isFinite(v) ? v.toFixed(d).replace('.', ',') : '');
  const cell = v => (/[;"\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v ?? ''));
  const rows = [...state.portfolio.positions].sort((a, b) => (b.weight || 0) - (a.weight || 0))
    .map(p => [p.isin || p.symbol || '', p.wkn || '', p.name, p.type || '', num(p.value, 2), num(p.weight, 4)]);
  const csv = '\uFEFF' + [head, ...rows].map(r => r.map(cell).join(';')).join('\r\n') + '\r\n';
  downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), `depot_${todayStamp()}.csv`);
}

// ---------------------------------------------------------------- Positionen bearbeiten

function openPosEditor(id, preset = {}) {
  editingId = id;
  const p = id ? state.portfolio.positions.find(x => x.id === id) : { name: '', newsEnabled: true, ...preset };
  const f = $('#posForm');
  f.type.innerHTML = ASSET_TYPES.map(t => `<option>${t}</option>`).join('');
  $('#posDlgTitle').textContent = id ? 'Position bearbeiten' : 'Neue Position';
  f.name.value = p.name || '';
  f.isin.value = p.isin || '';
  f.wkn.value = p.wkn || '';
  f.symbol.value = p.symbol || '';
  f.type.value = p.type || 'Aktie';
  f.value.value = Number.isFinite(p.value) ? String(Math.round(p.value * 100) / 100).replace('.', ',') : '';
  f.weight.value = Number.isFinite(p.weight) ? String(Math.round(p.weight * 1000) / 1000).replace('.', ',') : '';
  f.quantity.value = Number.isFinite(p.quantity) ? String(p.quantity).replace('.', ',') : '';
  f.price.value = Number.isFinite(p.price) ? String(p.price).replace('.', ',') : '';
  f.searchTerm.value = p.searchTerm || '';
  f.newsEnabled.checked = p.newsEnabled !== false;
  $('#deletePosBtn').hidden = !id;
  $('#onlineCandidates').innerHTML = '';
  $('#onlineLookupStatus').textContent = '';
  editorQuote = null;
  $('#priceNote').textContent = p.priceAt ? fmtQuote(p) : '';
  $('#lookupIntro').hidden = !!id;
  lastLookup = '';
  updatePosHints();
  $('#posDlg').showModal();
}

// ---------------------------------------------------------------- Kurse (einmalig beim Einfügen)

function fmtQuote(p) {
  if (!Number.isFinite(p.price)) return '';
  const cur = p.priceCurrency || 'EUR';
  const price = cur === 'EUR' ? fmtMoney(p.price) : `${fmtNumber(p.price)} ${cur}`;
  const when = p.priceAt ? new Date(p.priceAt).toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit' }) : '';
  return `Kurs ${price}${p.priceMarket ? ' · ' + p.priceMarket : ''}${when ? ' · ' + when : ''}`;
}

function applyQuote(p, q) {
  if (!q) return false;
  p.price = q.price;
  p.priceCurrency = q.currency;
  p.priceMarket = q.market;
  p.priceAt = q.at;
  // Wert nur ergänzen, wenn er fehlt, die Stückzahl bekannt ist und der Kurs in Euro vorliegt
  if (!Number.isFinite(p.value) && Number.isFinite(p.quantity) && q.currency === 'EUR') p.value = p.quantity * q.price;
  return true;
}

let quoteRun = null;
/** Holt einmalig Kurse für Positionen ohne Kurs (z. B. nach dem Einlesen). Läuft im Hintergrund. */
function fetchMissingQuotes() {
  if (quoteRun) return quoteRun;
  const todo = state.portfolio.positions.filter(p => !p.priceAt && !p.priceTried && p.type !== 'Cash');
  if (!todo.length) return null;
  let done = 0, ok = 0;
  const status = () => { $('#quoteStatus').textContent = done < todo.length ? `Kurse werden geladen … (${done}/${todo.length})` : ''; };
  status();
  quoteRun = (async () => {
    let i = 0;
    await Promise.all(Array.from({ length: 3 }, async () => {
      while (i < todo.length) {
        const p = todo[i++];
        try { if (applyQuote(p, await fetchQuote(p))) ok++; } catch { /* Kurs bleibt leer */ }
        p.priceTried = true; // einmalig: nicht bei jedem Start erneut versuchen
        done++;
        status();
      }
    }));
    recomputeWeights(state.portfolio.positions);
    const gone = removeBelowMin(); // Werte aus Stückzahl × Kurs können unter der Grenze liegen
    save(true);
    renderAll();
    if (!$('#view-depot').hidden) renderDepot();
    toast(`${ok} von ${todo.length} Kursen geladen.${gone.length ? ` ${gone.length} Position(en) unter ${state.settings.minValue} € entfernt.` : ''}`);
  })().finally(() => { quoteRun = null; status(); });
  return quoteRun;
}

// ---------------------------------------------------------------- Online-Suche im Positionseditor

let lastLookup = '';
let lookupCandidates = [];
let lookupSeq = 0;

/** Startet die Online-Suche mit ISIN, WKN oder Name (in dieser Reihenfolge). */
async function runOnlineLookup({ auto = false } = {}) {
  const f = $('#posForm');
  const isin = f.isin.value.trim().toUpperCase();
  const wkn = f.wkn.value.trim().toUpperCase();
  const name = f.name.value.trim();
  const query = isValidIsin(isin) ? isin : looksLikeWkn(wkn) ? wkn : name;
  if (!query || query.length < 2) { if (!auto) $('#onlineLookupStatus').textContent = 'Bitte Name, ISIN oder WKN eingeben.'; return; }
  if (auto && query === lastLookup) return;
  lastLookup = query;
  const seq = ++lookupSeq;
  const status = $('#onlineLookupStatus');
  status.textContent = `Suche „${query}“ …`;
  $('#onlineLookupBtn').disabled = true;
  try {
    const { candidates, errors, hint } = await lookupSecurity(query);
    if (seq !== lookupSeq) return; // veraltete Antwort
    lookupCandidates = candidates;
    if (!candidates.length) {
      status.textContent = errors.length
        ? 'Online-Suche nicht erreichbar – Felder bitte von Hand ausfüllen.'
        : hint || 'Nichts gefunden. Tipp: ISIN eingeben oder den Namen genauer schreiben.';
      $('#onlineCandidates').innerHTML = '';
      return;
    }
    const exactId = isValidIsin(query) || looksLikeWkn(query);
    status.textContent = candidates.length === 1 || exactId ? 'Gefunden – übernommen:' : `${candidates.length} Treffer – bitte auswählen:`;
    $('#onlineCandidates').innerHTML = candidates.map((c, i) => `
      <button type="button" class="cand" data-cand="${i}">
        <b>${esc(c.name)}</b>
        <span class="muted small">${esc([c.isin, c.wkn && 'WKN ' + c.wkn, c.symbol && `${c.symbol}${c.exchange ? ' (' + c.exchange + ')' : ''}`, c.type, c.country].filter(Boolean).join(' · '))}</span>
        ${c.description ? `<span class="muted small">${esc(c.description)} · ${esc(c.source)}</span>` : `<span class="muted small">${esc(c.source)}</span>`}
      </button>`).join('');
    if (candidates.length === 1 || exactId) applyCandidate(0);
  } catch (e) {
    if (seq === lookupSeq) status.textContent = 'Online-Suche fehlgeschlagen: ' + e.message;
  } finally {
    if (seq === lookupSeq) $('#onlineLookupBtn').disabled = false;
  }
}

/** Übernimmt einen Treffer in die Felder; Eingaben des Nutzers bleiben erhalten, außer beim Namen neuer Positionen. */
let editorQuote = null;
/** Kurs zum gewählten Treffer holen und ins Feld „Kurs“ eintragen (einmalig). */
async function loadEditorQuote(c) {
  const note = $('#priceNote');
  const f = $('#posForm');
  editorQuote = null;
  note.textContent = 'Kurs wird gesucht …';
  try {
    const q = await fetchQuote(c);
    if (!q) { note.textContent = 'Kein aktueller Kurs gefunden.'; return; }
    editorQuote = q;
    f.price.value = String(q.price).replace('.', ',');
    note.textContent = fmtQuote({ price: q.price, priceCurrency: q.currency, priceMarket: q.market, priceAt: q.at });
    if (!f.value.value.trim() && parseNumber(f.quantity.value) !== null && q.currency === 'EUR') {
      f.value.value = String(Math.round(parseNumber(f.quantity.value) * q.price * 100) / 100).replace('.', ',');
    }
  } catch { note.textContent = 'Kurs konnte nicht geladen werden.'; }
}

function applyCandidate(i) {
  const c = lookupCandidates[i];
  if (!c) return;
  const f = $('#posForm');
  const fill = (field, value, force = false) => { if (value && (force || !f[field].value.trim())) f[field].value = value; };
  fill('name', c.name, !editingId);
  fill('isin', c.isin);
  fill('wkn', c.wkn || wknFromIsin(c.isin));
  fill('symbol', c.symbol);
  if (c.type) f.type.value = c.type;
  fill('searchTerm', c.searchTerm);
  $$('#onlineCandidates .cand').forEach(b => b.classList.toggle('picked', Number(b.dataset.cand) === i));
  loadEditorQuote(c);
  lastLookup = isValidIsin(f.isin.value.trim().toUpperCase()) ? f.isin.value.trim().toUpperCase() : lastLookup;
  updatePosHints();
}

function updatePosHints() {
  const f = $('#posForm');
  const isin = f.isin.value.trim().toUpperCase();
  const el = $('#isinCheck');
  if (!isin) el.textContent = '';
  else if (isValidIsin(isin)) { el.textContent = '✓ ISIN gültig'; el.className = 'small ok-text'; }
  else { el.textContent = '⚠ ISIN-Prüfziffer stimmt nicht (oder keine ISIN)'; el.className = 'small warn-text'; }
  const valueBased = state.portfolio.positions.length && state.portfolio.positions.every(p => Number.isFinite(p.value));
  $('#weightHint').textContent = valueBased
    ? 'Die Gewichtung wird automatisch aus den Werten aller Positionen berechnet.'
    : 'Ohne Werte bitte die Gewichtung direkt angeben.';
}

function savePosFromForm() {
  const f = $('#posForm');
  const isin = f.isin.value.trim().toUpperCase().replace(/\s/g, '');
  const data = {
    name: f.name.value.trim(),
    isin,
    wkn: f.wkn.value.trim().toUpperCase() || wknFromIsin(isin),
    symbol: f.symbol.value.trim(),
    type: f.type.value,
    value: parseNumber(f.value.value),
    weight: parseNumber(f.weight.value),
    quantity: parseNumber(f.quantity.value),
    price: parseNumber(f.price.value),
    newsEnabled: f.newsEnabled.checked
  };
  if (data.value === null && data.quantity !== null && data.price !== null) data.value = data.quantity * data.price;
  if (editorQuote && data.price === editorQuote.price) {
    Object.assign(data, { priceCurrency: editorQuote.currency, priceMarket: editorQuote.market, priceAt: editorQuote.at });
  }
  const term = f.searchTerm.value.trim();
  const ps = state.portfolio.positions;
  if (editingId) {
    const p = ps.find(x => x.id === editingId);
    const typeChanged = p.type !== data.type;
    Object.assign(p, data);
    if (typeChanged) p.typeCustom = true;
    p.searchTermCustom = term !== suggestSearchTerm(p);
    p.searchTerm = term || suggestSearchTerm(p);
    p.isinValid = isValidIsin(p.isin);
  } else {
    const p = recognize({ ...data, id: uid(), manual: true });
    p.type = data.type;
    p.searchTerm = term || suggestSearchTerm(p);
    p.searchTermCustom = !!term && term !== suggestSearchTerm(p);
    ps.push(p);
  }
  recomputeWeights(ps);
  state.portfolio.updatedAt = Date.now();
  state.onboarded = true;
  save(true);
  renderAll();
  renderDepot();
  autoBackup();
  toast('Position gespeichert.');
  // Neue Position ohne Kurs: Kurs einmalig im Hintergrund holen
  setTimeout(fetchMissingQuotes, 200);
}

// ---------------------------------------------------------------- News

async function refreshNews({ silent = false } = {}) {
  if (refreshing) return;
  if (!state.portfolio.positions.length) { if (!silent) toast('Bitte zuerst ein Depot laden.'); return; }
  if (!navigator.onLine) { if (!silent) toast('Keine Internetverbindung.'); return; }
  refreshing = new AbortController();
  const btn = $('#refreshBtn');
  btn.classList.add('spin');
  btn.disabled = true;
  const prog = $('#progress');
  prog.hidden = false;
  $('.bar', prog).style.width = '3%';
  $('#newsStatus').textContent = 'Lade News …';
  try {
    const { items, errors, poolInfo } = await fetchNews({
      positions: state.portfolio.positions,
      sources: state.sources,
      settings: state.settings,
      signal: refreshing.signal,
      onProgress: (done, total) => {
        $('.bar', prog).style.width = `${Math.max(3, Math.round(done / Math.max(1, total) * 100))}%`;
        $('#newsStatus').textContent = `Lade News … (${done}/${total})`;
      }
    });
    const firstFetch = !state.news.fetchedAt;
    const known = new Set(state.news.known);
    const byId = new Map(state.news.items.map(i => [i.id, i]));
    const fresh = [];
    for (const it of items) {
      const prev = byId.get(it.id);
      if (prev) prev.positionIds = [...new Set([...prev.positionIds, ...it.positionIds])];
      else byId.set(it.id, it);
      if (!known.has(it.id)) { fresh.push(it); known.add(it.id); }
    }
    const cutoff = Date.now() - Math.max(state.settings.timespanDays, 7) * 86400000;
    state.news.items = [...byId.values()].filter(i => i.ts >= cutoff).sort((a, b) => b.ts - a.ts);
    state.news.known = [...known];
    state.news.fetchedAt = Date.now();
    state.news.errors = errors;
    state.news.poolInfo = poolInfo || null;
    save(true);
    renderAll();
    if (!firstFetch && fresh.length) notifyNew(fresh);
    if (!silent) toast(fresh.length ? `${fresh.length} neue Artikel` : 'Keine neuen Artikel');
  } catch (e) {
    console.error(e);
    state.news.errors = [e.message];
    renderNews();
  } finally {
    refreshing = null;
    btn.classList.remove('spin');
    btn.disabled = false;
    prog.hidden = true;
  }
}

async function notifyNew(items) {
  const s = state.settings;
  if (!s.notify || !('Notification' in window) || Notification.permission !== 'granted') return;
  const map = newsPosById();
  const relevant = collapseSimilar(rankNews(items, map, s.bucket)).filter(it => it.weight >= (s.notifyMinWeight || 0));
  if (!relevant.length) return;
  const reg = await navigator.serviceWorker?.getRegistration();
  const show = (title, opts) => (reg ? reg.showNotification(title, opts) : new Notification(title, opts));
  const top = relevant.slice(0, 3);
  for (const it of top) {
    const p = map.get(it.positionIds[0]);
    show(`${p?.name || 'Depot'} (${fmtPercent(p?.weight, 1)}) – ${it.sourceName}`, {
      body: it.title, tag: it.id, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png', data: { url: it.url }
    });
  }
  if (relevant.length > top.length) {
    show('Depot-News', { body: `${relevant.length} neue Artikel zu deinen Positionen`, tag: 'summary', icon: 'icons/icon-192.png', data: { url: './' } });
  }
}

function scheduleAutoRefresh() {
  clearInterval(autoTimer);
  const min = Number(state.settings.autoRefreshMin) || 0;
  if (!min) return;
  autoTimer = setInterval(() => {
    if (document.visibilityState === 'visible') refreshNews({ silent: true });
  }, min * 60000);
}

// ---------------------------------------------------------------- Onboarding & Start

function openOnboarding() {
  $('#dirUnsupported').hidden = supportsDir;
  $('#obDirBtn').hidden = !supportsDir;
  $('#onboardDlg').showModal();
}

function askForNewVersion() {
  const src = state.portfolio.source;
  if (!state.settings.askOnStart || !src || src.kind === 'dir') return;
  const text = src.kind === 'sample'
    ? 'Du nutzt das <strong>Musterdepot</strong>. Eigene Depot-Tabelle einlesen?'
    : `Gibt es eine neue Version von „${esc(src.fileName)}“? (zuletzt eingelesen ${esc(timeAgo(src.importedAt))})`;
  showBanner(text, [
    { label: 'Datei wählen', primary: true, onClick: () => pickFile('import') },
    ...(supportsDir ? [{ label: 'Verzeichnis', onClick: chooseDirectory }] : []),
    { label: 'Nein', onClick: () => {} }
  ]);
}

function bindEvents() {
  $$('.tabbar button').forEach(b => b.addEventListener('click', () => showTab(b.dataset.tab)));
  $('#refreshBtn').addEventListener('click', () => refreshNews());
  $('#rankInfoBtn').addEventListener('click', () => $('#rankDlg').showModal());

  // Onboarding
  $('#obDirBtn').addEventListener('click', async () => { if (await chooseDirectory()) $('#onboardDlg').close(); });
  $('#obFileBtn').addEventListener('click', () => { $('#onboardDlg').close(); pickFile('import'); });
  $('#obSkipBtn').addEventListener('click', async () => {
    $('#onboardDlg').close();
    await loadSample();
    refreshNews({ silent: true });
  });
  $('#onboardDlg').addEventListener('cancel', e => { if (!state.onboarded) e.preventDefault(); });

  // Dateien
  $('#fileInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    if (!file) { if (!state.onboarded) openOnboarding(); return; }
    const ok = await handleFile(file, { kind: 'file' });
    if (!ok && !state.onboarded) openOnboarding();
  });
  $('#importDlg').addEventListener('close', () => {
    const dlg = $('#importDlg');
    if (dlg.returnValue === 'ok' && pendingImport) {
      const mode = $('input[name=mode]:checked', dlg).value;
      if (state.portfolio.source?.kind === 'sample' && mode === 'replace') state.portfolio.name = 'Mein Depot';
      applyImport(pendingImport.res, mode, pendingImport.kind);
      toast(`${pendingImport.res.positions.length} Positionen übernommen.`);
      showTab('news');
      refreshNews({ silent: true });
    } else if (!state.onboarded) openOnboarding();
    pendingImport = null;
  });
  $('#fileInput').addEventListener('cancel', () => { if (!state.onboarded) openOnboarding(); });
  $('#backupInput').addEventListener('change', e => { const f = e.target.files[0]; if (f) restoreFromFile(f); });

  // Lookup + Umschalter
  $('#lookupInput').addEventListener('input', renderLookup);
  $('#modeSwitch').addEventListener('change', e => {
    state.settings.displayMode = e.target.checked ? 'value' : 'percent';
    save();
    renderAll();
  });
  $$('.toggle-label').forEach(l => l.addEventListener('click', () => {
    state.settings.displayMode = l.dataset.for;
    save();
    renderAll();
  }));

  // Delegierte Klicks
  document.addEventListener('click', e => {
    const t = e.target.closest('[data-act], [data-pos], a[data-id]');
    if (!t) return;
    if (t.matches('a[data-id]')) {
      if (!state.news.read.includes(t.dataset.id)) { state.news.read.push(t.dataset.id); save(); }
      setTimeout(renderNews, 300);
      return;
    }
    const act = t.dataset.act;
    if (act === 'refresh') refreshNews();
    else if (act === 'onboard') openOnboarding();
    else if (act === 'filter') { newsFilter = t.dataset.pos; renderNews(); $('#filterChip').scrollIntoView({ behavior: 'smooth' }); }
    else if (act === 'edit') openPosEditor(t.dataset.pos);
    else if (act === 'add-from-lookup') {
      const q = $('#lookupInput').value.trim();
      const up = q.toUpperCase();
      openPosEditor(null, isValidIsin(up) ? { isin: up, wkn: wknFromIsin(up) } : looksLikeWkn(up) ? { wkn: up } : { name: q });
    } else if (t.classList.contains('chip') && t.dataset.pos) { newsFilter = t.dataset.pos; renderNews(); window.scrollTo({ top: 0, behavior: 'smooth' }); }
    else if (t.classList.contains('pos')) openPosEditor(t.dataset.pos);
  });

  // Depot
  $('#importBtn').addEventListener('click', async () => {
    if (!supportsDir) return pickFile('import');
    const c = await choose('Depot einlesen', [dirHandle ? `Aus „${dirHandle.name}“ neu einlesen` : 'Verzeichnis wählen', 'Datei wählen', 'Musterdepot laden']);
    if (c === 0) { if (dirHandle && (await dirHandle.requestPermission({ mode: 'readwrite' })) === 'granted') { const f = await newestTableFile(dirHandle); if (f) await handleFile(f, { kind: 'dir' }); else toast('Keine Tabelle gefunden.'); } else chooseDirectory(); }
    if (c === 1) pickFile('import');
    if (c === 2) loadSample();
  });
  $('#addPosBtn').addEventListener('click', () => openPosEditor(null));
  $('#exportPosBtn').addEventListener('click', exportPositions);

  $('#depotFilter').addEventListener('input', renderDepot);
  $('#positionList').addEventListener('change', e => {
    const id = e.target.dataset.news;
    if (id) setNewsEnabled([id], e.target.checked);
  });
  $('#newsAllOn').addEventListener('click', () => setNewsEnabled(state.portfolio.positions.map(p => p.id), true));
  $('#newsAllOff').addEventListener('click', () => {
    if (confirm('Für alle Positionen keine News mehr anzeigen?')) setNewsEnabled(state.portfolio.positions.map(p => p.id), false);
  });
  $('#importReport').addEventListener('change', e => {
    if (e.target.dataset.col !== undefined && pendingImport) {
      reparseImport({ changedCol: Number(e.target.dataset.col), field: e.target.value || null });
      return;
    }
    if (e.target.id === 'impSheet' && pendingImport) { reparseImport({ sheet: e.target.value }); return; }
    if (e.target.id === 'impTranspose' && pendingImport) { reparseImport({ orientation: e.target.checked ? 'cols' : 'rows' }); return; }
    const i = e.target.dataset.imp;
    if (i === undefined || !pendingImport) return;
    pendingImport.res.positions[Number(i)].newsChoice = e.target.checked;
    updateImpCount();
  });
  $('#importReport').addEventListener('click', e => {
    const v = e.target.dataset.impAll;
    if (v === undefined || !pendingImport) return;
    pendingImport.res.positions.forEach(p => { p.newsChoice = v === '1'; });
    $$('#importReport input[data-imp]').forEach(inp => { inp.checked = v === '1'; });
    updateImpCount();
  });
  $('#depotSort').addEventListener('change', renderDepot);

  // Positionseditor
  const pf = $('#posForm');
  pf.isin.addEventListener('input', () => {
    const v = pf.isin.value.trim().toUpperCase();
    if (!pf.wkn.value && wknFromIsin(v)) pf.wkn.value = wknFromIsin(v);
    updatePosHints();
    if (isValidIsin(v)) runOnlineLookup({ auto: true }); // vollständige ISIN → automatisch suchen
  });
  pf.wkn.addEventListener('input', () => {
    if (pf.wkn.value.trim().length === 6 && looksLikeWkn(pf.wkn.value.trim()) && !isValidIsin(pf.isin.value.trim().toUpperCase())) runOnlineLookup({ auto: true });
  });
  pf.name.addEventListener('change', () => {
    // Neue Position, nur Name eingegeben → automatisch Vorschläge holen
    if (!editingId && !pf.isin.value.trim() && !pf.wkn.value.trim()) runOnlineLookup({ auto: true });
  });
  $('#onlineLookupBtn').addEventListener('click', () => { lastLookup = ''; runOnlineLookup(); });
  $('#onlineCandidates').addEventListener('click', e => {
    const b = e.target.closest('[data-cand]');
    if (b) applyCandidate(Number(b.dataset.cand));
  });
  $('#suggestTermBtn').addEventListener('click', () => {
    pf.searchTerm.value = suggestSearchTerm({ name: pf.name.value, isin: pf.isin.value.toUpperCase(), type: pf.type.value });
  });
  $('#deletePosBtn').addEventListener('click', () => {
    const p = state.portfolio.positions.find(x => x.id === editingId);
    if (!p || !confirm(`„${p.name}“ löschen?`)) return;
    state.portfolio.positions = state.portfolio.positions.filter(x => x.id !== editingId);
    recomputeWeights(state.portfolio.positions);
    save(true);
    $('#posDlg').close('deleted');
    renderAll();
    renderDepot();
    autoBackup();
  });
  $('#posDlg').addEventListener('close', () => {
    if ($('#posDlg').returnValue === 'ok') savePosFromForm();
    $('#posDlg').returnValue = '';
  });

  // Quellen
  $('#sourceList').addEventListener('change', e => {
    const id = e.target.dataset.src;
    const s = state.sources.find(x => x.id === id);
    if (s) { s.enabled = e.target.checked; save(); }
  });
  $('#sourceList').addEventListener('click', e => {
    const id = e.target.dataset.delSrc;
    if (!id) return;
    state.sources = state.sources.filter(s => s.id !== id);
    save();
    renderSources();
  });
  $('#sourceForm').addEventListener('submit', e => {
    e.preventDefault();
    const f = e.target;
    const domain = normalizeDomain(f.domain.value);
    if (!domain || !domain.includes('.')) { toast('Bitte eine gültige Domain angeben, z. B. beispiel.de'); return; }
    if (state.sources.some(s => s.domain === domain)) { toast('Diese Quelle ist bereits vorhanden.'); return; }
    const rss = f.rss.value.trim();
    if (rss && !/^https?:\/\//i.test(rss)) { toast('Der RSS-Feed muss mit https:// beginnen.'); return; }
    state.sources.push({ id: uid(), name: f.name.value.trim(), domain, lang: f.lang.value, rss, enabled: true, builtin: false, category: 'Eigene Quelle' });
    save();
    f.reset();
    renderSources();
    toast('Quelle hinzugefügt.');
  });
  $('#resetSourcesBtn').addEventListener('click', () => {
    if (!confirm('Vorgeschlagene Quellen auf Standard zurücksetzen? Eigene Quellen bleiben erhalten.')) return;
    const custom = state.sources.filter(s => !s.builtin);
    state.sources = [...DEFAULT_SOURCES.map(s => ({ id: uid(), builtin: true, ...s })), ...custom];
    save();
    renderSources();
  });

  // Einstellungen
  $('#settingsForm').addEventListener('change', async e => {
    const f = e.currentTarget;
    const s = state.settings;
    s.languages = [f.lang_de.checked && 'de', f.lang_en.checked && 'en'].filter(Boolean);
    if (!s.languages.length) { s.languages = ['de']; f.lang_de.checked = true; }
    s.timespanDays = Number(f.timespanDays.value);
    s.bucket = f.bucket.value;
    s.autoRefreshMin = Number(f.autoRefreshMin.value);
    s.askOnStart = f.askOnStart.checked;
    s.notifyMinWeight = Number(f.notifyMinWeight.value) || 0;
    const oldMinValue = Number(s.minValue) || 0;
    s.minValue = Math.max(0, Number(String(f.minValue.value).replace(',', '.')) || 0);
    if (s.minValue > oldMinValue) {
      const affected = state.portfolio.positions.filter(belowMin);
      if (affected.length && confirm(`${affected.length} eingelesene Position(en) liegen unter ${s.minValue} €:\n${affected.map(p => p.name).join(', ')}\n\nJetzt entfernen?`)) {
        removeBelowMin();
        save(true);
        renderAll();
        toast(`${affected.length} Position(en) entfernt.`);
      }
    }
    const oldMin = s.watchMinWeight;
    s.watchMinWeight = Math.max(0, Number(String(f.watchMinWeight.value).replace(',', '.')) || 0);
    if (s.watchMinWeight < oldMin) setTimeout(() => refreshNews({ silent: true }), 300); // neue Positionen in der Suchliste
    if (e.target.name === 'notify') {
      if (f.notify.checked) {
        if (!('Notification' in window)) { f.notify.checked = false; toast('Benachrichtigungen werden hier nicht unterstützt.'); }
        else {
          const p = await Notification.requestPermission();
          f.notify.checked = p === 'granted';
          if (p !== 'granted') toast('Benachrichtigungen wurden nicht erlaubt.');
        }
      }
      s.notify = f.notify.checked;
    }
    save();
    scheduleAutoRefresh();
    renderSettings();
    renderNews();
  });
  $('#testNotifyBtn').addEventListener('click', async () => {
    if (!('Notification' in window)) return toast('Benachrichtigungen werden hier nicht unterstützt.');
    if (Notification.permission !== 'granted' && (await Notification.requestPermission()) !== 'granted') return toast('Nicht erlaubt.');
    const reg = await navigator.serviceWorker?.getRegistration();
    const opts = { body: 'So sehen Benachrichtigungen zu neuen News aus.', icon: 'icons/icon-192.png', data: { url: './' } };
    reg ? reg.showNotification('Depot-News', opts) : new Notification('Depot-News', opts);
  });
  $('#backupBtn').addEventListener('click', manualBackup);
  $('#restoreBtn').addEventListener('click', () => { $('#backupInput').value = ''; $('#backupInput').click(); });
  $('#chooseDirBtn').addEventListener('click', chooseDirectory);
  $('#forgetDirBtn').addEventListener('click', async () => { await idbDel('dir'); dirHandle = null; renderSettings(); });
  $('#autoBackupChk').addEventListener('change', e => { state.settings.autoBackup = e.target.checked; save(); if (e.target.checked) autoBackup(); });
  $('#onboardAgainBtn').addEventListener('click', openOnboarding);
  $('#wipeBtn').addEventListener('click', async () => {
    if (!confirm('Wirklich alle lokal gespeicherten Daten (Depot, Quellen, Einstellungen, News) löschen?')) return;
    await clearAll();
    state = defaultState();
    dirHandle = null;
    newsFilter = null;
    renderAll();
    showTab('news');
    openOnboarding();
  });

  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    const min = Number(state.settings.autoRefreshMin) || 0;
    if (min && state.news.fetchedAt && Date.now() - state.news.fetchedAt > min * 60000) refreshNews({ silent: true });
  });
}

async function init() {
  bindEvents();
  renderAll();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(e => console.warn('SW', e));
  }
  if (!state.onboarded) {
    openOnboarding();
    return;
  }
  const hasDir = supportsDir && await checkDirectoryOnStart();
  if (!hasDir) askForNewVersion();
  scheduleAutoRefresh();
  const min = Number(state.settings.autoRefreshMin) || 30;
  const stale = !state.news.fetchedAt || Date.now() - state.news.fetchedAt > min * 60000
    || (state.portfolio.updatedAt || 0) > state.news.fetchedAt; // Depot seit letztem Abruf geändert
  if (stale) refreshNews({ silent: true });
}

init();
