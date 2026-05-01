# Birds Through an Opera Glass

An interactive reading copy of Florence Merriam Bailey's 1889 field guide
*Birds Through an Opera Glass*. Seventy chapters, sixteen original
illustrations, eleven song notations, all public domain.

Live: <https://shellylynnx.github.io/projects/opera-glass/>

Showcased on [shellylynnx.com/tools](https://shellylynnx.com/tools), with an illustrated gallery at [shellylynnx.com/library/birds-through-an-opera-glass](https://shellylynnx.com/library/birds-through-an-opera-glass).

## What this is

Bailey was 25 when she wrote this. It is one of the first popular American
bird books to argue that the opera glass and a careful eye were enough &mdash;
you did not need to shoot the bird to study it. The book ran to multiple
editions, kept selling for decades, and helped seed the early Audubon
movement.

The text and illustrations have been in the public domain in the United
States since the day they were published; the 1893 Riverside Press reprint we
worked from was scanned by the Internet Archive from a Harvard library copy.

This site is a navigable web edition: title page hero, table of contents, one
page per chapter with the text reflowed for the screen, the original
illustrations placed where Bailey put them, and Bailey's hand-transcribed
song notations rendered as inline crops.

## Reading aids (v2)

The original 1889 text is delivered untouched. Layered on top, this edition
adds:

- **Audio for every song notation.** All eleven of Bailey's transcribed bird
  songs are paired with a modern recording from
  [xeno-canto](https://xeno-canto.org/), rendered inline via xeno-canto's
  embed widget. Picks are curated for audio cleanliness first (no ambient
  distractions, dawn recordings where the bird sings the most variants,
  recognized field-recordists like Andrew Spencer and Christopher
  McPherson) with eastern-US locations preferred but not required. The
  Wood-Pewee twilight song variant Bailey transcribed (which Wallace
  Craig later formally documented in *The Auk*, 1926) is paired with the
  only quality:A recording on xeno-canto explicitly tagged as a twilight
  song, recorded at dawn 5:00 AM. Recordings are Creative Commons
  licensed; xeno-canto's widget renders recordist attribution inline.
- **Annotation glosses.** Underlined terms in the prose (period vocabulary,
  the naturalists Bailey cites, journals she draws from) carry hover/tap
  tooltips. Fifty-two entries across eight categories (vocabulary,
  naturalist, literary, publication, fashion, historical, concept, phrase).
- **Glossary index page** at `#/glossary`. Every annotated term in one
  place, grouped by category, each linked to the chapter where it first
  appears, so the glossary doubles as a way to navigate the book by topic.
- **Modern accounts footer** on every species chapter, with links to
  eBird, Cornell All About Birds, Audubon Field Guide, Wikipedia, and
  Macaulay Library audio.
- **Search** across all 70 chapters and 52 reference terms (`/` to focus).
- **Reading progress** in `localStorage`. Visited chapters render muted in
  the table of contents; a "Continue reading" link surfaces the last entry.

## How it's built

- Plain HTML, plain CSS, one ES module of vanilla JavaScript.
- No framework, no build step, no bundler.
- Hash routing (`#/`, `#/robin`, `#/cuckoo`, &hellip;).
- Static files only. Deploys via GitHub Pages.

## Project layout

```
opera-glass/
  index.html              # SPA shell + meta tags + JSON-LD
  main.js                 # routing + render
  styles.css              # all CSS
  data/
    chapters.json         # 70 chapter entries with text + asset refs
    metadata.json         # book-level metadata
    audio-embeds.json     # 11 xeno-canto recording IDs paired with song notations
    references.json       # 52 annotation glosses (term, type, modern, note, aliases)
    modern-accounts.json  # eBird/Cornell/Audubon/Wikipedia/Macaulay links per species
  assets/
    title-page.png        # 1893 title page
    illustrations/        # 16 species illustrations
    songs/                # 11 song-notation crops
  scripts/
    extract-chapters.py   # OCR + chapter extraction pipeline (re-runnable)
```

## Re-running the chapter extraction

The chapter text was extracted from page renders of the source PDF using
Tesseract OCR. To regenerate `data/chapters.json`:

```bash
# 1. Render the PDF to per-page images at 150 DPI
pdftoppm -jpeg -r 150 birdsthroughano00bailgoog.pdf /tmp/page

# 2. OCR every page (~2 min on a modern Mac, 8 cores)
mkdir -p /tmp/ocr
ls /tmp/page-*.jpg | xargs -P 8 -I{} sh -c \
  'tesseract "$1" "/tmp/ocr/$(basename ${1%.jpg})" --psm 4 -l eng' _ {}

# 3. Run the extractor
python3 scripts/extract-chapters.py
```

Output goes to `/tmp/opera-glass-extract/chapters.json` plus a sanity-check
report. The script is documented inline; the chapter manifest (Roman
numerals, slugs, modern names, eBird codes, illustration filenames, song
notations) is hand-curated and lives at the top of the file.

## License

- Code: [MIT](LICENSE)
- Bailey's text and the original illustrations: public domain in the U.S.
  Source scan: [Internet Archive](https://archive.org/details/birdsthroughano00bailgoog).
- Audio: embedded from [xeno-canto](https://xeno-canto.org/). Individual
  recordings are CC-licensed (typically CC-BY-NC-SA 4.0 or CC-BY-SA 4.0);
  recordist attribution is rendered automatically by xeno-canto's embed
  widget and duplicated in the figcaption.

## Credits

Curated and built by [Shelly Xiong](https://shellylynnx.com).
