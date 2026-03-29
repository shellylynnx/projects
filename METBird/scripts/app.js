/* ── app.js ── Main entry point (ES module) ────────────────────── */

import { initTaxonomy } from './taxonomy.js';
import { initDataIndex, precomputeMatchCounts, initAutocomplete, initSeriesDropdown, searchArt } from './search.js';
import { $, showToast, goToPage, selectArtwork, showDetailPlaceholder, openLightbox, closeLightbox, openDetail, closeDetail } from './ui.js';

/* ── Lazy-load data files ────────────────────────────────────────── */

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = resolve;
    s.onerror = reject;
    document.head.appendChild(s);
  });
}

async function init() {
  try {
    await Promise.all([
      loadScript('scripts/bird-object-ids.js'),
      loadScript('scripts/bird-taxonomy.js')
    ]);
  } catch {
    $('initial-title').textContent = 'Failed to load data';
    $('initial-msg').textContent = 'Could not load bird data files. Please refresh the page.';
    showToast('Failed to load bird data files.', 'error');
    return;
  }

  if (window.BIRD_OBJECTS && window.BIRD_OBJECTS.length) {
    initDataIndex();
    initTaxonomy();
    precomputeMatchCounts();
    initAutocomplete();
    initSeriesDropdown();

    const count = window.BIRD_OBJECTS.length.toLocaleString();
    $('initial-title').textContent = 'Search for bird art';
    $('initial-msg').textContent = `Type a bird name above and click Search. ${count} bird objects indexed.`;
    $('index-info').textContent = `${count} bird objects indexed`;
  } else {
    $('initial-title').textContent = 'Index not built yet';
    $('initial-msg').innerHTML =
      `Run the build script first:<br><br>` +
      `<code>node build-bird-ids.mjs</code><br><br>` +
      `This scans the MET collection for bird artwork and saves the results.`;
  }

  // ── Global event delegation ──────────────────────────────────
  $('search-btn').addEventListener('click', () => searchArt());

  $('detail-back-btn').addEventListener('click', () => closeDetail());

  // Lightbox
  $('lightbox').addEventListener('click', e => {
    if (e.target.id === 'lightbox-img') return;
    closeLightbox();
  });
  $('lb-close').addEventListener('click', () => closeLightbox());

  // Art grid: card clicks
  $('art-grid').addEventListener('click', e => {
    const card = e.target.closest('.art-card');
    if (!card) return;
    const id = card.dataset.artworkId;
    if (id) selectArtwork(+id);
  });

  // Detail panel: lightbox open + series links
  $('detail-content').addEventListener('click', e => {
    const imgWrap = e.target.closest('[data-lightbox-src]');
    if (imgWrap) {
      openLightbox(imgWrap.dataset.lightboxSrc, imgWrap.dataset.lightboxAlt);
      return;
    }
    const suggLink = e.target.closest('[data-suggestion]');
    if (suggLink) {
      e.preventDefault();
      $('met-q').value = suggLink.dataset.suggestion;
      searchArt();
      return;
    }
  });

  // Pagination clicks
  $('pagination').addEventListener('click', e => {
    const btn = e.target.closest('[data-page]');
    if (btn && !btn.disabled) goToPage(+btn.dataset.page);
  });

  // Suggestion links in no-results
  $('art-grid').addEventListener('click', e => {
    const suggLink = e.target.closest('[data-suggestion]');
    if (suggLink) {
      e.preventDefault();
      $('met-q').value = suggLink.dataset.suggestion;
      searchArt();
    }
  });

  // Keyboard navigation for autocomplete
  $('met-q').addEventListener('keydown', e => {
    const list = $('ac-list');
    const items = list.querySelectorAll('.ac-item');
    const active = list.querySelector('.ac-item.active');
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      if (!items.length) return;
      const next = active ? active.nextElementSibling || items[0] : items[0];
      if (active) active.classList.remove('active');
      next.classList.add('active');
      next.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      if (!items.length) return;
      const prev = active ? active.previousElementSibling || items[items.length - 1] : items[items.length - 1];
      if (active) active.classList.remove('active');
      prev.classList.add('active');
      prev.scrollIntoView({ block: 'nearest' });
    } else if (e.key === 'Enter') {
      if (active) { e.preventDefault(); active.click(); }
      else searchArt();
    } else if (e.key === 'Escape') {
      list.classList.remove('open');
    }
  });

  // Image error handling via delegation
  document.addEventListener('error', e => {
    if (e.target.tagName !== 'IMG') return;
    const img = e.target;
    if (img.classList.contains('art-thumb')) {
      img.style.display = 'none';
      const ph = img.nextElementSibling;
      if (ph) ph.style.display = 'flex';
      return;
    }
    const wrap = img.closest('.detail-img-wrap');
    if (wrap) {
      img.style.display = 'none';
      wrap.classList.add('detail-img-placeholder');
      wrap.innerHTML = '<div class="art-thumb-ph" style="display:flex;aspect-ratio:auto;min-height:200px;font-size:3rem">🖼</div>';
    }
  }, true);

  // Register service worker
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
}

init();
