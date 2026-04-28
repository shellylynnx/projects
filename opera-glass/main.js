// Birds Through an Opera Glass — interactive reader
//
// Plain ES module, no bundler. Serves directly from GitHub Pages.
// Hash routing:
//   #/                    → table of contents (default)
//   #/<entry-slug>        → individual entry view (chapter, preface, etc.)
//   anything else         → "not found" view (falls back to TOC)
//
// Loads chapters.json + metadata.json once, then renders synchronously on
// hashchange. Renders are full-replace into <main>, kept simple — under
// ~80 entries this is plenty fast and avoids client-side framework weight.
//
// chapters.json contains three kinds of entries (`type` field):
//   - "front":  preface, hints to observers
//   - "chapter": the 70 numbered chapters
//   - "back":   appendix sections, books for reference, index

const main = document.querySelector("main");
const topbarTitle = document.getElementById("topbar-title");

// ----------------------------------------------------------------------
// Data load
// ----------------------------------------------------------------------

let entries = [];           // every entry in canonical order
let chapters = [];          // type=="chapter" subset (for prev/next walking)
let metadata = {};
let entriesBySlug = new Map();

// v2 data layers (loaded alongside chapters.json at boot)
let audioBySong = new Map();      // notationFile → audio embed entry
let modernByEbirdCode = new Map();// ebirdCode    → modern-accounts entry
let referencesPattern = null;     // single big alternation regex over all gloss terms
let referencesByTerm = new Map(); // lowercased term → reference entry
let referencesList = [];          // raw references (preserves category, order) for glossary page
let referencesFirstAppearance = null; // lazy: term (lowercased) → {slug, primary, roman} | null

async function loadData() {
  // Required data (chapters + metadata). v2 data files are optional —
  // graceful degradation if any fail to load (the v1 reader still works).
  // We add a no-store fetch hint so curators editing the JSON files see
  // their changes on the next page load instead of waiting for browser
  // cache eviction.
  const noCache = { cache: "no-store" };
  const [chRes, mdRes, auRes, refRes, accRes] = await Promise.all([
    fetch("./data/chapters.json", noCache),
    fetch("./data/metadata.json", noCache),
    fetch("./data/audio-embeds.json", noCache).catch(() => null),
    fetch("./data/references.json", noCache).catch(() => null),
    fetch("./data/modern-accounts.json", noCache).catch(() => null),
  ]);
  if (!chRes.ok) throw new Error(`Failed to load chapters.json (${chRes.status})`);
  if (!mdRes.ok) throw new Error(`Failed to load metadata.json (${mdRes.status})`);
  entries = await chRes.json();
  metadata = await mdRes.json();
  for (const e of entries) {
    if (!e.type) e.type = "chapter";
  }
  chapters = entries.filter((e) => e.type === "chapter");
  entriesBySlug = new Map(entries.map((e) => [e.slug, e]));
  buildChapterLinkPattern();

  // v2: audio embeds
  if (auRes && auRes.ok) {
    const audio = await auRes.json();
    for (const e of audio.embeds || []) {
      audioBySong.set(e.notationFile, e);
    }
  }
  // v2: modern accounts (manual + auto-generated)
  if (accRes && accRes.ok) {
    const acc = await accRes.json();
    for (const a of acc.modernAccounts || []) {
      modernByEbirdCode.set(a.ebirdCode, a);
    }
  }
  // v2: reference glosses
  if (refRes && refRes.ok) {
    const refs = await refRes.json();
    referencesList = refs.references || [];
    buildReferencesPattern(referencesList);
  }
}

// Cross-chapter linking: build one big alternation regex from every chapter
// title fragment (primary, period aliases, modern AOS name). The
// alternatives are escaped + sorted by length descending so longer phrases
// match first ("Yellow-Bellied Sapsucker" before "sapsucker"). The pattern
// is applied to escaped HTML at render time and only the FIRST occurrence
// inside each paragraph gets linked, so the page doesn't turn into a sea
// of underlines.
let chapterLinkRE = null;
let chapterLinkSlugs = new Map(); // lowercased phrase → slug

function buildChapterLinkPattern() {
  const phrases = [];
  const stopWords = new Set([
    "the", "robin", "crow", "bird", "birds", "swallow", "sparrow",
  ]);
  for (const c of chapters) {
    // Each chapter title is "PrimaryName; Alias1; Alias2; …"
    const parts = c.title.split(";").map((s) => s.trim()).filter(Boolean);
    for (const p of parts) {
      addPhrase(p);
    }
    if (c.modernName) addPhrase(c.modernName);

    function addPhrase(raw) {
      const phrase = raw.replace(/[“”"']/g, "").trim();
      // Skip phrases that are too generic or too short
      if (phrase.length < 4) return;
      const lower = phrase.toLowerCase();
      // Don't link very generic single words like "Robin" or "Crow" — too
      // many false positives across other chapters' bodies.
      if (!phrase.includes(" ") && !phrase.includes("-") && stopWords.has(lower)) {
        return;
      }
      phrases.push(phrase);
      chapterLinkSlugs.set(lower, c.slug);
    }
  }
  // Sort longest first so multi-word phrases match before their substrings
  phrases.sort((a, b) => b.length - a.length);
  // Escape regex metacharacters
  const escaped = phrases.map((p) =>
    p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")
  );
  if (escaped.length === 0) return;
  chapterLinkRE = new RegExp(`\\b(${escaped.join("|")})\\b`, "i");
}

function linkifyChapterRefs(escapedHtml, currentSlug) {
  if (!chapterLinkRE) return escapedHtml;
  // Walk the paragraph and link the FIRST occurrence of each distinct
  // phrase. The same phrase appearing twice in one paragraph only gets
  // linked once (so Bailey's repeated "Cowbird. Cowbird." in cross-
  // reference lists doesn't double-link), but DIFFERENT phrases all link.
  // We do the linking via a global regex with a stateful "already linked
  // phrases" set, walking left to right.
  const re = new RegExp(chapterLinkRE.source, "ig");
  const linkedPhrases = new Set();
  // We also need to skip text inside an already-rendered <a>… </a> so we
  // don't double-link a pigeon-hole anchor or other prior link.
  let result = "";
  let cursor = 0;
  let insideTag = false;
  // Find anchor regions to skip
  const anchorRe = /<a\b[^>]*>[\s\S]*?<\/a>/gi;
  const skipRanges = [];
  let am;
  while ((am = anchorRe.exec(escapedHtml)) !== null) {
    skipRanges.push([am.index, am.index + am[0].length]);
  }
  function inSkip(pos) {
    for (const [s, e] of skipRanges) {
      if (pos >= s && pos < e) return true;
    }
    return false;
  }
  let m;
  while ((m = re.exec(escapedHtml)) !== null) {
    const phrase = m[1];
    const lower = phrase.toLowerCase();
    const slug = chapterLinkSlugs.get(lower);
    if (!slug || slug === currentSlug) continue;
    if (linkedPhrases.has(lower)) continue;
    if (inSkip(m.index)) continue;
    linkedPhrases.add(lower);
    result += escapedHtml.slice(cursor, m.index);
    result +=
      `<a class="chapter-ref-link" href="#/${slug}">${phrase}</a>`;
    cursor = m.index + phrase.length;
  }
  result += escapedHtml.slice(cursor);
  return result;
}

// ----------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------

function escapeHtml(s) {
  if (s == null) return "";
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

// Light-touch markdown rendering for back-matter entries. Supports:
//   ### heading
//   - bullet
//   [text](href)
//   blank line → paragraph break
// Anything else is rendered as plain prose. We intentionally don't pull in
// a full markdown parser — only the synthesised index uses these constructs.
function renderMarkdownLight(text) {
  const out = [];
  const blocks = text.split(/\n{2,}/);
  for (const blockRaw of blocks) {
    const block = blockRaw.trim();
    if (!block) continue;
    const lines = block.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length === 0) continue;
    // Heading block (single line starting with ###)
    if (lines.length === 1 && /^#{2,4}\s+/.test(lines[0])) {
      const level = lines[0].match(/^(#+)/)[1].length;
      const tag = `h${Math.min(level + 1, 6)}`;
      const txt = lines[0].replace(/^#+\s+/, "");
      out.push(`<${tag} class="md-heading">${formatInline(txt)}</${tag}>`);
      continue;
    }
    // Bullet list block
    if (lines.every((l) => /^-\s+/.test(l))) {
      const items = lines
        .map((l) => `<li>${formatInline(l.replace(/^-\s+/, ""))}</li>`)
        .join("");
      out.push(`<ul class="md-list">${items}</ul>`);
      continue;
    }
    // Plain paragraph (lines join with spaces)
    out.push(`<p>${formatInline(lines.join(" "))}</p>`);
  }
  return out.join("");
}

function formatInline(text) {
  // [label](href) → <a href="href">label</a>
  // We escape first then run the link regex on the escaped form so we can
  // safely emit raw href attributes; & in href are already encoded.
  let out = escapeHtml(text);
  out = out.replace(
    /\[([^\]]+)\]\(([^)]+)\)/g,
    (_, label, href) => {
      const safeHref = href.replace(/"/g, "%22");
      // External links (http/https) get target=_blank; internal hash links don't.
      const isExternal = /^https?:\/\//i.test(href);
      const ext = isExternal ? ' target="_blank" rel="noopener"' : "";
      return `<a href="${safeHref}"${ext}>${label}</a>`;
    }
  );
  return out;
}

function paragraphsHtml(text, currentSlug) {
  // chapters.json paragraphs are split by double newlines.
  return text
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map((p) => {
      let html = escapeHtml(p);
      // 1. Inline music notation + audio (renders structural HTML)
      html = inlineSongNotations(html);
      // 2. Cross-page meta links
      html = linkifyPigeonHoles(html);
      // 3. Cross-chapter species references (one per phrase per paragraph)
      html = linkifyChapterRefs(html, currentSlug);
      // 4. v2: vernacular + period-reference glosses (every match)
      html = linkifyReferences(html);
      return `<p>${html}</p>`;
    })
    .join("");
}

// Per-crop alt text for the 11 song-notation images. Wording follows the
// pattern set in the polish handoff: "Florence Merriam Bailey's 1889
// transcription of the <bird>'s <syllabic phrase>, beneath the inline
// music notation." Sourced from gallery-quotes.md / MANIFEST.md.
const SONG_ALT = {
  "wood-pewee_come-to-me.png":
    'Florence Merriam Bailey\'s 1889 transcription of the Wood Pewee\'s "come to me" song phrase, with the phonetic syllables beneath the inline music notation.',
  "wood-pewee_u-of-sound.png":
    'Florence Merriam Bailey\'s 1889 transcription of the Wood Pewee\'s descending "U of sound" song pattern, beneath the inline music notation.',
  "wood-pewee_dear-ie.png":
    'Florence Merriam Bailey\'s 1889 transcription of the Wood Pewee\'s "dear-ie dear-ie dear" song variant, three pairs of syllables beneath the inline music notation.',
  "american-goldfinch_dee-ree.png":
    'Florence Merriam Bailey\'s 1889 transcription of the American Goldfinch\'s flight call as "dee-ree, dee-ee-ree," beneath the inline music notation.',
  "white-throated-sparrow_pea-bod-dy.png":
    'Florence Merriam Bailey\'s 1889 transcription of the White-Throated Sparrow\'s song with two variations of "I-I-pea-bod-dy," beneath the inline music notation.',
  "ovenbird_teach-er-crescendo.png":
    'Florence Merriam Bailey\'s 1889 transcription of the Ovenbird\'s crescendo song as "teach-er teach-er teach-er teach-er teacher," beneath the inline music notation.',
  "white-crowned-sparrow_whe-he-hee.png":
    'Florence Merriam Bailey\'s 1889 transcription of the White-Crowned Sparrow\'s song as "whe-he-he-he-hee-hö," beneath the inline music notation.',
  "american-redstart_te-ka-teek.png":
    'Florence Merriam Bailey\'s 1889 transcription of the American Redstart\'s song as "Te-ka-te-ka-te-ka-te-ka-teek\'," beneath the inline music notation.',
  "black-throated-blue-warbler_z-ie.png":
    'Florence Merriam Bailey\'s 1889 transcription of the Black-Throated Blue Warbler\'s "z-ie" guttural call, beneath the inline music notation.',
  "hermit-thrush_main-song.png":
    "Florence Merriam Bailey's 1889 transcription of the Hermit Thrush's three-part main song with mid-phrase trills, beneath the inline music notation.",
  "hermit-thrush_variation.png":
    'Florence Merriam Bailey\'s 1889 transcription of a Hermit Thrush song variation as "ah re oo-oo," in broken-song form, beneath the inline music notation.',
};

// Inline song-notation markers `[[SONG:filename]]` placed in chapters.json
// where Bailey originally set the music notation in the book. Each marker
// gets replaced with a small inline figure that breaks out of the
// surrounding paragraph flow visually. If an audio embed has been
// curated for this notation (data/audio-embeds.json), a xeno-canto
// iframe with a modern recording renders below the notation image —
// lazy-loaded via native `loading="lazy"` on the iframe.
//
// Why xeno-canto and not Macaulay: Cornell's media CDN at
// `cdn.download.ams.birds.cornell.edu` does not permit cross-origin
// requests from `shellylynnx.github.io` — the previous native <audio>
// implementation showed controls but clicking play did nothing because
// the browser blocked the cross-origin media request. xeno-canto's
// embed widget runs the audio inside their own iframe (no CORS issue,
// since the request originates from xeno-canto's domain), and their
// recordings are CC-licensed with attribution rendered automatically by
// the widget. Many of the picks are also geographically aligned with
// Bailey's actual fieldwork sites in Hampshire County, MA (Smith
// College) and Westchester / Chautauqua County, NY.
//
// Runs AFTER escapeHtml so we can safely emit raw HTML.
function inlineSongNotations(escapedHtml) {
  return escapedHtml.replace(
    /\[\[SONG:([^\]]+)\]\]/g,
    (_, filename) => {
      const safe = filename.replace(/"/g, "&quot;");
      const alt =
        SONG_ALT[filename] ||
        "Florence Merriam Bailey's transcription of the bird's song with phonetic lyrics, from the 1893 edition.";
      const safeAlt = escapeHtml(alt);
      // The song-notation IMAGE renders inline where Bailey set it.
      let html = `</p><figure class="chapter-song-inline"><img src="./assets/songs/${safe}" alt="${safeAlt}" loading="lazy" /></figure>`;
      const audio = audioBySong.get(filename);
      if (audio) {
        // Strip the "XC" prefix to build embed/recording URLs (data
        // stores the prefixed form for human readability).
        const xcId = String(audio.xenoCantoId || "").replace(/^XC/i, "");
        const embedUrl = audio.embedURL || `https://xeno-canto.org/${xcId}/embed`;
        const recordingUrl = audio.recordingURL || `https://xeno-canto.org/${xcId}`;
        const safeEmbedUrl = escapeHtml(embedUrl);
        const safeRecordingUrl = escapeHtml(recordingUrl);
        const safeRecordist = escapeHtml(audio.recordist || "");
        const safeLocation = escapeHtml(audio.location || "");
        const safeCaption = escapeHtml(audio.caption || "");
        const safePhrase = escapeHtml(audio.baileyPhrase || "");
        const safeSpecies = escapeHtml(audio.species || "");
        const safeId = escapeHtml(audio.xenoCantoId || `XC${xcId}`);
        // The xeno-canto widget renders its own license, recordist,
        // location, and play controls inside the iframe. Our figcaption
        // adds the editorial framing (Bailey's phrase + curatorial
        // caption) and a duplicated recordist/location line for
        // accessibility tools and users with iframe blockers.
        html += `<figure class="audio-embed">
  <iframe
    src="${safeEmbedUrl}"
    width="100%"
    height="220"
    frameborder="0"
    loading="lazy"
    title="${safeSpecies} song recording — ${safePhrase} — from xeno-canto ${safeId}"
  ></iframe>
  <figcaption>
    ${safePhrase ? `<strong>&ldquo;${safePhrase}&rdquo;</strong> &middot; ` : ""}
    Modern recording by <a href="${safeRecordingUrl}" target="_blank" rel="noopener">${safeRecordist}</a>
    via <a href="https://xeno-canto.org" target="_blank" rel="noopener">xeno-canto</a>
    ${safeLocation ? `<span class="audio-location">(${safeLocation})</span>` : ""}
    &middot; ${safeCaption}
  </figcaption>
</figure>`;
      }
      html += `<p>`;
      return html;
    }
  );
}

// Audio embeds use native `loading="lazy"` directly on the iframe — the
// browser defers the request until the iframe nears the viewport, no
// custom IntersectionObserver needed. This stub stays for callsites
// expecting `setupAudioLazyMount` (called after each render) but is now a
// no-op; the iframe + Macaulay player are already in the DOM.
function setupAudioLazyMount() {
  /* native loading="lazy" handles deferral; nothing to do at render time */
}

// Auto-link every "pigeon-hole" / "pigeon-holes" / "Pigeon-Hole" reference
// in chapter prose to the appendix diagram. Bailey uses the term as a
// running metaphor throughout the book (~19 times), and the diagram is
// the visual key. We run the regex on the ALREADY-escaped string so we
// don't have to re-escape anything inside the link.
function linkifyPigeonHoles(escapedHtml) {
  return escapedHtml.replace(
    /\bpigeon[-‐‑]hole(s)?\b/gi,
    '<a class="pigeon-hole-link" href="#/appendix-pigeon-holes">$&</a>'
  );
}

// ----------------------------------------------------------------------
// v2: Reference glosses (vernacular + period reference tooltips)
// ----------------------------------------------------------------------

// Build one big alternation regex from every reference term + alias. Sort
// alternatives longest-first so phrases match before bare surnames
// ("Mr. Burroughs" before "Burroughs"). Aliases mapped back to the parent
// term so the tooltip lookup always finds the canonical entry.
function buildReferencesPattern(refs) {
  const phrases = [];
  for (const r of refs) {
    if (!r.term) continue;
    const all = [r.term, ...(r.aliases || [])];
    for (const phrase of all) {
      phrases.push(phrase);
      referencesByTerm.set(phrase.toLowerCase(), r);
    }
  }
  if (!phrases.length) return;
  phrases.sort((a, b) => b.length - a.length);
  const escaped = phrases.map((p) =>
    p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")
  );
  // Word-boundary on both sides — but Bailey often quotes phrases in
  // curly quotes, so we accept quote chars as word boundaries too. We
  // post-process matches that fall inside other anchor elements.
  referencesPattern = new RegExp(`(?:^|\\b|(?<=[“”"'’‘]))(${escaped.join("|")})(?:\\b|(?=[“”"'’‘.,;:!?)])|$)`, "g");
}

// Inject `<span class="glossed glossed-{type}">` wrappers around every
// reference-term match in a paragraph's escaped HTML. Skips matches that
// already sit inside an anchor (cross-chapter links, pigeon-hole links).
// One-pass walker maintains a "skip range" set so we never double-link.
function linkifyReferences(escapedHtml) {
  if (!referencesPattern || !referencesByTerm.size) return escapedHtml;
  // Identify anchor regions to skip
  const skip = [];
  const tagRe = /<a\b[^>]*>[\s\S]*?<\/a>|<[^>]+>/gi;
  let m;
  while ((m = tagRe.exec(escapedHtml)) !== null) {
    skip.push([m.index, m.index + m[0].length]);
  }
  function inSkip(pos) {
    for (const [s, e] of skip) {
      if (pos >= s && pos < e) return true;
    }
    return false;
  }
  let result = "";
  let cursor = 0;
  // Reset regex state between paragraphs (function is called per paragraph)
  referencesPattern.lastIndex = 0;
  let rm;
  while ((rm = referencesPattern.exec(escapedHtml)) !== null) {
    const matchText = rm[1];
    const matchStart = rm.index + rm[0].indexOf(matchText);
    if (inSkip(matchStart)) continue;
    const ref = referencesByTerm.get(matchText.toLowerCase());
    if (!ref) continue;
    result += escapedHtml.slice(cursor, matchStart);
    const safeType = (ref.type || "").replace(/[^a-z0-9-]/g, "");
    result += `<span class="glossed glossed-${safeType}" tabindex="0" data-term="${escapeHtml(ref.term)}">${matchText}</span>`;
    cursor = matchStart + matchText.length;
  }
  result += escapedHtml.slice(cursor);
  return result;
}

// Tooltip controller. Single shared tooltip element, positioned near the
// hovered/focused/tapped `.glossed` span. Dismiss on mouseout, blur,
// Escape, or scroll. On mobile, taps anywhere outside the glossed span
// dismiss it.
let glossTooltipEl = null;
let glossActiveEl = null;

function ensureTooltipEl() {
  if (glossTooltipEl) return glossTooltipEl;
  glossTooltipEl = document.createElement("div");
  glossTooltipEl.className = "gloss-tooltip";
  glossTooltipEl.setAttribute("role", "tooltip");
  glossTooltipEl.hidden = true;
  document.body.appendChild(glossTooltipEl);
  return glossTooltipEl;
}

function showTooltip(spanEl) {
  const term = spanEl.getAttribute("data-term");
  const ref = referencesByTerm.get(term.toLowerCase());
  if (!ref) return;
  const tip = ensureTooltipEl();
  glossActiveEl = spanEl;
  const safeType = (ref.type || "").replace(/[^a-z0-9-]/g, "");
  tip.className = `gloss-tooltip gloss-tooltip-${safeType}`;
  tip.innerHTML = `
    <div class="gloss-modern">${escapeHtml(ref.modern || "")}</div>
    <div class="gloss-note">${escapeHtml(ref.note || "")}</div>
    <div class="gloss-type">${escapeHtml(ref.type || "")}</div>
  `;
  tip.hidden = false;
  positionTooltip(tip, spanEl);
}

function positionTooltip(tip, anchor) {
  const r = anchor.getBoundingClientRect();
  const tipRect = tip.getBoundingClientRect();
  const margin = 8;
  // Default: below the term, left-aligned to it
  let top = r.bottom + window.scrollY + margin;
  let left = r.left + window.scrollX;
  // Clamp horizontally
  if (left + tipRect.width > window.scrollX + document.documentElement.clientWidth - margin) {
    left = window.scrollX + document.documentElement.clientWidth - tipRect.width - margin;
  }
  if (left < window.scrollX + margin) left = window.scrollX + margin;
  // If the tooltip would fall below the viewport, flip above the term
  if (r.bottom + tipRect.height + margin > window.innerHeight) {
    top = r.top + window.scrollY - tipRect.height - margin;
  }
  tip.style.top = top + "px";
  tip.style.left = left + "px";
}

function hideTooltip() {
  if (glossTooltipEl) glossTooltipEl.hidden = true;
  glossActiveEl = null;
}

function setupGlossTooltips() {
  // Delegated event listener — survives every <main> render.
  document.addEventListener("mouseover", (e) => {
    const span = e.target.closest(".glossed");
    if (span) showTooltip(span);
  });
  document.addEventListener("mouseout", (e) => {
    const span = e.target.closest(".glossed");
    if (span && (!e.relatedTarget || !e.relatedTarget.closest(".glossed,.gloss-tooltip"))) {
      hideTooltip();
    }
  });
  document.addEventListener("focusin", (e) => {
    const span = e.target.closest(".glossed");
    if (span) showTooltip(span);
  });
  document.addEventListener("focusout", (e) => {
    if (e.target.closest(".glossed")) hideTooltip();
  });
  // Tap support: tap inside the span shows; tap outside dismisses
  document.addEventListener("click", (e) => {
    const span = e.target.closest(".glossed");
    if (span) {
      // Toggle on second tap of the same span
      if (glossActiveEl === span) hideTooltip();
      else showTooltip(span);
      e.preventDefault();
      return;
    }
    if (!e.target.closest(".gloss-tooltip")) hideTooltip();
  });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") hideTooltip();
  });
  window.addEventListener("scroll", hideTooltip, { passive: true });
}

// ----------------------------------------------------------------------
// v2: Modern-accounts footer block per species chapter
// ----------------------------------------------------------------------

function renderModernAccountsFooter(entry) {
  if (entry.type !== "chapter") return "";
  const code = entry.ebirdCode;
  if (!code) return "";
  const acct = modernByEbirdCode.get(code);
  // Even without a curated account, we always have eBird via chapters.json
  const ebirdUrl = `https://ebird.org/species/${encodeURIComponent(code)}`;
  const items = [
    { label: "eBird species page", href: ebirdUrl },
  ];
  if (acct) {
    if (acct.cornell)   items.push({ label: "Cornell All About Birds", href: acct.cornell });
    if (acct.audubon)   items.push({ label: "Audubon Field Guide",     href: acct.audubon });
    if (acct.wikipedia) items.push({ label: "Wikipedia",               href: acct.wikipedia });
    if (acct.macaulay)  items.push({ label: "More recordings on Macaulay Library", href: acct.macaulay });
  }
  const rows = items
    .map(
      (i) =>
        `<li><a href="${escapeHtml(i.href)}" target="_blank" rel="noopener">${escapeHtml(i.label)}</a></li>`
    )
    .join("");
  const modernNameLine = entry.modernName
    ? `<p class="modern-accounts-modern">Modern name: ${escapeHtml(entry.modernName)}</p>`
    : "";
  return `<aside class="modern-accounts" aria-label="Modern accounts of this species">
    <h3>Modern accounts</h3>
    ${modernNameLine}
    <ul>${rows}</ul>
  </aside>`;
}

// ----------------------------------------------------------------------
// v2: Reading progress (visited slugs in localStorage)
// ----------------------------------------------------------------------

const PROGRESS_KEY = "opera-glass-progress";

function readProgress() {
  try {
    const raw = localStorage.getItem(PROGRESS_KEY);
    if (!raw) return { lastVisited: null, read: [] };
    const parsed = JSON.parse(raw);
    return {
      lastVisited: parsed.lastVisited || null,
      read: Array.isArray(parsed.read) ? parsed.read : [],
    };
  } catch (e) {
    return { lastVisited: null, read: [] };
  }
}

function recordVisit(slug) {
  if (!slug) return;
  const p = readProgress();
  if (!p.read.includes(slug)) p.read.push(slug);
  p.lastVisited = slug;
  try {
    localStorage.setItem(PROGRESS_KEY, JSON.stringify(p));
  } catch (e) {
    /* private mode — no-op */
  }
}

function clearProgress() {
  try {
    localStorage.removeItem(PROGRESS_KEY);
  } catch (e) {}
}

function ebirdHref(code) {
  if (!code) return null;
  return `https://ebird.org/species/${code}`;
}

function setView(name) {
  document.body.setAttribute("data-view", name);
}

function setTopbarTitle(text) {
  if (topbarTitle) topbarTitle.textContent = text;
}

function setDocTitle(suffix) {
  document.title = suffix
    ? `${suffix} — Birds Through an Opera Glass`
    : "Birds Through an Opera Glass — Florence Merriam Bailey, 1889";
}

function primaryTitleOf(entry) {
  return entry.title.split(";")[0].trim();
}

// ----------------------------------------------------------------------
// Renderers
// ----------------------------------------------------------------------

function renderTOC() {
  setView("toc");
  setTopbarTitle(metadata.title || "Birds Through an Opera Glass");
  setDocTitle(null);

  const front = entries.filter((e) => e.type === "front");
  const back = entries.filter((e) => e.type === "back");

  // v2: reading-progress state — visited slugs become muted, last-visited
  // surfaces as a "Continue reading" link near the hero.
  const progress = readProgress();
  const readSet = new Set(progress.read);
  const continueEntry = progress.lastVisited
    ? entriesBySlug.get(progress.lastVisited)
    : null;

  const frontItems = front
    .map(
      (e) => {
        const isRead = readSet.has(e.slug) ? " is-read" : "";
        return `
        <li>
          <a class="toc-link toc-link-supp${isRead}" href="#/${encodeURIComponent(e.slug)}">
            <span class="toc-roman">&nbsp;</span>
            <span class="toc-title">${escapeHtml(e.title)}</span>
            <span class="toc-page"></span>
          </a>
        </li>`;
      }
    )
    .join("");

  const chapterItems = chapters
    .map((c) => {
      const primary = escapeHtml(primaryTitleOf(c));
      const dot = c.illustration
        ? '<span class="toc-illus-dot" aria-label="has illustration"></span>'
        : "";
      const isRead = readSet.has(c.slug) ? " is-read" : "";
      // Period vernacular aliases are rendered as a separate line BELOW the
      // primary title (display: block via CSS), AND prefixed with a
      // middle-dot separator that bakes the relationship into the markup.
      // Two reasons to keep the dot even though CSS already breaks the line:
      //   1. textContent (used by screen readers, web search, copy-paste)
      //      reads "Primary · Alias" instead of "PrimaryAlias" jammed
      //      together.
      //   2. If the stylesheet fails or is overridden the names still don't
      //      collide — they're separated by a visible character.
      const aliasParts = c.title.split(";").slice(1).map((s) => s.trim()).filter(Boolean);
      const aliases = aliasParts.length
        ? `<span class="toc-alias"> · ${aliasParts.map((a) => escapeHtml(a)).join("; ")}</span>`
        : "";
      const page = c.bookPageStart ? `p. ${c.bookPageStart}` : "";
      return `
        <li>
          <a class="toc-link${isRead}" href="#/${encodeURIComponent(c.slug)}">
            <span class="toc-roman">${escapeHtml(c.roman)}.</span>
            <span class="toc-title">${primary}${dot}${aliases}</span>
            <span class="toc-page">${page}</span>
          </a>
        </li>`;
    })
    .join("");

  const backItems = back
    .map(
      (e) => {
        const isRead = readSet.has(e.slug) ? " is-read" : "";
        return `
        <li>
          <a class="toc-link toc-link-supp${isRead}" href="#/${encodeURIComponent(e.slug)}">
            <span class="toc-roman">&nbsp;</span>
            <span class="toc-title">${escapeHtml(e.title)}</span>
            <span class="toc-page"></span>
          </a>
        </li>`;
      }
    )
    .join("");

  // v2: search input + reading-progress strip — both placed above the
  // hero so a returning reader can pick up where they left off and search
  // is the first action available.
  const continueLink = continueEntry
    ? `<p class="continue-reading">
         Continue reading from
         <a href="#/${encodeURIComponent(continueEntry.slug)}">${escapeHtml(primaryTitleOf(continueEntry))}</a>
         &rarr;
         <button type="button" class="progress-clear" aria-label="Clear reading history">clear progress</button>
       </p>`
    : "";

  // v2: glossary surfaces in two places — as an editorial note inside
  // the TOC intro prose (so a reader learns what the underlines mean at
  // the moment they show up), and as a "Reference" group at the bottom
  // of the TOC list (so the glossary is also reachable from the
  // navigable-things mental model, peer to front/back matter).
  const glossaryIntroLine = referencesList.length
    ? `<p class="toc-intro-glossary">
         Where Bailey names a naturalist, quotes a poet, or uses a word
         that has shifted since 1889, the term is underlined and carries
         a short note. The same ${referencesList.length} notes are
         <a href="#/glossary">collected as a glossary</a>.
       </p>`
    : "";

  const referenceGroup = referencesList.length
    ? `<hr class="toc-section-rule" />
       <p class="toc-group-label">Reference</p>
       <ul class="toc-list" aria-label="Reference">
         <li>
           <a class="toc-link toc-link-supp" href="#/glossary">
             <span class="toc-roman">&nbsp;</span>
             <span class="toc-title">Glossary of annotated terms</span>
             <span class="toc-page">${referencesList.length}</span>
           </a>
         </li>
       </ul>`
    : "";

  main.innerHTML = `
    <div class="search-wrap" role="search">
      <input
        type="search"
        id="book-search"
        class="search-input"
        autocomplete="off"
        placeholder="Search 70 chapters and ${referencesByTerm.size || 0} references…"
        aria-label="Search the book"
      />
      <ul class="search-results" id="search-results" role="listbox" hidden></ul>
    </div>

    ${continueLink}

    <section class="toc-hero">
      <img src="./assets/title-page.png" alt="Title page of the 1893 Riverside Press reprint of Birds Through an Opera Glass by Florence A. Merriam, with the publisher imprint Houghton, Mifflin and Company. Boston and New York." />
      <h1 class="toc-hero-title">${escapeHtml(metadata.title)}</h1>
      <p class="toc-hero-subtitle">${escapeHtml(metadata.subtitle || "")}</p>
      <p class="toc-hero-byline">
        by <strong>${escapeHtml(metadata.author)}</strong>
      </p>
      <p class="toc-hero-meta">
        ${escapeHtml(metadata.publisher)}, ${metadata.yearPublished} &middot;
        ${escapeHtml(metadata.reprintEdition || "")}
      </p>
    </section>

    <div class="toc-intro">
      <p>
        Florence Merriam Bailey wrote <em>Birds Through an Opera Glass</em> in
        1889 as a beginner's guide to watching birds without killing them. It is
        one of the first popular American bird books to argue that the opera
        glass and a careful eye were enough &mdash; you did not need to shoot the
        bird to study it. Seventy short chapters, from <em>The Robin</em> to
        <em>The Hermit Thrush</em>, each one a few pages of plain field
        observation written for someone learning to look.
      </p>
      <p>
        The text and illustrations are public domain. This reading copy was
        scanned by the Internet Archive from the Riverside Press 1893 reprint,
        OCR'd, and laid out for the screen.
      </p>
      ${glossaryIntroLine}
    </div>

    <hr class="toc-section-rule" />

    ${
      front.length
        ? `<p class="toc-group-label">Front matter</p>
           <ul class="toc-list" aria-label="Front matter">${frontItems}</ul>
           <hr class="toc-section-rule" />`
        : ""
    }

    <p class="toc-group-label">Chapters</p>
    <ul class="toc-list" aria-label="Chapter list">${chapterItems}</ul>

    ${
      back.length
        ? `<hr class="toc-section-rule" />
           <p class="toc-group-label">Back matter</p>
           <ul class="toc-list" aria-label="Back matter">${backItems}</ul>`
        : ""
    }

    ${referenceGroup}
  `;

  // v2: wire search input + clear-progress button (must run after innerHTML)
  setupSearch();
  const clearBtn = main.querySelector(".progress-clear");
  if (clearBtn) {
    clearBtn.addEventListener("click", (e) => {
      e.preventDefault();
      clearProgress();
      route(); // re-render TOC without the "continue reading" line
    });
  }

  // Ensure we land at the top of the TOC even if the user was deep in a chapter
  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}

function renderEntry(entry) {
  setView(entry.type === "chapter" ? "chapter" : "supplement");
  const primary = primaryTitleOf(entry);
  setTopbarTitle(primary);
  if (entry.type === "chapter") {
    setDocTitle(`${entry.roman}. ${primary}`);
  } else {
    setDocTitle(primary);
  }

  // Modern name + eBird link (chapters only)
  let modernHtml = "";
  if (entry.type === "chapter" && entry.modernName) {
    const href = ebirdHref(entry.ebirdCode);
    const link = href
      ? `<a href="${href}" rel="noopener" target="_blank">${escapeHtml(entry.modernName)}</a>`
      : escapeHtml(entry.modernName);
    modernHtml = `<p class="chapter-modern">Modern name: ${link}</p>`;
  }
  if (entry.type === "chapter") {
    const aliasParts = entry.title.split(";").slice(1).map((s) => s.trim()).filter(Boolean);
    if (aliasParts.length) {
      const aliasText = aliasParts.join("; ");
      modernHtml += `<p class="chapter-modern">Also called: <em>${escapeHtml(aliasText)}</em></p>`;
    }
  }

  // Audio embeds render INLINE inside the chapter body, paired with each
  // song-notation image at Bailey's original position (see
  // inlineSongNotations). They use the Macaulay iframe at full player
  // height so all controls (play, pause, scrub, volume, share) are
  // visible without scrolling inside the iframe itself.
  const topAudioHtml = "";

  // Primary illustration (chapters only)
  let illusHtml = "";
  if (entry.illustration) {
    const altPrefix = entry.modernName || primary;
    illusHtml += `
      <figure class="chapter-illus">
        <img src="./assets/illustrations/${escapeHtml(entry.illustration)}" alt="Period illustration of ${escapeHtml(altPrefix)} from the 1893 Riverside Press edition." loading="eager" />
      </figure>`;
    if (entry.illustrationSecondary) {
      illusHtml += `
        <figure class="chapter-illus">
          <img src="./assets/illustrations/${escapeHtml(entry.illustrationSecondary)}" alt="Second period illustration of ${escapeHtml(altPrefix)}." loading="lazy" />
        </figure>`;
    }
  }

  // Song notations (chapters only — fallback bottom block; in practice the
  // markers in the body inline them and `entry.songNotations` is empty for
  // those chapters). Uses the same per-crop alt text as the inline path.
  let songsHtml = "";
  if (entry.songNotations && entry.songNotations.length) {
    const items = entry.songNotations
      .map((f) => {
        const alt =
          SONG_ALT[f] ||
          "Florence Merriam Bailey's transcription of the bird's song with phonetic lyrics, from the 1893 edition.";
        return `
        <figure class="chapter-song">
          <img src="./assets/songs/${escapeHtml(f)}" alt="${escapeHtml(alt)}" loading="lazy" />
        </figure>`;
      })
      .join("");
    songsHtml = `
      <section class="chapter-songs" aria-label="Song notation">
        <p class="chapter-songs-label">Song notation, transcribed by Bailey</p>
        ${items}
      </section>`;
  }

  // Body: chapters and front-matter use plain paragraph rendering.
  // Back matter (especially the synthesised index and the family-character-
  // istics subsection headings) may contain markdown links and headings, so
  // we route it through renderMarkdownLight().
  let bodyHtml =
    entry.type === "back"
      ? renderMarkdownLight(entry.text)
      : paragraphsHtml(entry.text, entry.slug);

  // Some back-matter entries embed the original page scans as full-figure
  // images (e.g., the pigeon-holes diagram, which doesn't OCR meaningfully).
  if (entry.appendixPages && entry.appendixPages.length) {
    const pages = entry.appendixPages
      .map(
        (f, i) => `
        <figure class="appendix-page">
          <img src="./assets/appendix-pages/${escapeHtml(f)}" alt="Scan of book page ${escapeHtml(String(206 + i))} of Birds Through an Opera Glass: Bailey's pigeon-holes diagram showing how she organises the perching birds covered in the book into fourteen labelled categories." loading="lazy" />
          <figcaption>Book page ${206 + i}</figcaption>
        </figure>`
      )
      .join("");
    bodyHtml += `<div class="appendix-pages">${pages}</div>`;
  }

  // Prev/next navigation walks across ALL entries in canonical order so a
  // reader can flow Preface → Hints → chapter I → … → chapter LXX →
  // Family Characteristics → … → Index.
  const idx = entries.findIndex((e) => e.slug === entry.slug);
  const prev = idx > 0 ? entries[idx - 1] : null;
  const next = idx < entries.length - 1 ? entries[idx + 1] : null;

  const navLabel = (e, dir) => {
    if (e.type === "chapter") {
      const arrow = dir === "prev" ? "&larr;" : "&rarr;";
      return `${dir === "prev" ? arrow + " " : ""}${escapeHtml(e.roman)}.${dir === "next" ? " " + arrow : ""}`;
    }
    return dir === "prev" ? "&larr;" : "&rarr;";
  };

  const navHtml = `
    <nav class="chapter-nav" aria-label="Chapter navigation">
      ${
        prev
          ? `<a class="chapter-nav-prev" href="#/${encodeURIComponent(prev.slug)}" rel="prev">
               <span class="chapter-nav-label">${navLabel(prev, "prev")}</span>
               <span class="chapter-nav-target">${escapeHtml(primaryTitleOf(prev))}</span>
             </a>`
          : `<span class="chapter-nav-prev"></span>`
      }
      <a class="chapter-nav-toc" href="#/">Contents</a>
      ${
        next
          ? `<a class="chapter-nav-next" href="#/${encodeURIComponent(next.slug)}" rel="next">
               <span class="chapter-nav-label">${navLabel(next, "next")}</span>
               <span class="chapter-nav-target">${escapeHtml(primaryTitleOf(next))}</span>
             </a>`
          : `<span class="chapter-nav-next"></span>`
      }
    </nav>`;

  // Header label varies by entry type.
  let kickerHtml;
  if (entry.type === "chapter") {
    kickerHtml = `<p class="chapter-roman">Chapter ${escapeHtml(entry.roman)}</p>`;
  } else if (entry.type === "front") {
    kickerHtml = `<p class="chapter-roman">Front matter</p>`;
  } else {
    kickerHtml = `<p class="chapter-roman">${escapeHtml(entry.slug === "index" ? "Index" : "Appendix")}</p>`;
  }

  // v2: modern-accounts footer for species chapters (renders nothing for
  // front matter / appendix entries, which have no ebirdCode).
  const modernAccountsFooter = renderModernAccountsFooter(entry);

  // v2: glossary back-link, rendered as its own slim row below the
  // modern-accounts aside (or directly below the chapter body for entries
  // without an aside) and above the prev/next nav. Sibling to the
  // modern-accounts aside — both are "this digital edition adds" content.
  const glossaryFooter = referencesList.length
    ? `<aside class="chapter-glossary-footer" aria-label="Reference">
         <a href="#/glossary">Browse the glossary of ${referencesList.length} annotated terms &rarr;</a>
       </aside>`
    : "";

  main.innerHTML = `
    <article class="chapter">
      ${kickerHtml}
      <h1 class="chapter-title">${escapeHtml(primary)}</h1>
      ${modernHtml}
      ${topAudioHtml}
      ${illusHtml}
      <div class="chapter-body">
        ${bodyHtml}
      </div>
      ${songsHtml}
      ${modernAccountsFooter}
      ${glossaryFooter}
    </article>
    ${navHtml}
  `;

  // v2: record this visit so the next TOC render shows "Continue reading"
  // and the chapter row appears in muted-read style.
  recordVisit(entry.slug);

  // v2: wire IntersectionObserver lazy-mount for any inline Macaulay embeds
  setupAudioLazyMount();

  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
  if (main && typeof main.focus === "function") {
    main.focus({ preventScroll: true });
  }
}

function renderNotFound(slug) {
  setView("notfound");
  setTopbarTitle("Not found");
  setDocTitle("Not found");
  main.innerHTML = `
    <section class="toc-intro" style="padding-top:3rem;">
      <h1 class="chapter-title">Not found</h1>
      <p>No entry with the slug <code>${escapeHtml(slug)}</code>. Try the
      <a href="#/">table of contents</a>.</p>
    </section>
  `;
}

// ----------------------------------------------------------------------
// v2: Glossary page (#/glossary) — every reference term in one place,
// grouped by category, each linked to the first chapter where it appears.
// ----------------------------------------------------------------------

// Compute, once, the first chapter (in book order) that contains each
// reference term or alias. Returns a Map keyed by the lowercased canonical
// term. Skipped if references didn't load. Result cached in
// `referencesFirstAppearance` so re-renders of the glossary don't re-scan.
function computeReferencesFirstAppearance() {
  if (referencesFirstAppearance) return referencesFirstAppearance;
  referencesFirstAppearance = new Map();
  if (!referencesList.length) return referencesFirstAppearance;

  // Build a per-reference regex (term + aliases, longest-first, case-insensitive).
  // We do it per-reference rather than reusing the global pattern because we
  // need to attribute each match back to a SPECIFIC term, and the global
  // pattern's capture group only gives us the matched text.
  const regexes = referencesList.map((r) => {
    const phrases = [r.term, ...(r.aliases || [])].filter(Boolean);
    if (!phrases.length) return null;
    phrases.sort((a, b) => b.length - a.length);
    const escaped = phrases.map((p) =>
      p.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")
    );
    return new RegExp(`(?:^|\\b|(?<=[“”"'’‘]))(${escaped.join("|")})(?:\\b|(?=[“”"'’‘.,;:!?)])|$)`, "i");
  });

  // Walk entries in canonical order. First match wins for each term.
  for (const entry of entries) {
    if (!entry.text) continue;
    for (let i = 0; i < referencesList.length; i++) {
      const r = referencesList[i];
      if (!r || !r.term) continue;
      const key = r.term.toLowerCase();
      if (referencesFirstAppearance.has(key)) continue;
      const re = regexes[i];
      if (!re) continue;
      if (re.test(entry.text)) {
        referencesFirstAppearance.set(key, {
          slug: entry.slug,
          primary: primaryTitleOf(entry),
          roman: entry.roman || "",
          type: entry.type,
        });
      }
    }
    // Early exit if every term has been resolved.
    if (referencesFirstAppearance.size >= referencesList.length) break;
  }
  return referencesFirstAppearance;
}

// Human-readable category labels + display order. Ordering follows what a
// reader is likely to need most-first: vocabulary (period words you might
// not know), then the people Bailey cites, then publications, then
// historical/cultural context.
const GLOSSARY_CATEGORY_ORDER = [
  ["vocabulary",  "Vocabulary",          "Period words and phrases that have shifted meaning since 1889."],
  ["naturalist",  "Naturalists",         "The ornithologists, biologists, and field writers Bailey cites."],
  ["literary",    "Literary references", "Poets, essayists, and authors Bailey quotes or alludes to."],
  ["publication", "Publications",        "Journals, books, and field reports Bailey draws from."],
  ["fashion",     "Fashion & millinery", "References to the plumage trade and the fashions of Bailey's era."],
  ["historical",  "Historical context",  "Events, places, and figures of period background."],
  ["concept",     "Concepts",            "Period scientific or cultural concepts."],
  ["phrase",      "Phrases",             "Idioms and turns of phrase from the period."],
];

function renderGlossary() {
  setView("glossary");
  setTopbarTitle("Glossary");
  setDocTitle("Glossary");

  if (!referencesList.length) {
    main.innerHTML = `
      <article class="glossary">
        <h1 class="glossary-title">Glossary</h1>
        <p class="glossary-empty">References not loaded.</p>
        <p><a href="#/">&larr; Back to table of contents</a></p>
      </article>
    `;
    window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
    return;
  }

  const firstAppearance = computeReferencesFirstAppearance();

  // Group references by type. Anything with an unknown type falls through
  // to a generic "Other" bucket so we never silently drop entries.
  const byType = new Map();
  for (const r of referencesList) {
    const t = r.type || "other";
    if (!byType.has(t)) byType.set(t, []);
    byType.get(t).push(r);
  }
  // Sort each bucket alphabetically by term (case-insensitive).
  for (const arr of byType.values()) {
    arr.sort((a, b) => a.term.localeCompare(b.term, "en", { sensitivity: "base" }));
  }

  // Build the ordered list of sections once, reuse for both the count
  // strip (which links to each section) and the section rendering — so
  // the counts always match the rendered order.
  const orderedSections = [];
  const renderedTypes = new Set();
  for (const [type, label, blurb] of GLOSSARY_CATEGORY_ORDER) {
    const arr = byType.get(type);
    if (!arr || !arr.length) continue;
    orderedSections.push({ type, label, blurb, arr });
    renderedTypes.add(type);
  }
  // Catch-all for any types not in GLOSSARY_CATEGORY_ORDER (data drift).
  for (const [type, arr] of byType.entries()) {
    if (renderedTypes.has(type)) continue;
    orderedSections.push({ type, label: type, blurb: "", arr });
  }

  const counts = orderedSections
    .map((s) => {
      const safeType = s.type.replace(/[^a-z0-9-]/g, "");
      return `<a href="#glossary-section-${safeType}">${s.arr.length} ${escapeHtml(s.type)}</a>`;
    })
    .join(" &middot; ");

  const sectionsHtml = orderedSections
    .map((s) => renderGlossarySection(s.type, s.label, s.blurb, s.arr, firstAppearance))
    .join("");

  main.innerHTML = `
    <article class="glossary">
      <header class="glossary-header">
        <p class="glossary-eyebrow"><a href="#/">&larr; Table of contents</a></p>
        <h1 class="glossary-title">Glossary</h1>
        <p class="glossary-dek">
          Every annotated term in the book, grouped by category. Each entry
          links to the chapter where it first appears, so the glossary doubles
          as a way to find passages by what Bailey is talking about.
        </p>
        <p class="glossary-meta">${referencesList.length} terms &middot; ${counts}</p>
      </header>
      ${sectionsHtml}
    </article>
  `;

  window.scrollTo({ top: 0, behavior: "instant" in window ? "instant" : "auto" });
}

function renderGlossarySection(type, label, blurb, items, firstAppearance) {
  const safeType = (type || "").replace(/[^a-z0-9-]/g, "");
  const entriesHtml = items
    .map((r) => {
      const fa = firstAppearance.get(r.term.toLowerCase());
      // Only render the first-appearance line when we actually found a
      // chapter match — terms with no match (alias-coverage gaps, OCR
      // quirks) just show the note alone.
      let appearanceHtml = "";
      if (fa) {
        const romanPart = fa.type === "chapter" && fa.roman
          ? `${escapeHtml(fa.roman)}. `
          : "";
        appearanceHtml = `
          <p class="glossary-appearance">
            First appears in
            <a href="#/${encodeURIComponent(fa.slug)}">${romanPart}${escapeHtml(fa.primary)}</a>
            &rarr;
          </p>`;
      }
      const aliasHtml = (r.aliases && r.aliases.length)
        ? `<p class="glossary-aliases">Also: ${r.aliases.map(escapeHtml).join(", ")}</p>`
        : "";
      return `
        <div class="glossary-entry glossary-entry-${safeType}" id="gloss-${escapeHtml(slugifyTerm(r.term))}">
          <h3 class="glossary-term">${escapeHtml(r.term)}</h3>
          ${r.modern ? `<p class="glossary-modern">${escapeHtml(r.modern)}</p>` : ""}
          ${aliasHtml}
          ${r.note ? `<p class="glossary-note">${escapeHtml(r.note)}</p>` : ""}
          ${appearanceHtml}
        </div>`;
    })
    .join("");

  return `
    <section class="glossary-section glossary-section-${safeType}" id="glossary-section-${safeType}">
      <h2 class="glossary-section-title">${escapeHtml(label)}</h2>
      ${blurb ? `<p class="glossary-section-blurb">${escapeHtml(blurb)}</p>` : ""}
      <div class="glossary-entries">${entriesHtml}</div>
    </section>
  `;
}

// Stable, URL-safe ID for an in-page anchor. Used so future deep-links
// (e.g. from chapter prose) could jump to a specific glossary entry.
function slugifyTerm(term) {
  return String(term)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// ----------------------------------------------------------------------
// Routing
// ----------------------------------------------------------------------

function route() {
  const hash = location.hash || "#/";

  // In-page anchor jumps inside the glossary (count-strip links). The
  // anchor pattern intentionally does NOT start with "#/" — that's how
  // we distinguish in-page jumps from real SPA routes. Ensure the
  // glossary view is mounted (cold deep-link case), then scroll to the
  // target section. Skips a re-render if we're already on glossary so
  // clicking a chip doesn't blow away scroll position before we then
  // restore it.
  if (hash.startsWith("#glossary-section-")) {
    if (document.body.getAttribute("data-view") !== "glossary") {
      renderGlossary();
    }
    const id = hash.slice(1);
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    return;
  }

  const slug = decodeURIComponent(hash.replace(/^#\/?/, "")).replace(/\/$/, "");
  if (!slug) {
    renderTOC();
    return;
  }
  if (slug === "glossary") {
    renderGlossary();
    return;
  }
  const entry = entriesBySlug.get(slug);
  if (!entry) {
    renderNotFound(slug);
    return;
  }
  renderEntry(entry);
}

// ----------------------------------------------------------------------
// Theme toggle — light (default) / dark. Mirrors shellylynnx.com's pattern:
// localStorage-persisted, applied to <html> so the topbar and content
// recolour together. The pre-paint script in index.html handles the
// initial application; this just wires the click handler.
// ----------------------------------------------------------------------

function setupThemeToggle() {
  const btn = document.getElementById("theme-toggle");
  if (!btn) return;
  btn.addEventListener("click", () => {
    const root = document.documentElement;
    const isDark = root.classList.toggle("dark");
    try {
      localStorage.setItem("opera-glass-theme", isDark ? "dark" : "light");
    } catch (e) {
      /* private mode / disabled storage — silently no-op */
    }
  });
}

// ----------------------------------------------------------------------
// v2: in-memory search across the book
// ----------------------------------------------------------------------
// Vanilla JS, no Fuse, no fuzzy index. With ~50K words of text, a simple
// substring scan returns 10 hits in well under 50ms on any laptop. The
// search-results dropdown shows up to 10 matches with a 60-char snippet
// of the matched text. `/` from anywhere on the page focuses the input,
// `Escape` clears + blurs.
//
// Search corpus per entry (chapter / front / back):
//   • title
//   • period aliases (semicolon-split tail of the title)
//   • modernName (chapters only)
//   • body text
// Bigger weight to title hits via match-type ordering.

function setupSearch() {
  const input = document.getElementById("book-search");
  const results = document.getElementById("search-results");
  if (!input || !results) return;

  function clearResults() {
    results.innerHTML = "";
    results.hidden = true;
  }

  function renderResults(query) {
    const q = query.trim().toLowerCase();
    if (q.length < 2) {
      clearResults();
      return;
    }
    const hits = [];
    for (const e of entries) {
      const title = (e.title || "").toLowerCase();
      const modern = (e.modernName || "").toLowerCase();
      const body = (e.text || "").toLowerCase();
      let kind = null;
      let snippet = "";
      let snippetIdx = -1;
      if (title.includes(q)) {
        kind = "title";
      } else if (modern.includes(q)) {
        kind = "modern";
      } else if (body.includes(q)) {
        kind = "body";
        snippetIdx = body.indexOf(q);
      }
      if (!kind) continue;
      if (kind === "body") {
        const start = Math.max(0, snippetIdx - 40);
        const end = Math.min(e.text.length, snippetIdx + q.length + 40);
        const prefix = start > 0 ? "…" : "";
        const suffix = end < e.text.length ? "…" : "";
        snippet =
          prefix +
          e.text.slice(start, end).replace(/\s+/g, " ").trim() +
          suffix;
      }
      hits.push({ entry: e, kind, snippet });
      if (hits.length >= 30) break;
    }
    // Sort by kind: title > modern > body
    const order = { title: 0, modern: 1, body: 2 };
    hits.sort((a, b) => order[a.kind] - order[b.kind]);
    const top = hits.slice(0, 10);
    if (!top.length) {
      results.innerHTML = `<li class="search-result-empty">No matches for &ldquo;${escapeHtml(query)}&rdquo;.</li>`;
      results.hidden = false;
      return;
    }
    results.innerHTML = top
      .map((h) => {
        const e = h.entry;
        const primary = primaryTitleOf(e);
        const sub =
          e.type === "chapter"
            ? `<span class="search-result-roman">${escapeHtml(e.roman || "")}.</span> `
            : `<span class="search-result-roman">${e.type === "front" ? "Front" : "Back"}</span> `;
        const snippetHtml = h.snippet
          ? `<span class="search-result-snippet">${escapeHtml(h.snippet)}</span>`
          : "";
        return `<li class="search-result" role="option">
          <a href="#/${encodeURIComponent(e.slug)}">
            ${sub}<span class="search-result-title">${escapeHtml(primary)}</span>
            ${snippetHtml}
          </a>
        </li>`;
      })
      .join("");
    results.hidden = false;
  }

  let debounce;
  input.addEventListener("input", (e) => {
    clearTimeout(debounce);
    debounce = setTimeout(() => renderResults(e.target.value), 80);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      input.value = "";
      clearResults();
      input.blur();
    }
  });
  // Click outside dismisses
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#book-search, #search-results")) {
      results.hidden = true;
    }
  });
}

// Global `/` shortcut focuses the search input (when on TOC). Mounted
// once at boot.
function setupSearchShortcut() {
  document.addEventListener("keydown", (e) => {
    // Ignore when typing in inputs / contenteditable
    if (e.target.matches("input, textarea, [contenteditable]")) return;
    if (e.key === "/") {
      const input = document.getElementById("book-search");
      if (input) {
        e.preventDefault();
        input.focus();
      } else {
        // On a chapter page — go home + focus on next render
        location.hash = "#/";
        setTimeout(() => {
          const i = document.getElementById("book-search");
          if (i) i.focus();
        }, 50);
      }
    }
  });
}

// ----------------------------------------------------------------------
// Image lightbox — click any in-content image to view it at full size.
// Click the backdrop or press Escape to close. Single shared overlay,
// re-used for every image, attached once at boot. Click delegation runs
// on <main> so it survives every render-replace.
// ----------------------------------------------------------------------

const LIGHTBOX_TARGETS =
  ".toc-hero img, .chapter-illus img, .chapter-song img, .appendix-page img";

function ensureLightboxEl() {
  let lb = document.getElementById("lightbox");
  if (lb) return lb;
  lb = document.createElement("div");
  lb.id = "lightbox";
  lb.className = "lightbox";
  lb.setAttribute("role", "dialog");
  lb.setAttribute("aria-modal", "true");
  lb.setAttribute("aria-label", "Enlarged image");
  lb.innerHTML = `
    <button class="lightbox-close" type="button" aria-label="Close enlarged image">&times;</button>
    <img class="lightbox-img" alt="" />
  `;
  lb.addEventListener("click", (e) => {
    // Backdrop click (anywhere except the image itself) closes
    if (e.target === lb || e.target.classList.contains("lightbox-close")) {
      closeLightbox();
    }
  });
  document.body.appendChild(lb);
  return lb;
}

function openLightbox(src, alt) {
  const lb = ensureLightboxEl();
  const img = lb.querySelector(".lightbox-img");
  img.src = src;
  img.alt = alt || "";
  lb.classList.add("open");
  // Lock body scroll while open
  document.body.style.overflow = "hidden";
  // Move focus to the close button for keyboard users
  const closeBtn = lb.querySelector(".lightbox-close");
  if (closeBtn && typeof closeBtn.focus === "function") {
    closeBtn.focus();
  }
}

function closeLightbox() {
  const lb = document.getElementById("lightbox");
  if (!lb) return;
  lb.classList.remove("open");
  document.body.style.overflow = "";
}

function setupLightbox() {
  // Delegated click anywhere in the doc — survives <main> re-renders.
  document.addEventListener("click", (e) => {
    const img = e.target.closest(LIGHTBOX_TARGETS);
    if (!img) return;
    e.preventDefault();
    openLightbox(img.currentSrc || img.src, img.alt);
  });
  // Escape closes
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") closeLightbox();
  });
}

// ----------------------------------------------------------------------
// Boot
// ----------------------------------------------------------------------

(async function init() {
  try {
    await loadData();
  } catch (err) {
    main.innerHTML = `
      <section class="toc-intro" style="padding-top:3rem;">
        <h1 class="chapter-title">Couldn't load the book</h1>
        <p>Something went wrong fetching the data files. The full text of
        <em>Birds Through an Opera Glass</em> is also free at the
        <a href="https://archive.org/details/birdsthroughano00bailgoog">Internet Archive</a>.</p>
        <pre style="overflow:auto;font-size:0.85rem;">${escapeHtml(err && err.message)}</pre>
      </section>
    `;
    // eslint-disable-next-line no-console
    console.error(err);
    return;
  }
  window.addEventListener("hashchange", route);
  setupLightbox();
  setupThemeToggle();
  // v2 boot hooks
  setupGlossTooltips();
  setupSearchShortcut();
  route();
})();
