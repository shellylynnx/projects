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

async function loadData() {
  const [chRes, mdRes] = await Promise.all([
    fetch("./data/chapters.json"),
    fetch("./data/metadata.json"),
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
      html = inlineSongNotations(html);
      html = linkifyPigeonHoles(html);
      html = linkifyChapterRefs(html, currentSlug);
      return `<p>${html}</p>`;
    })
    .join("");
}

// Per-crop alt text for the 11 song-notation images. Sourced from
// MANIFEST.md / gallery-quotes.md, each describing the syllabic phrase
// Bailey transcribed so screen readers and search engines get a unique,
// meaningful description per crop instead of a generic boilerplate.
const SONG_ALT = {
  "american-goldfinch_dee-ree.png":
    "Bailey's notation of the American Goldfinch flight call: 'dee-ree, dee-ee-ree,' the rolling syllables a goldfinch sings in undulating flight, from the 1893 edition.",
  "wood-pewee_come-to-me.png":
    "Bailey's notation of the Wood Pewee's plaintive 'come to me' phrase, three notes sliding down to a long lower note, from the 1893 edition.",
  "wood-pewee_u-of-sound.png":
    "Bailey's notation of the Wood Pewee's descending 'U of sound' pattern, two notes that drop and curve back up like a U-shaped sigh, from the 1893 edition.",
  "wood-pewee_dear-ie.png":
    "Bailey's notation of the Wood Pewee's tender, motherly 'dear-ie, dear-ie, dear,' three paired notes on a hushed cadence, from the 1893 edition.",
  "white-throated-sparrow_pea-bod-dy.png":
    "Bailey's notation of the White-Throated Sparrow's clear spring whistle: two variations of 'I-I-pea-bod-dy, pea-bod-dy, pea-bod-dy,' the New England 'peabody' song, from the 1893 edition.",
  "ovenbird_teach-er-crescendo.png":
    "Bailey's notation of the Ovenbird's escalating 'teach-er, teach-er, teach-er, teach-er, teacher,' marked with a crescendo line as the call beats louder and faster toward the end, from the 1893 edition.",
  "white-crowned-sparrow_whe-he-hee.png":
    "Bailey's notation of the White-Crowned Sparrow's low, plain song: 'whe-he-he-he-hee-hö,' six descending syllables, from the 1893 edition.",
  "american-redstart_te-ka-teek.png":
    "Bailey's notation of the American Redstart's hurried trill: 'Te-ka-te-ka-te-ka-te-ka-teek,' four staccato pairs accented on the final syllable, from the 1893 edition.",
  "black-throated-blue-warbler_z-ie.png":
    "Bailey's notation of the Black-Throated Blue Warbler's guttural 'z-ie' call, a buzzy two-note phrase Bailey transcribed mid-sentence, from the 1893 edition.",
  "hermit-thrush_main-song.png":
    "Bailey's notation of the Hermit Thrush's main song: a three-part phrase descending the scale with mid-phrase trills, the central trill marked here, from the 1893 edition.",
  "hermit-thrush_variation.png":
    "Bailey's notation of a Hermit Thrush variation in broken-song form: 'ah-re oo-oo,' a softer alternate phrase, from the 1893 edition.",
};

// Inline song-notation markers `[[SONG:filename]]` placed in chapters.json
// where Bailey originally set the music notation in the book. Each marker
// gets replaced with a small inline figure that breaks out of the
// surrounding paragraph flow visually. Runs AFTER escapeHtml so we can
// safely emit raw HTML.
function inlineSongNotations(escapedHtml) {
  return escapedHtml.replace(
    /\[\[SONG:([^\]]+)\]\]/g,
    (_, filename) => {
      const safe = filename.replace(/"/g, "&quot;");
      const alt =
        SONG_ALT[filename] ||
        "Florence Merriam Bailey's transcription of the bird's song with phonetic lyrics, from the 1893 edition.";
      const safeAlt = alt
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
      return `</p><figure class="chapter-song-inline"><img src="./assets/songs/${safe}" alt="${safeAlt}" loading="lazy" /></figure><p>`;
    }
  );
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

  const frontItems = front
    .map(
      (e) => `
        <li>
          <a class="toc-link toc-link-supp" href="#/${encodeURIComponent(e.slug)}">
            <span class="toc-roman">&nbsp;</span>
            <span class="toc-title">${escapeHtml(e.title)}</span>
            <span class="toc-page"></span>
          </a>
        </li>`
    )
    .join("");

  const chapterItems = chapters
    .map((c) => {
      const primary = escapeHtml(primaryTitleOf(c));
      const dot = c.illustration
        ? '<span class="toc-illus-dot" aria-label="has illustration"></span>'
        : "";
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
          <a class="toc-link" href="#/${encodeURIComponent(c.slug)}">
            <span class="toc-roman">${escapeHtml(c.roman)}.</span>
            <span class="toc-title">${primary}${dot}${aliases}</span>
            <span class="toc-page">${page}</span>
          </a>
        </li>`;
    })
    .join("");

  const backItems = back
    .map(
      (e) => `
        <li>
          <a class="toc-link toc-link-supp" href="#/${encodeURIComponent(e.slug)}">
            <span class="toc-roman">&nbsp;</span>
            <span class="toc-title">${escapeHtml(e.title)}</span>
            <span class="toc-page"></span>
          </a>
        </li>`
    )
    .join("");

  main.innerHTML = `
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
  `;

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

  main.innerHTML = `
    <article class="chapter">
      ${kickerHtml}
      <h1 class="chapter-title">${escapeHtml(primary)}</h1>
      ${modernHtml}
      ${illusHtml}
      <div class="chapter-body">
        ${bodyHtml}
      </div>
      ${songsHtml}
    </article>
    ${navHtml}
  `;

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
// Routing
// ----------------------------------------------------------------------

function route() {
  const hash = location.hash || "#/";
  const slug = decodeURIComponent(hash.replace(/^#\/?/, "")).replace(/\/$/, "");
  if (!slug) {
    renderTOC();
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
  route();
})();
