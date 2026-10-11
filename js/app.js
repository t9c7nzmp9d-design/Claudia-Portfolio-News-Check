// Hauptlogik der Oberfläche.

import { $, $$, esc, uid, parseNumber, fmtMoney, fmtPercent, fmtDateTime, timeAgo, norm, downloadBlob, todayStamp } from './util.js';
import { importFile, recomputeWeights, FIELD_LABELS } from './parser.js';
import { recognize, suggestSearchTerm, isValidIsin, looksLikeWkn, wknFromIsin, ASSET_TYPES } from './assets.js';
import { fetchNews, rankNews, bucketLabel } from './news.js';
import { DEFAULT_SOURCES, normalizeDomain } from './sources.js';
import { loadState, saveState, defaultState, buildBackup, restoreBackup, clearAll, idbGet, idbSet, idbDel } from './store.js';

const APP_VERSION = '1.1.0';
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
const newsPosById = () => new Map(state.portfolio.positions.filter(newsOn).map(p => [p.id, p]));
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
  return new Set([...state.portfolio.positions].filter(p => p.newsEnabled !== false && p.type !== 'Cash')
    .sort((a, b) => (b.weight || 0) - (a.weight || 0)).slice(0, state.settings.maxPositions).map(p => p.id));
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
      <div class="meta"><span class="src">${esc(it.sourceName)}</span> · <time datetime="${new Date(it.ts).toISOString()}" title="${esc(fmtDateTime(it.ts))}">${esc(timeAgo(it.ts))}</time></div>
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
      ${top.has(p.id) ? '' : `<p class="muted small hit-note">Für diese Position werden keine News abgerufen (${p.newsEnabled === false ? 'deaktiviert' : `nicht unter den ${state.settings.maxPositions} größten Positionen – unter „Mehr“ anpassbar`}).</p>`}
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
    <li class="pos-row ${newsOn(p) ? '' : 'news-off'}"><button type="button" class="pos" data-pos="${esc(p.id)}">
      <div class="pos-main">
        <span class="pos-name">${esc(p.name)}</span>
        <span class="muted small">${esc([p.type, p.isin || p.wkn || p.symbol].filter(Boolean).join(' · '))}${p.manual ? ' · manuell' : ''}${newsOn(p) && !topIds.has(p.id) ? ` · außerhalb der Top ${state.settings.maxPositions}` : ''}</span>
        <span class="wbar"><span style="width:${Math.max(1, (p.weight || 0) / maxW * 100).toFixed(1)}%"></span></span>
      </div>
      <div class="pos-num"><b>${esc(fmtPercent(p.weight))}</b><span class="muted small">${esc(Number.isFinite(p.value) ? fmtMoney(p.value) : '')}</span></div>
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
  f.provider.value = s.provider;
  f.proxyUrl.value = s.proxyUrl;
  f.lang_de.checked = s.languages.includes('de');
  f.lang_en.checked = s.languages.includes('en');
  f.timespanDays.value = String(s.timespanDays);
  f.maxPositions.value = s.maxPositions;
  f.bucket.value = s.bucket;
  f.autoRefreshMin.value = String(s.autoRefreshMin);
  f.askOnStart.checked = s.askOnStart;
  f.notify.checked = s.notify && ('Notification' in window) && Notification.permission === 'granted';
  f.notifyMinWeight.value = s.notifyMinWeight;
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
      typeCustom: !!o.typeCustom
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
  recomputeWeights(result);
  state.portfolio.positions = result;
  state.portfolio.source = {
    kind, fileName: res.fileName, lastModified: res.lastModified, importedAt: Date.now(),
    sheet: res.sheet, sheetCount: res.sheetCount, mapping: res.mapping, transposed: res.transposed
  };
  state.portfolio.updatedAt = Date.now();
  state.onboarded = true;
  save(true);
  renderAll();
  autoBackup();
}

function importReportHtml(res) {
  const cols = Object.entries(res.mapping).sort((a, b) => a[1] - b[1]).map(([f, c]) => {
    const head = res.headerCells?.[c];
    return `<li><b>${esc(FIELD_LABELS[f] || f)}</b> ← ${head ? '„' + esc(head) + '“' : 'Spalte ' + (c + 1)}</li>`;
  }).join('');
  // Vorbelegung: bisherige Auswahl bei bekannten Positionen, sonst an (Cash aus)
  const old = state.portfolio.positions;
  for (const p of res.positions) {
    const o = old.find(x => keyMatches(x, p));
    p.newsChoice ??= o ? o.newsEnabled !== false : p.type !== 'Cash';
  }
  const rows = res.positions.map((p, i) => ({ p, i })).sort((a, b) => b.p.weight - a.p.weight).map(({ p, i }) =>
    `<tr><td>${esc(p.name)}<div class="muted small">${esc(p.type)}</div></td><td class="num">${esc(fmtPercent(p.weight))}</td>
      <td class="num">${newsSwitch(String(i), p.newsChoice, p.name, 'data-imp')}</td></tr>`).join('');
  const types = Object.entries(res.positions.reduce((m, p) => { m[p.type] = (m[p.type] || 0) + 1; return m; }, {}))
    .map(([t, n]) => `${n}× ${t}`).join(', ');
  return `<p><strong>${esc(res.fileName)}</strong>${res.sheetCount > 1 ? ` – Blatt „${esc(res.sheet)}“` : ''}:
      ${res.positions.length} Positionen erkannt (${esc(types)}).${res.transposed ? ' <em>Tabelle war gedreht (Felder in Zeilen) – automatisch umgestellt.</em>' : ''}</p>
    <details><summary>Erkannte Spalten</summary><ul class="small">${cols}</ul></details>
    <div class="row-between imp-head">
      <strong>News pro Position</strong>
      <span><button type="button" class="link-btn small" data-imp-all="1">Alle an</button> · <button type="button" class="link-btn small" data-imp-all="0">Alle aus</button></span>
    </div>
    <p class="muted small">Schalter aus = für diese Position keine News. Jederzeit änderbar unter „Depot“.</p>
    <div class="imp-scroll"><table class="mini"><thead><tr><th>Position</th><th class="num">Anteil</th><th class="num">News</th></tr></thead><tbody>${rows}</tbody></table></div>
    <p id="impCount" class="muted small"></p>
    ${res.warnings?.length ? `<p class="warn-text small">${res.warnings.map(esc).join('<br>')}</p>` : ''}`;
}

function updateImpCount() {
  const ps = pendingImport?.res.positions || [];
  $('#impCount').textContent = `News für ${ps.filter(p => p.newsChoice).length} von ${ps.length} Positionen`;
}

async function handleFile(file, { auto = false, kind = 'file' } = {}) {
  try {
    const res = await importFile(file);
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
    toast('Fehler beim Einlesen: ' + e.message, 7000);
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

async function exportPositions() {
  const choice = await choose('Positionen exportieren', ['Excel (.xlsx)', 'CSV (Semikolon)']);
  if (choice < 0) return;
  const rows = state.portfolio.positions.map(p => ({
    ISIN: p.isin || '', WKN: p.wkn || '', Symbol: p.symbol || '', Name: p.name, Typ: p.type || '',
    'Wert (EUR)': Number.isFinite(p.value) ? Math.round(p.value * 100) / 100 : '',
    'Gewicht (%)': Number.isFinite(p.weight) ? Math.round(p.weight * 10000) / 10000 : '',
    'Stück': Number.isFinite(p.quantity) ? p.quantity : '', Suchbegriff: p.searchTerm || ''
  }));
  const base = `depot_${todayStamp()}`;
  if (choice === 0) {
    const ws = window.XLSX.utils.json_to_sheet(rows);
    const wb = window.XLSX.utils.book_new();
    window.XLSX.utils.book_append_sheet(wb, ws, 'Depot');
    const out = window.XLSX.write(wb, { bookType: 'xlsx', type: 'array' });
    downloadBlob(new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), base + '.xlsx');
  } else {
    const head = Object.keys(rows[0] || { Name: '' });
    const cell = v => {
      const s = typeof v === 'number' ? String(v).replace('.', ',') : String(v ?? '');
      return /[;"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = '﻿' + [head.join(';'), ...rows.map(r => head.map(h => cell(r[h])).join(';'))].join('\r\n');
    downloadBlob(new Blob([csv], { type: 'text/csv;charset=utf-8' }), base + '.csv');
  }
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
  updatePosHints();
  $('#posDlg').showModal();
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
    const { items, errors } = await fetchNews({
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
  const relevant = rankNews(items, map, s.bucket).filter(it => it.weight >= (s.notifyMinWeight || 0));
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
    await handleFile(file, { kind: 'file' });
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
    s.provider = f.provider.value;
    s.proxyUrl = f.proxyUrl.value.trim();
    s.languages = [f.lang_de.checked && 'de', f.lang_en.checked && 'en'].filter(Boolean);
    if (!s.languages.length) { s.languages = ['de']; f.lang_de.checked = true; }
    s.timespanDays = Number(f.timespanDays.value);
    s.maxPositions = Math.max(1, Math.min(100, Number(f.maxPositions.value) || 20));
    s.bucket = f.bucket.value;
    s.autoRefreshMin = Number(f.autoRefreshMin.value);
    s.askOnStart = f.askOnStart.checked;
    s.notifyMinWeight = Number(f.notifyMinWeight.value) || 0;
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
    if (s.provider === 'gnews' && !s.proxyUrl) toast('Für Google News bitte einen CORS-Proxy eintragen (siehe README).', 6000);
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
