const $ = id => document.getElementById(id);

/* ── Index check on load ──────────────────────────────────────── */
window.addEventListener('DOMContentLoaded', () => {
  if (window.BIRD_OBJECTS && window.BIRD_OBJECTS.length) {
    // Build ID→object Map for O(1) lookups
    _birdObjectMap = new Map();
    for (const o of window.BIRD_OBJECTS) _birdObjectMap.set(o.id, o);

    const count = window.BIRD_OBJECTS.length.toLocaleString();
    $('initial-title').textContent = 'Search for bird art';
    $('initial-msg').textContent   = `Type a bird name above and click Search. ${count} bird objects indexed.`;
    $('index-info').textContent    = `${count} bird objects indexed`;

    // eBird species taxonomy (must init before autocomplete for dominated-match filtering)
    initTaxonomy();
    initAutocomplete();
    initSeriesDropdown();
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
    if (e.target.id === 'lightbox-img') return; // don't close when clicking image
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

  // Image error handling via delegation
  document.addEventListener('error', e => {
    if (e.target.tagName !== 'IMG') return;
    const img = e.target;
    // Card thumbnail error
    if (img.classList.contains('art-thumb')) {
      img.style.display = 'none';
      const ph = img.nextElementSibling;
      if (ph) ph.style.display = 'flex';
      return;
    }
    // Detail image error
    const wrap = img.closest('.detail-img-wrap');
    if (wrap) {
      img.style.display = 'none';
      wrap.classList.add('detail-img-placeholder');
      wrap.innerHTML = '<div class="art-thumb-ph" style="display:flex;aspect-ratio:auto;min-height:200px;font-size:3rem">🖼</div>';
    }
  }, true); // capture phase to catch img errors
});

/* ── Taxonomy matching ────────────────────────────────────────── */
let _taxonRegexes = [];
let _birdObjectMap = new Map(); // id → BIRD_OBJECTS entry, built in DOMContentLoaded

function initTaxonomy() {
  if (!window.BIRD_TAXONOMY) return;
  // Sort longest match name first so "Golden Eagle" matches before "Eagle"
  const sorted = [...window.BIRD_TAXONOMY].sort((a, b) => {
    const aName = a.matchName || a.comName;
    const bName = b.matchName || b.comName;
    return bName.length - aName.length;
  });
  _taxonRegexes = sorted.map(t => {
    // Use matchName for aliases (historical names), comName for current names
    const name = t.matchName || t.comName;
    // Use plural-aware regex on the last word of the name
    const words = name.split(/\s+/);
    const lastWord = words[words.length - 1];
    const prefix = words.slice(0, -1).map(w => _escRx(w)).join('\\s+');
    const lastPattern = buildPluralRegex(lastWord).source;
    const full = prefix ? `(?<![a-z])${prefix}\\s+(?:${lastPattern})` : lastPattern;
    return { data: t, regex: new RegExp(full, 'i') };
  });
}

function findTaxonomy(title) {
  const matches = [];
  for (const { data, regex } of _taxonRegexes) {
    const m = title.match(regex);
    if (m) matches.push({ data, pos: m.index, end: m.index + m[0].length });
  }
  matches.sort((a, b) => a.pos - b.pos);
  // Remove shorter matches whose span is contained within a longer match
  const filtered = matches.filter((m, i) => {
    for (let j = 0; j < matches.length; j++) {
      if (i !== j && matches[j].pos <= m.pos && matches[j].end >= m.end && matches[j].end - matches[j].pos > m.end - m.pos) {
        return false;
      }
    }
    return true;
  });
  // Deduplicate same species, keep first occurrence (earliest in title)
  const seen = new Set();
  const deduped = [];
  for (const m of filtered) {
    const key = m.data.ebirdUrl;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(m);
    }
  }
  return deduped.map(m => m.data);
}

/* ── Shared plural-form builder (memoized) ────────────────────── */
const _irregulars = { 'goose':'geese', 'geese':'goose' };
const _escRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const _pluralRegexCache = new Map();

function buildPluralForms(word) {
  const w = word.toLowerCase();
  const forms = new Set([w]);
  if (_irregulars[w]) forms.add(_irregulars[w]);
  // Plural → singular
  if (w.endsWith('ies')) forms.add(w.slice(0, -3) + 'y');
  else if (w.endsWith('shes')) forms.add(w.slice(0, -2));
  else if (w.endsWith('ches')) forms.add(w.slice(0, -2));
  else if (w.endsWith('ses')) forms.add(w.slice(0, -2));
  else if (w.endsWith('s')) forms.add(w.slice(0, -1));
  // Singular → plural
  if (w.endsWith('y')) forms.add(w.slice(0, -1) + 'ies');
  if (w.endsWith('sh') || w.endsWith('ch') || w.endsWith('is')) forms.add(w + 'es');
  forms.add(w + 's');
  return forms;
}

function buildPluralRegex(word) {
  const key = word.toLowerCase();
  if (_pluralRegexCache.has(key)) return _pluralRegexCache.get(key);
  const forms = buildPluralForms(word);
  const pattern = [...forms].map(f => `(?<![a-z])${_escRx(f)}(?![a-z])`).join('|');
  const regex = new RegExp(pattern, 'i');
  _pluralRegexCache.set(key, regex);
  return regex;
}

/* ── Search ───────────────────────────────────────────────────── */
const PAGE_SIZE = 15;
let _allMatches = [];
let _currentPage = 1;
let _pageCache = {};  // page number → fetched objects array

async function searchArt() {
  const q = $('met-q').value.trim();
  if (!q) { alert('Enter a bird name to search.'); return; }

  if (!window.BIRD_OBJECTS) {
    alert('Run node build-bird-ids.mjs first to build the bird index.');
    return;
  }
  $('series-select').value = '';

  const regex = buildPluralRegex(q);
  _allMatches = window.BIRD_OBJECTS.filter(o => regex.test(o.title))
    .sort((a, b) => (b.img || 0) - (a.img || 0));
  _currentPage = 1;
  _pageCache = {};
  window._metObjects = {};

  $('art-count').textContent = _allMatches.length;
  showDetailPlaceholder();

  if (!_allMatches.length) {
    const picks = getRandomSuggestions(3);
    const picksHtml = picks.map(s =>
      `<a href="#" class="suggestion-link" data-suggestion="${esc(s.name)}">${esc(s.name)}</a> <span class="suggestion-count">(${s.count})</span>`
    ).join(', ');
    $('art-grid').innerHTML = `
      <div class="state-box">
        <div class="state-icon">🔍</div>
        <div class="state-title">No results</div>
        <div class="state-msg">No bird artwork found with "${esc(q)}" in the title. Try another name.</div>
        ${picks.length ? `<div class="state-msg">Try: ${picksHtml}</div>` : ''}
      </div>`;
    $('pagination').classList.remove('visible');
    return;
  }

  await goToPage(1);
}

function totalPages() { return Math.ceil(_allMatches.length / PAGE_SIZE); }

const fetchObj = async (id, retries = 3) => {
  // Plate entries: fetch parent object, then overlay plate-specific data
  const plate = window.BIRD_PLATES?.[id];
  if (plate) {
    const parent = await fetchObj(plate.parentId, retries);
    if (!parent) return null;
    const obj = Object.assign({}, parent);
    obj.objectID = id;
    obj._plateParentId = plate.parentId;
    obj.primaryImage = plate.imageUrl;
    obj.primaryImageSmall = plate.imageUrl;
    // Keep parent title; plate caption shown separately
    obj._plateCaption = plate.caption;
    obj.objectURL = `https://www.metmuseum.org/art/collection/search/${plate.parentId}`;
    return obj;
  }
  const cacheKey = `met_${id}`;
  try { const c = sessionStorage.getItem(cacheKey); if (c) return JSON.parse(c); } catch {}
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${id}`);
      const data = await r.json();
      if (data && data.objectID) {
        try { sessionStorage.setItem(cacheKey, JSON.stringify(data)); } catch {}
        return data;
      }
      if (i < retries) { await new Promise(ok => setTimeout(ok, 800 * (i + 1))); continue; }
      return null;
    } catch { if (i === retries) return null; await new Promise(ok => setTimeout(ok, 800 * (i + 1))); }
  }
  return null;
};

async function goToPage(page) {
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

  // Prefetch next page in background
  prefetchNextPage(page);
}

function prefetchNextPage(page) {
  const next = page + 1;
  if (next > totalPages() || _pageCache[next]) return;
  const start = (next - 1) * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, _allMatches.length);
  const items = _allMatches.slice(start, end);
  // Fire all fetches in background, don't block
  Promise.all(items.map(item => fetchObj(item.id))).then(results => {
    if (_pageCache[next]) return; // already loaded
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

function showPage(objects) {
  const start = (_currentPage - 1) * PAGE_SIZE;
  const end = Math.min(start + PAGE_SIZE, _allMatches.length);
  $('art-count').textContent = `${start + 1}–${end} of ${_allMatches.length.toLocaleString()}`;
  renderGrid(objects);
  $('art-grid').scrollTop = 0;
}

function renderPagination() {
  const pages = totalPages();
  const pg = $('pagination');
  if (pages <= 1) { pg.classList.remove('visible'); return; }
  pg.classList.add('visible');

  let html = '';
  // Prev arrow
  html += `<button class="pg-btn pg-arrow" data-page="${_currentPage - 1}" ${_currentPage === 1 ? 'disabled' : ''}>&#8249;</button>`;

  // Page numbers with ellipsis
  const range = buildPageRange(_currentPage, pages);
  for (const item of range) {
    if (item === '...') {
      html += `<span class="pg-dots">…</span>`;
    } else {
      html += `<button class="pg-btn${item === _currentPage ? ' active' : ''}" data-page="${item}">${item}</button>`;
    }
  }

  // Next arrow
  html += `<button class="pg-btn pg-arrow" data-page="${_currentPage + 1}" ${_currentPage === pages ? 'disabled' : ''}>&#8250;</button>`;

  pg.innerHTML = html;
}

function buildPageRange(current, total) {
  // Always show first, last, current, and neighbors
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
    if (active) {
      e.preventDefault();
      active.click();
    } else {
      searchArt();
    }
  } else if (e.key === 'Escape') {
    list.classList.remove('open');
  }
});

/* ── eBird Autocomplete ──────────────────────────────────────── */
function initAutocomplete() {
  const input = $('met-q');
  const list = $('ac-list');
  let debounceTimer = null;

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (q.length < 1) { list.classList.remove('open'); return; }
    debounceTimer = setTimeout(() => fetchSuggestions(q), 250);
  });

  // Close dropdown when clicking outside
  document.addEventListener('click', e => {
    if (!e.target.closest('.ac-wrap')) list.classList.remove('open');
  });

  // Single delegated click handler for autocomplete items
  list.addEventListener('click', e => {
    const li = e.target.closest('.ac-item');
    if (!li || !list._suggestions) return;
    const s = list._suggestions[+li.dataset.idx];
    if (!s) return;
    list.classList.remove('open');
    handleSuggestionClick(s, input);
  });

  // Build bird name list with match counts from the index
  const birdNames = [
    'eagle','turkey','falcon','duck','swan','owl','dove','parrot','peacock',
    'goose','crow','hawk','pigeon','vulture','chicken','raven','ibis','heron',
    'pheasant','cockatoo','quail','swallow','magpie','egret','kingfisher',
    'sparrow','pelican','kite','stork','flamingo','woodpecker','woodcock',
    'oriole','canary','osprey','toucan','hummingbird','penguin','finch',
    'starling','thrush','warbler','bluebird','macaw','cormorant','albatross',
    'condor','rooster','goldfinch','chickadee','lark','wren','robin','jay',
    'crane','cardinal','bunting','nightingale','martin','swift','grosbeak',
    'tanager','sandpiper','plover','tern','gull','cuckoo',
    'grouse','pitta','myna','mynah','tit','roller','shrike','wagtail',
    'dipper','flycatcher','chat','bulbul','manakin','hornbill','bee-eater',
    'snipe','curlew','lapwing','avocet','puffin','gannet','petrel',
    'waxwing','mockingbird','catbird','wheatear','pipit',
    'partridge','bullfinch','rook','teal','mallard','buzzard','loon',
    'parakeet','bittern','ptarmigan','linnet','blackbird','hoopoe',
    'jackdaw','fantail','coot','kestrel','trogon','spoonbill',
    'cock','fowl','phalarope','crossbill',
    'turnstone','redshank','peregrine','aracari','bustard','auk',
    'whistler','rail','merlin','hobby','monarch','booby',
    'harrier','jaeger','skimmer','ani','frigate',
    'hen','ostrich','skylark','kinglet','bobwhite','quetzal',
    'redstart','dodo','nightjar','titmouse',
    'chaffinch','cassowary',
    'emu','moorhen','goshawk','kingbird',
    'siskin','yellowhammer','towhee','bobolink','creeper',
  ];
  const nameSet = new Set(birdNames);

  // Build taxonomy lookup so single-word names get scientific names too
  const taxLookup = {};
  if (window.BIRD_TAXONOMY) {
    for (const t of window.BIRD_TAXONOMY) {
      taxLookup[t.comName.toLowerCase()] = t.sciName;
    }
  }

  // Count matches using the exact same plural-aware logic as the search
  const counts = {};
  for (const name of birdNames) {
    const regex = buildPluralRegex(name);
    let n = 0;
    for (const o of window.BIRD_OBJECTS) { if (regex.test(o.title)) n++; }
    if (n > 0) counts[name] = n;
  }

  // Add full taxonomy names (e.g., "Snowy Owl", "Blue Jay") with match counts
  const taxCounts = {};
  const aliasSuggestions = [];
  if (window.BIRD_TAXONOMY) {
    // Group aliases by comName to merge entries for the same species
    const aliasGroups = {};
    for (const t of window.BIRD_TAXONOMY) {
      if (t.matchName) {
        const regex = buildPluralRegex(t.matchName);
        const matchIds = new Set();
        for (const o of window.BIRD_OBJECTS) {
          const m = o.title.match(regex);
          if (!m) continue;
          // Exclude if this match is contained within a longer taxonomy match
          const pos = m.index, end = pos + m[0].length;
          const dominated = _taxonRegexes.some(tr => {
            if (tr.data === t) return false;
            const m2 = o.title.match(tr.regex);
            return m2 && m2.index <= pos && m2.index + m2[0].length >= end && m2[0].length > m[0].length;
          });
          if (!dominated) {
            // Exclude artworks with per-ID overrides for this alias
            const ovr = window.BIRD_TAXONOMY_OVERRIDES?.[o.id];
            if (ovr && ovr.matchName === t.matchName && ovr.comName !== t.comName) continue;
            matchIds.add(o.id);
          }
        }
        if (matchIds.size > 0) {
          if (!aliasGroups[t.comName]) aliasGroups[t.comName] = { sciName: t.sciName, searchNames: [], ids: new Set() };
          aliasGroups[t.comName].searchNames.push(t.matchName);
          matchIds.forEach(id => aliasGroups[t.comName].ids.add(id));
        }
        continue;
      }
    }
    for (const [comName, g] of Object.entries(aliasGroups)) {
      // If this alias resolves to a name already in the single-word birdNames list,
      // merge the alias match IDs into that count instead of creating a duplicate entry
      const lowerComName = comName.toLowerCase();
      // Check if comName itself is a birdNames word
      let mergeTarget = (nameSet.has(lowerComName) && counts[lowerComName] !== undefined) ? lowerComName : null;
      // Also check if an alias searchName starts with a birdNames word
      if (!mergeTarget) {
        for (const sn of g.searchNames) {
          const firstWord = sn.toLowerCase().split(/[\s-]+/)[0];
          if (nameSet.has(firstWord) && counts[firstWord] !== undefined) { mergeTarget = firstWord; break; }
        }
      }
      if (mergeTarget) {
        // Merge alias match IDs into the birdNames count
        const regex = buildPluralRegex(mergeTarget);
        const combinedIds = new Set(g.ids);
        for (const o of window.BIRD_OBJECTS) { if (regex.test(o.title)) combinedIds.add(o.id); }
        if (window.BIRD_TAXONOMY_OVERRIDES) {
          for (const [id, ovr] of Object.entries(window.BIRD_TAXONOMY_OVERRIDES)) {
            if (ovr.comName === comName) combinedIds.add(Number(id));
          }
        }
        counts[mergeTarget] = combinedIds.size;
        // Still add the species as a suggestion so it appears in autocomplete
        if (g.ids.size > 0) {
          aliasSuggestions.push({ name: comName, searchNames: g.searchNames, count: g.ids.size, sciName: g.sciName });
        }
        continue;
      }
      // Store alias for later dedup against taxCounts
      aliasSuggestions.push({ name: comName, searchNames: g.searchNames, count: g.ids.size, sciName: g.sciName });
    }
    // Build taxCounts first, then dedup aliasSuggestions against them
    const _pendingAliases = aliasSuggestions.splice(0);
    for (const t of window.BIRD_TAXONOMY) {
      if (t.matchName) continue;
      // Skip single-word names already in birdNames list
      if (nameSet.has(t.comName.toLowerCase())) continue;
      const regex = buildPluralRegex(t.comName);
      let n = 0;
      for (const o of window.BIRD_OBJECTS) { if (regex.test(o.title)) n++; }
      // Add overridden artworks that map to this species
      if (window.BIRD_TAXONOMY_OVERRIDES) {
        for (const [id, ovr] of Object.entries(window.BIRD_TAXONOMY_OVERRIDES)) {
          if (ovr.comName === t.comName) n++;
        }
      }
      if (n > 0) taxCounts[t.comName] = { count: n, sciName: t.sciName };
    }
    // Count all artworks for a species: alias matches (with domination check) + comName matches + overrides
    function countSpeciesArtworks(searchNames, comName) {
      const combinedIds = new Set();
      for (const sn of searchNames) {
        const sr = buildPluralRegex(sn);
        for (const o of window.BIRD_OBJECTS) {
          if (combinedIds.has(o.id)) continue;
          const m = o.title.match(sr);
          if (!m) continue;
          const pos = m.index, end = pos + m[0].length;
          const dominated = _taxonRegexes.some(tr => {
            if (tr.data.matchName === sn || tr.data.comName === sn) return false;
            const m2 = o.title.match(tr.regex);
            return m2 && m2.index <= pos && m2.index + m2[0].length >= end && m2[0].length > m[0].length;
          });
          if (!dominated) {
            const ovr = window.BIRD_TAXONOMY_OVERRIDES?.[o.id];
            if (ovr && ovr.matchName === sn && ovr.comName !== comName) continue;
            combinedIds.add(o.id);
          }
        }
      }
      const comRegex = buildPluralRegex(comName);
      for (const o of window.BIRD_OBJECTS) { if (comRegex.test(o.title)) combinedIds.add(o.id); }
      if (window.BIRD_TAXONOMY_OVERRIDES) {
        for (const [id, ovr] of Object.entries(window.BIRD_TAXONOMY_OVERRIDES)) {
          if (ovr.comName === comName) combinedIds.add(Number(id));
        }
      }
      return combinedIds.size;
    }
    // Merge pending aliases: if alias comName already exists in taxCounts, merge counts; otherwise add to aliasSuggestions
    for (const a of _pendingAliases) {
      if (taxCounts[a.name]) {
        taxCounts[a.name].count = countSpeciesArtworks(a.searchNames, a.name);
      } else {
        a.count = countSpeciesArtworks(a.searchNames, a.name);
        aliasSuggestions.push(a);
      }
    }
  }

  // Sorted by frequency
  const suggestions = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => {
      const entry = { name: name.charAt(0).toUpperCase() + name.slice(1), count: n };
      if (taxLookup[name]) entry.sciName = taxLookup[name];
      return entry;
    });

  // Add taxonomy suggestions (already properly cased)
  const taxSuggestions = Object.entries(taxCounts)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([name, info]) => ({ name, count: info.count, sciName: info.sciName }));

  // Merge: single-word birds, taxonomy names, then historical aliases
  const allSuggestions = suggestions.concat(taxSuggestions).concat(
    aliasSuggestions.sort((a, b) => b.count - a.count)
  );
  window._birdSuggestions = allSuggestions;

  function fetchSuggestions(q) {
    const qLower = q.toLowerCase();
    const starts = [], contains = [];
    for (const s of allSuggestions) {
      const name = s.name.toLowerCase();
      // Match against searchNames array (multiple aliases) or single searchName
      const searches = s.searchNames ? s.searchNames.map(n => n.toLowerCase()) : s.searchName ? [s.searchName.toLowerCase()] : [];
      const anyStart = searches.some(sn => sn.startsWith(qLower));
      const anyContain = searches.some(sn => sn.includes(qLower));
      if (name.startsWith(qLower) || anyStart) starts.push(s);
      else if (name.includes(qLower) || anyContain) contains.push(s);
    }
    renderSuggestions(starts.concat(contains).slice(0, 12));
  }

  function renderSuggestions(matches) {
    if (!matches.length) { list.classList.remove('open'); return; }
    // Store suggestion data for click handler
    list._suggestions = matches;
    list.innerHTML = matches.map((s, i) =>
      `<li class="ac-item" data-idx="${i}">${esc(s.name)}${s.sciName ? `<span class="ac-sci-name">${esc(s.sciName)}</span>` : ''}<span class="ac-sci">${s.count} results</span></li>`
    ).join('');
    list.classList.add('open');
  }
}

// Extracted from the old per-item click handler into a shared function
function handleSuggestionClick(s, input) {
  if (s.searchNames) {
    // Alias entry — search all former/regional names, filter out dominated matches
    const combined = new Map();
    for (const sn of s.searchNames) {
      const regex = buildPluralRegex(sn);
      for (const o of window.BIRD_OBJECTS) {
        if (combined.has(o.id)) continue;
        const m = o.title.match(regex);
        if (!m) continue;
        const pos = m.index, end = pos + m[0].length;
        const dominated = _taxonRegexes.some(tr => {
          const m2 = o.title.match(tr.regex);
          return m2 && m2.index <= pos && m2.index + m2[0].length >= end && m2[0].length > m[0].length;
        });
        if (!dominated) {
          const ovr = window.BIRD_TAXONOMY_OVERRIDES?.[o.id];
          if (ovr && ovr.matchName === sn && ovr.comName !== s.name) continue;
          combined.set(o.id, o);
        }
      }
    }
    // Also include artworks matching the current species name (comName)
    const comRegex = buildPluralRegex(s.name);
    for (const o of window.BIRD_OBJECTS) {
      if (!combined.has(o.id) && comRegex.test(o.title)) combined.set(o.id, o);
    }
    // Include overridden artworks that map to this species
    if (window.BIRD_TAXONOMY_OVERRIDES) {
      for (const [id, ovr] of Object.entries(window.BIRD_TAXONOMY_OVERRIDES)) {
        if (ovr.comName === s.name) {
          const obj = _birdObjectMap.get(+id);
          if (obj && !combined.has(obj.id)) combined.set(obj.id, obj);
        }
      }
    }
    _allMatches = [...combined.values()].sort((a, b) => (b.img || 0) - (a.img || 0));
    _pageCache = {};
    window._metObjects = {};
    showDetailPlaceholder();
    input.value = s.name;
    $('series-select').value = '';
    goToPage(1);
  } else {
    // Direct taxonomy name — include aliases and overridden artworks
    const searchTerm = s.searchName || s.name;
    const regex = buildPluralRegex(searchTerm);
    const combined = new Map();
    for (const o of window.BIRD_OBJECTS) {
      if (regex.test(o.title)) combined.set(o.id, o);
    }
    // Also include artworks matching any alias that resolves to this species (with domination check)
    if (window.BIRD_TAXONOMY) {
      for (const t of window.BIRD_TAXONOMY) {
        if (t.matchName && t.comName === s.name) {
          const aliasRegex = buildPluralRegex(t.matchName);
          for (const o of window.BIRD_OBJECTS) {
            if (combined.has(o.id)) continue;
            const m = o.title.match(aliasRegex);
            if (!m) continue;
            const pos = m.index, end = pos + m[0].length;
            const dominated = _taxonRegexes.some(tr => {
              if (tr.data.matchName === t.matchName || tr.data.comName === t.matchName) return false;
              const m2 = o.title.match(tr.regex);
              return m2 && m2.index <= pos && m2.index + m2[0].length >= end && m2[0].length > m[0].length;
            });
            if (!dominated) {
              const ovr = window.BIRD_TAXONOMY_OVERRIDES?.[o.id];
              if (ovr && ovr.matchName === t.matchName && ovr.comName !== s.name) continue;
              combined.set(o.id, o);
            }
          }
        }
      }
    }
    if (window.BIRD_TAXONOMY_OVERRIDES) {
      for (const [id, ovr] of Object.entries(window.BIRD_TAXONOMY_OVERRIDES)) {
        if (ovr.comName === s.name) {
          const obj = _birdObjectMap.get(+id);
          if (obj) combined.set(obj.id, obj);
        }
      }
    }
    _allMatches = [...combined.values()].sort((a, b) => (b.img || 0) - (a.img || 0));
    _pageCache = {};
    window._metObjects = {};
    showDetailPlaceholder();
    input.value = s.name;
    $('series-select').value = '';
    goToPage(1);
  }
}

/* ── Series dropdown ──────────────────────────────────────────── */
const _seriesPatterns = [
  /from the (.+? series)/i,
  /\((.+? series)\)/i,
  /from the (.+? set)/i,
  /\((.+? set)\)/i,
];

let _seriesIndex = []; // [{name, items}] sorted by count desc

function extractSeries(title) {
  for (const p of _seriesPatterns) {
    const m = title.match(p);
    if (m) return m[1].trim();
  }
  return null;
}

function initSeriesDropdown() {
  if (!window.BIRD_OBJECTS) return;
  const map = {};
  for (const o of window.BIRD_OBJECTS) {
    // Plate entries go into the Drawings Made in the United States series
    if (window.BIRD_PLATES?.[o.id]) {
      const name = 'Drawings Made in the United States';
      if (!map[name]) map[name] = [];
      map[name].push(o);
      continue;
    }
    const series = extractSeries(o.title);
    if (series) {
      if (!map[series]) map[series] = [];
      map[series].push(o);
    }
  }
  _seriesIndex = Object.entries(map)
    .map(([name, items]) => ({ name, items }))
    .sort((a, b) => b.items.length - a.items.length);

  const sel = $('series-select');
  for (let i = 0; i < _seriesIndex.length; i++) {
    const s = _seriesIndex[i];
    if (s.items.length < 3) continue;
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${s.name} (${s.items.length})`;
    sel.appendChild(opt);
  }

  // Handle series link clicks in detail panel
  document.addEventListener('click', e => {
    const link = e.target.closest('.detail-series-link');
    if (!link) return;
    e.preventDefault();
    const idx = +link.dataset.seriesIdx;
    if (_seriesIndex[idx]) {
      sel.value = idx;
      const series = _seriesIndex[idx];
      _allMatches = series.items.slice().sort((a, b) => (b.img || 0) - (a.img || 0));
      _pageCache = {};
      window._metObjects = {};
      $('art-count').textContent = _allMatches.length;
      $('met-q').value = '';
      showDetailPlaceholder();
      goToPage(1);
    }
  });

  sel.addEventListener('change', () => {
    const idx = sel.value;
    if (idx === '') return;
    const series = _seriesIndex[+idx];
    _allMatches = series.items.slice().sort((a, b) => (b.img || 0) - (a.img || 0));
    _pageCache = {};
    window._metObjects = {};
    $('art-count').textContent = _allMatches.length;
    $('met-q').value = '';
    showDetailPlaceholder();
    goToPage(1);
  });
}

function showSeriesByName(name) {
  const idx = _seriesIndex.findIndex(s => s.name === name);
  if (idx === -1) return;
  $('series-select').value = idx;
  const series = _seriesIndex[idx];
  _allMatches = series.items.slice().sort((a, b) => (b.img || 0) - (a.img || 0));
  _pageCache = {};
  window._metObjects = {};
  $('art-count').textContent = _allMatches.length;
  $('met-q').value = '';
  showDetailPlaceholder();
  goToPage(1);
}

function buildSeriesLink(title) {
  const series = extractSeries(title);
  if (!series) return '';
  const idx = _seriesIndex.findIndex(s => s.name === series);
  if (idx === -1 || _seriesIndex[idx].items.length < 2) return '';
  return `<a class="detail-link detail-series-link" href="#" data-series-idx="${idx}">View ${esc(series)}</a>`;
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

function renderGrid(objects) {
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

function appendCards(objects) {
  const grid = $('art-grid');
  grid.insertAdjacentHTML('beforeend', objects.map(buildCardHtml).join(''));
}

async function retryFallbacks(fallbacks) {
  for (const fb of fallbacks) {
    if (window.BIRD_PLATES?.[fb.objectID]) continue; // plate entries don't retry
    try {
      const r = await fetch(`https://collectionapi.metmuseum.org/public/collection/v1/objects/${fb.objectID}`);
      const data = await r.json();
      if (data && data.objectID) {
        try { sessionStorage.setItem(`met_${data.objectID}`, JSON.stringify(data)); } catch {}
        delete data._fallback;
        window._metObjects[data.objectID] = data;
        // Update the cached page too
        for (const pg in _pageCache) {
          const idx = _pageCache[pg].findIndex(o => o.objectID === data.objectID);
          if (idx !== -1) { _pageCache[pg][idx] = data; break; }
        }
        // Refresh the card in-place if still visible
        const card = $(`card-${data.objectID}`);
        if (card) card.outerHTML = buildCardHtml(data);
      }
    } catch { /* ignore retry failure */ }
    await new Promise(ok => setTimeout(ok, 500));
  }
}

/* ── Detail ───────────────────────────────────────────────────── */
let _activeCard = null;

function selectArtwork(id) {
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

function showDetailPlaceholder() {
  $('detail-content').innerHTML = `
    <div class="state-box">
      <div class="state-icon">🖼️</div>
      <div class="state-title">No artwork selected</div>
      <div class="state-msg">Click any artwork on the left to see its full details here.</div>
    </div>`;
  _activeCard = null;
}

/* ── Taxonomy info block ──────────────────────────────────────── */
function buildTaxonomyHtml(title, objectID) {
  const renderTaxon = taxon => `<div class="taxonomy-info">
    <div class="taxonomy-name">${esc(taxon.comName)}</div>
    <div class="taxonomy-sci">${esc(taxon.sciName)}</div>
    ${taxon.matchName ? `<div class="taxonomy-alias">${taxon.aliasType === 'regional' ? 'also called' : 'formerly'} "${esc(taxon.matchName)}"</div>` : ''}
    <div class="taxonomy-family">${esc(taxon.family)}</div>
    <a class="taxonomy-link" href="${esc(taxon.ebirdUrl)}" target="_blank" rel="noopener">View on eBird ↗</a>
  </div>`;
  // Plate entries have embedded taxonomy
  const plate = window.BIRD_PLATES?.[objectID];
  if (plate && plate.ebirdUrl) return renderTaxon(plate);
  if (plate && !plate.ebirdUrl) return ''; // e.g. Cuvier's Kinglet — no eBird data
  // Check for per-artwork overrides
  const override = window.BIRD_TAXONOMY_OVERRIDES?.[objectID];
  const taxa = findTaxonomy(title);
  if (override) {
    // Show override entry plus any additional regex matches (excluding same species or same matchName as override)
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

/* ── Mobile detail panel ─────────────────────────────────────── */
function isMobileLayout() { return window.innerWidth <= 768; }

function openDetail() {
  if (isMobileLayout()) $('detail-panel').classList.add('mobile-open');
}
function closeDetail() {
  $('detail-panel').classList.remove('mobile-open');
}

/* ── Lightbox ─────────────────────────────────────────────────── */
function openLightbox(src, alt) { $('lightbox-img').src = src; $('lightbox-img').alt = alt; $('lightbox').classList.add('open'); }
function closeLightbox() { $('lightbox').classList.remove('open'); }
document.addEventListener('keydown', e => { if (e.key === 'Escape') closeLightbox(); });

/* ── Util ─────────────────────────────────────────────────────── */
function getRandomSuggestions(n) {
  const all = window._birdSuggestions || [];
  if (!all.length) return [];
  const shuffled = [...all].sort(() => Math.random() - 0.5);
  return shuffled.slice(0, n);
}

function esc(s) {
  if (!s) return '';
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
                  .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}
