/* ── taxonomy.js ── Species matching & taxonomy resolution ───── */

/* ── Shared plural-form builder (memoized) ────────────────────── */
const _irregulars = { 'goose':'geese', 'geese':'goose' };
export const _escRx = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const _pluralRegexCache = new Map();

export function buildPluralForms(word) {
  const w = word.toLowerCase();
  const forms = new Set([w]);
  if (_irregulars[w]) forms.add(_irregulars[w]);
  // Plural -> singular
  if (w.endsWith('ies')) forms.add(w.slice(0, -3) + 'y');
  else if (w.endsWith('shes')) forms.add(w.slice(0, -2));
  else if (w.endsWith('ches')) forms.add(w.slice(0, -2));
  else if (w.endsWith('ses')) forms.add(w.slice(0, -2));
  else if (w.endsWith('s')) forms.add(w.slice(0, -1));
  // Singular -> plural
  if (w.endsWith('y')) forms.add(w.slice(0, -1) + 'ies');
  if (w.endsWith('sh') || w.endsWith('ch') || w.endsWith('is')) forms.add(w + 'es');
  forms.add(w + 's');
  return forms;
}

export function buildPluralRegex(word) {
  const key = word.toLowerCase();
  if (_pluralRegexCache.has(key)) return _pluralRegexCache.get(key);
  const forms = buildPluralForms(word);
  const pattern = [...forms].map(f => `(?<![a-z])${_escRx(f)}(?![a-z])`).join('|');
  const regex = new RegExp(pattern, 'i');
  _pluralRegexCache.set(key, regex);
  return regex;
}

/* ── Taxonomy matching ────────────────────────────────────────── */
let _taxonRegexes = [];

export function getTaxonRegexes() { return _taxonRegexes; }

export function initTaxonomy() {
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

export function findTaxonomy(title) {
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
