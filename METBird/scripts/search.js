/* ── search.js ── Autocomplete, filtering, matching logic ──── */

import { buildPluralRegex, getTaxonRegexes } from './taxonomy.js';
import { $, esc, goToPage, showDetailPlaceholder, setAllMatches, getRandomSuggestions, setSeriesIndex, getSeriesIndex } from './ui.js';

let _birdObjectMap = new Map();

export function getBirdObjectMap() { return _birdObjectMap; }

/* ── Data initialization (called after BIRD_OBJECTS loads) ──── */
export function initDataIndex() {
  _birdObjectMap = new Map();
  for (const o of window.BIRD_OBJECTS) _birdObjectMap.set(o.id, o);
}

/* ── Pre-computed match count cache ──────────────────────────── */
// species name (lowercase) -> count of matching artworks
let _matchCountCache = new Map();

export function getMatchCountCache() { return _matchCountCache; }

export function precomputeMatchCounts() {
  _matchCountCache = new Map();
  if (!window.BIRD_OBJECTS) return;
  // Build a map of species name -> count for all BIRD_TAXONOMY entries
  if (window.BIRD_TAXONOMY) {
    for (const t of window.BIRD_TAXONOMY) {
      const name = t.matchName || t.comName;
      const key = name.toLowerCase();
      if (_matchCountCache.has(key)) continue;
      const regex = buildPluralRegex(name);
      let n = 0;
      for (const o of window.BIRD_OBJECTS) { if (regex.test(o.title)) n++; }
      _matchCountCache.set(key, n);
    }
  }
}

/* ── Search ───────────────────────────────────────────────────── */
export async function searchArt() {
  const q = $('met-q').value.trim();
  if (!q) { alert('Enter a bird name to search.'); return; }

  if (!window.BIRD_OBJECTS) {
    alert('Run node build-bird-ids.mjs first to build the bird index.');
    return;
  }
  $('series-select').value = '';

  const regex = buildPluralRegex(q);
  const matches = window.BIRD_OBJECTS.filter(o => regex.test(o.title))
    .sort((a, b) => (b.img || 0) - (a.img || 0));
  setAllMatches(matches);

  $('art-count').textContent = matches.length;
  showDetailPlaceholder();

  if (!matches.length) {
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

/* ── eBird Autocomplete ──────────────────────────────────────── */
export function initAutocomplete() {
  const input = $('met-q');
  const list = $('ac-list');
  let debounceTimer = null;

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    const q = input.value.trim();
    if (q.length < 1) { list.classList.remove('open'); return; }
    debounceTimer = setTimeout(() => fetchSuggestions(q), 250);
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.ac-wrap')) list.classList.remove('open');
  });

  list.addEventListener('click', e => {
    const li = e.target.closest('.ac-item');
    if (!li || !list._suggestions) return;
    const s = list._suggestions[+li.dataset.idx];
    if (!s) return;
    list.classList.remove('open');
    handleSuggestionClick(s, input);
  });

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

  const taxLookup = {};
  if (window.BIRD_TAXONOMY) {
    for (const t of window.BIRD_TAXONOMY) {
      taxLookup[t.comName.toLowerCase()] = t.sciName;
    }
  }

  // Use precomputed cache for single-word bird counts
  const counts = {};
  for (const name of birdNames) {
    const cached = _matchCountCache.get(name.toLowerCase());
    if (cached !== undefined && cached > 0) {
      counts[name] = cached;
    } else {
      // Fallback: compute if not in cache
      const regex = buildPluralRegex(name);
      let n = 0;
      for (const o of window.BIRD_OBJECTS) { if (regex.test(o.title)) n++; }
      if (n > 0) counts[name] = n;
    }
  }

  const _taxonRegexes = getTaxonRegexes();

  const taxCounts = {};
  const aliasSuggestions = [];
  if (window.BIRD_TAXONOMY) {
    const aliasGroups = {};
    for (const t of window.BIRD_TAXONOMY) {
      if (t.matchName) {
        const regex = buildPluralRegex(t.matchName);
        const matchIds = new Set();
        for (const o of window.BIRD_OBJECTS) {
          const m = o.title.match(regex);
          if (!m) continue;
          const pos = m.index, end = pos + m[0].length;
          const dominated = _taxonRegexes.some(tr => {
            if (tr.data === t) return false;
            const m2 = o.title.match(tr.regex);
            return m2 && m2.index <= pos && m2.index + m2[0].length >= end && m2[0].length > m[0].length;
          });
          if (!dominated) {
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
      const lowerComName = comName.toLowerCase();
      let mergeTarget = (nameSet.has(lowerComName) && counts[lowerComName] !== undefined) ? lowerComName : null;
      if (!mergeTarget) {
        for (const sn of g.searchNames) {
          const firstWord = sn.toLowerCase().split(/[\s-]+/)[0];
          if (nameSet.has(firstWord) && counts[firstWord] !== undefined) { mergeTarget = firstWord; break; }
        }
      }
      if (mergeTarget) {
        const regex = buildPluralRegex(mergeTarget);
        const combinedIds = new Set(g.ids);
        for (const o of window.BIRD_OBJECTS) { if (regex.test(o.title)) combinedIds.add(o.id); }
        if (window.BIRD_TAXONOMY_OVERRIDES) {
          for (const [id, ovr] of Object.entries(window.BIRD_TAXONOMY_OVERRIDES)) {
            if (ovr.comName === comName) combinedIds.add(Number(id));
          }
        }
        counts[mergeTarget] = combinedIds.size;
        if (g.ids.size > 0) {
          aliasSuggestions.push({ name: comName, searchNames: g.searchNames, count: g.ids.size, sciName: g.sciName });
        }
        continue;
      }
      aliasSuggestions.push({ name: comName, searchNames: g.searchNames, count: g.ids.size, sciName: g.sciName });
    }
    const _pendingAliases = aliasSuggestions.splice(0);
    for (const t of window.BIRD_TAXONOMY) {
      if (t.matchName) continue;
      if (nameSet.has(t.comName.toLowerCase())) continue;
      const cachedCount = _matchCountCache.get(t.comName.toLowerCase());
      let n = cachedCount !== undefined ? cachedCount : 0;
      if (cachedCount === undefined) {
        const regex = buildPluralRegex(t.comName);
        n = 0;
        for (const o of window.BIRD_OBJECTS) { if (regex.test(o.title)) n++; }
      }
      if (window.BIRD_TAXONOMY_OVERRIDES) {
        for (const [id, ovr] of Object.entries(window.BIRD_TAXONOMY_OVERRIDES)) {
          if (ovr.comName === t.comName) n++;
        }
      }
      if (n > 0) taxCounts[t.comName] = { count: n, sciName: t.sciName };
    }

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
    for (const a of _pendingAliases) {
      if (taxCounts[a.name]) {
        taxCounts[a.name].count = countSpeciesArtworks(a.searchNames, a.name);
      } else {
        a.count = countSpeciesArtworks(a.searchNames, a.name);
        aliasSuggestions.push(a);
      }
    }
  }

  const suggestions = Object.entries(counts)
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => {
      const entry = { name: name.charAt(0).toUpperCase() + name.slice(1), count: n };
      if (taxLookup[name]) entry.sciName = taxLookup[name];
      return entry;
    });

  const taxSuggestions = Object.entries(taxCounts)
    .sort((a, b) => b[1].count - a[1].count)
    .map(([name, info]) => ({ name, count: info.count, sciName: info.sciName }));

  const allSuggestions = suggestions.concat(taxSuggestions).concat(
    aliasSuggestions.sort((a, b) => b.count - a.count)
  );
  window._birdSuggestions = allSuggestions;

  function fetchSuggestions(q) {
    const qLower = q.toLowerCase();
    const starts = [], contains = [];
    for (const s of allSuggestions) {
      const name = s.name.toLowerCase();
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
    list._suggestions = matches;
    list.innerHTML = matches.map((s, i) =>
      `<li class="ac-item" data-idx="${i}">${esc(s.name)}${s.sciName ? `<span class="ac-sci-name">${esc(s.sciName)}</span>` : ''}<span class="ac-sci">${s.count} results</span></li>`
    ).join('');
    list.classList.add('open');
  }
}

function handleSuggestionClick(s, input) {
  const _taxonRegexes = getTaxonRegexes();

  if (s.searchNames) {
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
    const comRegex = buildPluralRegex(s.name);
    for (const o of window.BIRD_OBJECTS) {
      if (!combined.has(o.id) && comRegex.test(o.title)) combined.set(o.id, o);
    }
    if (window.BIRD_TAXONOMY_OVERRIDES) {
      for (const [id, ovr] of Object.entries(window.BIRD_TAXONOMY_OVERRIDES)) {
        if (ovr.comName === s.name) {
          const obj = _birdObjectMap.get(+id);
          if (obj && !combined.has(obj.id)) combined.set(obj.id, obj);
        }
      }
    }
    const matches = [...combined.values()].sort((a, b) => (b.img || 0) - (a.img || 0));
    setAllMatches(matches);
    showDetailPlaceholder();
    input.value = s.name;
    $('series-select').value = '';
    goToPage(1);
  } else {
    const searchTerm = s.searchName || s.name;
    const regex = buildPluralRegex(searchTerm);
    const combined = new Map();
    for (const o of window.BIRD_OBJECTS) {
      if (regex.test(o.title)) combined.set(o.id, o);
    }
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
    const matches = [...combined.values()].sort((a, b) => (b.img || 0) - (a.img || 0));
    setAllMatches(matches);
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

function extractSeries(title) {
  for (const p of _seriesPatterns) {
    const m = title.match(p);
    if (m) return m[1].trim();
  }
  return null;
}

export function initSeriesDropdown() {
  if (!window.BIRD_OBJECTS) return;
  const map = {};
  for (const o of window.BIRD_OBJECTS) {
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
  const seriesIndex = Object.entries(map)
    .map(([name, items]) => ({ name, items }))
    .sort((a, b) => b.items.length - a.items.length);

  setSeriesIndex(seriesIndex);

  const sel = $('series-select');
  for (let i = 0; i < seriesIndex.length; i++) {
    const s = seriesIndex[i];
    if (s.items.length < 3) continue;
    const opt = document.createElement('option');
    opt.value = i;
    opt.textContent = `${s.name} (${s.items.length})`;
    sel.appendChild(opt);
  }

  document.addEventListener('click', e => {
    const link = e.target.closest('.detail-series-link');
    if (!link) return;
    e.preventDefault();
    const idx = +link.dataset.seriesIdx;
    if (seriesIndex[idx]) {
      sel.value = idx;
      const series = seriesIndex[idx];
      setAllMatches(series.items.slice().sort((a, b) => (b.img || 0) - (a.img || 0)));
      $('art-count').textContent = series.items.length;
      $('met-q').value = '';
      showDetailPlaceholder();
      goToPage(1);
    }
  });

  sel.addEventListener('change', () => {
    const idx = sel.value;
    if (idx === '') return;
    const series = seriesIndex[+idx];
    setAllMatches(series.items.slice().sort((a, b) => (b.img || 0) - (a.img || 0)));
    $('art-count').textContent = series.items.length;
    $('met-q').value = '';
    showDetailPlaceholder();
    goToPage(1);
  });
}
