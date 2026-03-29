/* ── ui.js ── DOM rendering, cards, detail panel, pagination ──── */

import { findTaxonomy } from './taxonomy.js';
import { fetchObj } from './api.js';

export const $ = id => document.getElementById(id);

export function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                  .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

/* ── Toast / notification system ──────────────────────────────── */
let _toastContainer = null;

function ensureToastContainer() {
  if (_toastContainer) return _toastContainer;
  _toastContainer = document.createElement('div');
  _toastContainer.id = 'toast-container';
  document.body.appendChild(_toastContainer);
  return _toastContainer;
}

export function showToast(message, type = 'error', duration = 5000) {
  const container = ensureToastContainer();
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.innerHTML = `<span class="toast-msg">${esc(message)}</span><button class="toast-close" aria-label="Dismiss">&times;</button>`;
  toast.querySelector('.toast-close').addEventListener('click', () => {
    toast.classList.add('toast-exit');
    setTimeout(() => toast.remove(), 300);
  });
  container.appendChild(toast);
  // Auto-dismiss
  if (duration > 0) {
    setTimeout(() => {
      if (toast.parentNode) {
        toast.classList.add('toast-exit');
        setTimeout(() => toast.remove(), 300);
      }
    }, duration);
  }
}

/* ── State ────────────────────────────────────────────────────── */
const PAGE_SIZE = 15;
let _allMatches = [];
let _currentPage = 1;
let _pageCache = {};
let _activeCard = null;

export function getAllMatches() { return _allMatches; }
export function setAllMatches(m) { _allMatches = m; _currentPage = 1; _pageCache = {}; window._metObjects = {}; }
export function getCurrentPage() { return _currentPage; }

function totalPages() { return Math.ceil(_allMatches.length / PAGE_SIZE); }

/* ── Random suggestions ───────────────────────────────────────── */
export function getRandomSuggestions(n) {
  const all = window._birdSuggestions || [];
  if (!all.length) return [];
  const shuffled = [...all].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

/* ── Grid ─────────────────────────────────────────────────────── */
function buildCardHtml(obj) {
  const imgSrc = obj.primaryImageSmall || obj.primaryImage;
  const isFallback = obj._fallback;
  return `
  <div class="art-card${isFallback ? ' fallback' : ''}" id="card-${obj.objectID}" data-artwork-id="${obj.objectID}">
    ${imgSrc
      ? `<img class="art-thumb" src="${esc(imgSrc)}" alt="${esc(obj.title)}" loading="lazy" />
        <div class="art-thumb-ph" style="display:none">🖼</div>`
      : `<div class="art-thumb-ph" style="display:flex">🖼</div>`}
    <div class="art-info">
      <div class="art-name">${esc(obj.title) || 'Untitled'}</div>
      <div class="art-artist">${isFallback ? '<em style="color:var(--muted);font-size:.68rem">Loading details…</em>' : (esc(obj.artistDisplayName) || 'Unknown artist')}</div>
      <div class="art-date">${esc(obj.objectDate)}</div>
    </div>
  </div>`;
}

export function renderGrid(objects) {
  if (!objects.length) {
    $('art-grid').innerHTML = `<div class="state-box"><div class="state-icon">🎨</div><div class="state-title">No images available</div><div class="state-msg">Matches found but none have public-domain images.</div></div>`;
    return;
  }
  $('art-grid').innerHTML = objects.map(buildCardHtml).join('');

  // For fallback cards, retry fetching details in the background
  const fallbacks = objects.filter(o => o._fallback);
  if (fallbacks.length) {
    setTimeout(() => retryFallbacks(fallbacks), 2000);
  }
}

async function retryFallbacks(fallbacks) {
  for (const fb of fallbacks) {
    if (window.BIRD_PLATES?.[fb.objectID]) continue;
    try {
      const r = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${fb.objectID}`);
      const data = await r.json();
      if (data && data.objectID) {
        try { sessionStorage.setItem(`met_${data.objectID}`, JSON.stringify(data)); } catch {}
        delete data._fallback;
        window._metObjects[data.objectID] = data;
        for (const pg in _pageCache) {
          const idx = _pageCache[pg].findIndex(o => o.objectID === data.objectID);
          if (idx !== -1) { _pageCache[pg][idx] = data; break; }
        }
        const card = $(`card-${data.objectID}`);
        if (card) card.outerHTML = buildCardHtml(data);
      }
    } catch { /* ignore retry failure */ }
    await new Promise(ok => setTimeout(ok, 500));
  }
}

/* ── Pagination ───────────────────────────────────────────────── */
function buildPageRange(current, total) {
  const pages = new Set([1, total]);
  for (let i = current - 2; i <= current + 2; i++) {
    if (i >= 1 && i <= total) pages.add(i);
  }
  const sorted = [...pages].sort((a, b) => a - b);
  const result = [];
  for (let i = 0; i < sorted.length; i++) {
    if (i > 0 && sorted[i] - sorted[i - 1] > 1) result.push('...');
    result.push(sorted[i]);
  }
  return result;
}

function renderPagination() {
  const pages = totalPages();
  const pg = $('pagination');
  if (pages <= 1) { pg.classList.remove('visible'); return; }
  pg.classList.add('visible');

  let html = '';
  html += `<button class="pg-btn pg-arrow" data-page="${_currentPage - 1}" ${_currentPage === 1 ? 'disabled' : ''}>&#8249;</button>`;

  const range = buildPageRange(_currentPage, pages);
  for (const item of range) {
    if (item === '...') {
      html += `<span class="pg-dots">…</span>`;
    } else {
      html += `<button class="pg-btn${item === _currentPage ? ' active' : ''}" data-page="${item}">${item}</button>`;
    }
  }

  html += `<button class="pg-btn pg-arrow" data-page="${_currentPage + 1}" ${_currentPage === pages ? 'disabled' : ''}>&#8250;</button>`;
  pg.innerHTML = html;
}

function showPage(objects) {
  const start = (_currentPage - 1) * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, _allMatches.length);
  $('art-count').textContent = `${start + 1}–${end} of ${_allMatches.length.toLocaleString()}`;
  renderGrid(objects);
  $('art-grid').scrollTop = 0;
}

function prefetchNextPage(page) {
  const next = page + 1;
  if (next > totalPages() || _pageCache[next]) return;
  const start = (next - 1) * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, _allMatches.length);
  const items = _allMatches.slice(start, end);
  Promise.all(items.map(item => fetchObj(item.id))).then(results => {
    if (_pageCache[next]) return;
    const objs = [];
    for (let j = 0; j < results.length; j++) {
      const obj = results[j];
      const indexItem = items[j];
      if (obj && obj.objectID) {
        objs.push(obj);
        window._metObjects[obj.objectID] = obj;
      } else {
        const fb = { objectID: indexItem.id, title: indexItem.title, _fallback: true };
        objs.push(fb);
        window._metObjects[fb.objectID] = fb;
      }
    }
    _pageCache[next] = objs;
  }).catch(() => {});
}

export async function goToPage(page) {
  if (page < 1 || page > totalPages()) return;
  _currentPage = page;

  const start = (page - 1) * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, _allMatches.length);
  const pageItems = _allMatches.slice(start, end);

  $('art-count').textContent = `${start + 1}–${end} of ${_allMatches.length.toLocaleString()}`;
  renderPagination();

  if (_pageCache[page]) {
    showPage(_pageCache[page]);
    prefetchNextPage(page);
    return;
  }

  $('art-grid').innerHTML = `<div class="state-box"><div class="spinner"></div><div class="state-msg">Loading ${start + 1}–${end} of ${_allMatches.length.toLocaleString()}…</div></div>`;

  const objects = [];
  for (let i = 0; i < pageItems.length; i += 5) {
    const batch = pageItems.slice(i, i + 5);
    const results = await Promise.all(batch.map(item => fetchObj(item.id)));
    for (let j = 0; j < results.length; j++) {
      const obj = results[j];
      const indexItem = batch[j];
      if (obj && obj.objectID) {
        objects.push(obj);
        window._metObjects[obj.objectID] = obj;
      } else {
        const fb = { objectID: indexItem.id, title: indexItem.title, _fallback: true };
        objects.push(fb);
        window._metObjects[fb.objectID] = fb;
      }
    }
  }

  _pageCache[page] = objects;
  showPage(objects);
  prefetchNextPage(page);
}

/* ── Detail panel ─────────────────────────────────────────────── */
// _seriesIndex is set from search.js after it's built
let _seriesIndex = [];
export function setSeriesIndex(idx) { _seriesIndex = idx; }
export function getSeriesIndex() { return _seriesIndex; }

function extractSeries(title) {
  const patterns = [
    /from the (.+? series)/i,
    /\((.+? series)\)/i,
    /from the (.+? set)/i,
    /\((.+? set)\)/i,
  ];
  for (const p of patterns) {
    const m = title.match(p);
    if (m) return m[1].trim();
  }
  return null;
}

export function buildSeriesLink(title) {
  const series = extractSeries(title);
  if (!series) return '';
  const idx = _seriesIndex.findIndex(s => s.name === series);
  if (idx === -1 || _seriesIndex[idx].items.length < 2) return '';
  return `<a class="detail-link detail-series-link" href="#" data-series-idx="${idx}">View ${esc(series)}</a>`;
}

function buildTaxonomyHtml(title, objectID) {
  const renderTaxon = taxon => `<div class="taxonomy-info">
    <div class="taxonomy-name">${esc(taxon.comName)}</div>
    <div class="taxonomy-sci">${esc(taxon.sciName)}</div>
    ${taxon.matchName ? `<div class="taxonomy-alias">${taxon.aliasType === 'regional' ? 'also called' : 'formerly'} "${esc(taxon.matchName)}"</div>` : ''}
    <div class="taxonomy-family">${esc(taxon.family)}</div>
    <a class="taxonomy-link" href="${esc(taxon.ebirdUrl)}" target="_blank" rel="noopener">View on eBird ↗</a>
  </div>`;
  const plate = window.BIRD_PLATES?.[objectID];
  if (plate && plate.ebirdUrl) return renderTaxon(plate);
  if (plate && !plate.ebirdUrl) return '';
  const override = window.BIRD_TAXONOMY_OVERRIDES?.[objectID];
  const taxa = findTaxonomy(title);
  if (override) {
    let html = renderTaxon(override);
    for (const taxon of taxa) {
      if (taxon.ebirdUrl === override.ebirdUrl) continue;
      if (override.matchName && taxon.matchName === override.matchName) continue;
      html += renderTaxon(taxon);
    }
    return html;
  }
  if (!taxa.length) return '';
  return taxa.map(renderTaxon).join('');
}

export function selectArtwork(id) {
  const obj = window._metObjects?.[id];
  if (!obj) return;

  if (_activeCard) _activeCard.classList.remove('active');
  _activeCard = $(`card-${id}`);
  _activeCard?.classList.add('active');
  _activeCard?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

  const imgSrc  = obj.primaryImageSmall || obj.primaryImage;
  const fullSrc = obj.primaryImage      || obj.primaryImageSmall;

  const phHtml = `<div class="detail-img-wrap detail-img-placeholder">
        <div class="art-thumb-ph" style="display:flex;aspect-ratio:auto;min-height:200px;font-size:3rem">🖼</div>
      </div>`;
  const imgHtml = imgSrc
    ? `<div class="detail-img-wrap" data-lightbox-src="${esc(fullSrc)}" data-lightbox-alt="${esc(obj.title)}" title="Click for full image">
        <img src="${esc(imgSrc)}" alt="${esc(obj.title)}" />
      </div>`
    : phHtml;

  $('detail-content').innerHTML = `
    ${imgHtml}
    <div class="detail-meta">
      <div class="detail-title">${esc(obj.title) || 'Untitled'}</div>
      ${obj._plateCaption ? `<div class="detail-row" style="font-style:italic;color:var(--muted)">${esc(obj._plateCaption)}</div>` : ''}
      ${obj.artistDisplayName ? `<div class="detail-artist">${esc(obj.artistDisplayName)}</div>` : ''}
      ${obj.objectDate        ? `<div class="detail-row">${esc(obj.objectDate)}</div>` : ''}
      ${obj.medium            ? `<div class="detail-row">${esc(obj.medium)}</div>` : ''}
      ${obj.dimensions        ? `<div class="detail-row">${esc(obj.dimensions)}</div>` : ''}
      ${obj.department        ? `<div class="detail-dept">${esc(obj.department)}</div>` : ''}
      ${obj.creditLine        ? `<div class="detail-credit">${esc(obj.creditLine)}</div>` : ''}
      ${obj.objectURL || obj.objectID ? `<a class="detail-link" href="${esc(obj.objectURL || `https://www.metmuseum.org/art/collection/search/${obj.objectID}`)}" target="_blank" rel="noopener">View on MetMuseum.org ↗</a>` : ''}
      ${buildSeriesLink(obj.title)}
      ${buildTaxonomyHtml(obj.title, obj.objectID)}
    </div>`;

  openDetail();
}

export function showDetailPlaceholder() {
  $('detail-content').innerHTML = `
    <div class="state-box">
      <div class="state-icon">🖼️</div>
      <div class="state-title">No artwork selected</div>
      <div class="state-msg">Click any artwork on the left to see its full details here.</div>
    </div>`;
  _activeCard = null;
}

/* ── Mobile detail panel ─────────────────────────────────────── */
function isMobileLayout() { return window.innerWidth <= 768; }

export function openDetail() {
  if (isMobileLayout()) $('detail-panel').classList.add('mobile-open');
}
export function closeDetail() {
  $('detail-panel').classList.remove('mobile-open');
}

/* ── Lightbox ─────────────────────────────────────────────────── */
export function openLightbox(src, alt) { $('lightbox-img').src = src; $('lightbox-img').alt = alt; $('lightbox').classList.add('open'); }
export function closeLightbox() { $('lightbox').classList.remove('open'); }
