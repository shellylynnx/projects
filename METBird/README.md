# METBird

Browse bird-related artwork from [The Metropolitan Museum of Art](https://www.metmuseum.org/) collection, enriched with taxonomy data from [eBird](https://ebird.org/).

Showcased on [shellylynnx.com/tools](https://shellylynnx.com/tools).

## Features

- **9,751 bird artworks** indexed from the MET Open Access collection (5,069 with primary images)
- **Species-aware autocomplete search** with 188 species across 72 bird families, plus 83 historical/regional name aliases. Clicking a species finds all artworks including those matched via former names.
- **Bird Series browser**: filter by named art series (e.g., Birds of America, Game Birds, Drawings Made in the United States)
- **Multi-plate artwork support**: multi-image MET objects (e.g., Audubon's *Birds of America*) are split into individual plates, each with its own image and eBird taxonomy
- **Artwork detail panel** with full MET metadata, zoomable images, plate captions, and eBird taxonomy links
- **Taxonomy matching**: automatically identifies bird species from artwork titles and displays scientific names, family, and eBird profile links
- **Per-artwork overrides** for titles where the species can't be determined from the name alone (e.g., East Asian peacock artworks mapped to Green Peafowl)
- **Modular ES module architecture**: split into 5 focused modules (app, api, search, taxonomy, ui) for maintainability
- **Service worker** with offline support: previously viewed artworks remain accessible without a network connection
- **Toast notifications** for non-blocking error feedback (API failures, rate limiting, network issues)
- **Content Security Policy**: strict CSP header restricting scripts, styles, connections, and image sources

## Data

### At a Glance

| Dataset | Count |
|---------|-------|
| Bird artworks indexed | 9,751 |
| Artworks with primary image | 5,069 |
| Bird species in taxonomy | 188 |
| Bird families represented | 72 |
| Historical/regional name aliases | 83 |
| Total taxonomy entries | 271 |

### Data Sources

- **Artwork data**: [Metropolitan Museum of Art Open Access API](https://metmuseum.github.io/), fetched at runtime for artwork details (images, dates, artists, etc.)
- **Bird taxonomy**: [eBird](https://ebird.org/) by the [Cornell Lab of Ornithology](https://www.birds.cornell.edu/), pre-built species data stored locally for instant matching
- **Artwork index**: Pre-built list of 9,751 MET object IDs with bird-related titles, stored in `bird-object-ids.js`

## Project Structure

```
METBird/
  index.html                   # Single-page app entry point
  scripts/
    app.js                     # Main entry point: initializes modules and coordinates app state
    api.js                     # MET API fetch logic with retry, batching, and caching
    search.js                  # Search, autocomplete, filtering, pagination, and series browsing
    taxonomy.js                # Species matching from artwork titles via eBird taxonomy
    ui.js                      # DOM rendering: detail panel, list items, popups, and toast notifications
    bird-object-ids.js         # Pre-built index of bird artwork object IDs and titles
    bird-taxonomy.js           # eBird taxonomy data, per-artwork overrides, and plate entries
  styles/
    style.css                  # All styling (~320 lines)
  sw.js                        # Service worker: network-first caching for API, cache-first for static assets
  tests/
    test.html                  # Browser-based test suite
```

## How It Works

1. On load, the app reads the pre-built bird artwork index (`bird-object-ids.js`) and taxonomy data (`bird-taxonomy.js`)
2. Users search by bird name or browse by series. Results are filtered client-side from the index.
3. Artwork details (images, artist, date, medium, etc.) are fetched from the MET API on demand with caching and retry logic
4. For plate entries (multi-image artworks like Audubon's *Birds of America*), the app fetches the parent MET object and overlays plate-specific images and taxonomy
5. Bird species are matched from artwork titles using plural-aware regex patterns and displayed with eBird taxonomy info
6. Autocomplete suggestions are species-aware. Selecting a species shows all artworks matched by current name, historical aliases, and per-artwork overrides.

## Usage

If hosted (GitHub Pages, Netlify, etc.), just share the link. It works out of the box.

To run locally, serve the files with any HTTP server (browsers require HTTP for ES module imports. Opening `index.html` directly via `file://` won't work):

```bash
# Using npx (Node.js)
npx serve -p 3456

# Using Python
python3 -m http.server 3456
```

Then open `http://localhost:3456`. No build step required.

## API Information

### Metropolitan Museum of Art Open Access API

- **Documentation**: [metmuseum.github.io](https://metmuseum.github.io/)
- **Base URL**: `https://collectionapi.metmuseum.org/public/collection/v1/`
- **Authentication**: None required; the API is freely available to all users
- **Rate limit**: 80 requests per second
- **License**: Artwork metadata and images for 470,000+ works are released under [Creative Commons Zero (CC0)](https://creativecommons.org/publicdomain/zero/1.0/), permitting unrestricted use. Works still under copyright include a `rightsAndReproduction` field for proper attribution.
- **Endpoints used**:
  - `/objects/{id}`: fetch full artwork details (title, artist, date, medium, images, etc.)
- **Best practices followed**:
  - Requests are batched (5 at a time) to stay well within rate limits
  - Exponential backoff retry (up to 3 retries with increasing delays)
  - SessionStorage caching to avoid refetching previously loaded artworks
  - Background prefetching of the next page for faster browsing
- **Contact**: openaccess@metmuseum.org

### eBird API / Taxonomy Data

- **Documentation**: [eBird API 2.0](https://documenter.getpostman.com/view/664302/S1ENwy59)
- **Terms of use**: [eBird API Terms of Use](https://www.birds.cornell.edu/home/ebird-api-terms-of-use/)
- **Usage in this project**: METBird does **not** make any runtime API calls to eBird. All taxonomy data (species names, scientific names, families, and eBird profile URLs) is pre-built and stored locally in `bird-taxonomy.js`. The eBird API was used only during development to look up species information.
- **Attribution**: Bird taxonomy data is sourced from [eBird](https://ebird.org/), a project of the [Cornell Lab of Ornithology](https://www.birds.cornell.edu/). eBird links in the app direct users to species profile pages on ebird.org.
- **License**: Non-commercial use. Commercial use requires prior written permission from the Cornell Lab of Ornithology (ebird@cornell.edu).

## Architecture

The application is split into focused modules:

| Module | Responsibility |
|--------|---------------|
| `app.js` | Entry point: initializes all modules, manages global state |
| `api.js` | MET API communication: fetch with retry, batching (5 concurrent), sessionStorage caching |
| `search.js` | Search input, species-aware autocomplete, series filtering, pagination, result rendering |
| `taxonomy.js` | Bird species identification from artwork titles, eBird taxonomy lookups |
| `ui.js` | DOM rendering: detail panel, grid/list items, toast notifications, loading states |
| `sw.js` | Service worker: network-first for API responses, cache-first for static assets |

### Offline Support

The service worker (`sw.js`) caches static assets and API responses:
- **Static assets** (HTML, CSS, JS, data files): cache-first, updated in background
- **MET API responses**: network-first with cache fallback for offline viewing of previously loaded artworks

### Toast Notifications

User-facing errors (API failures, rate limiting, network issues) surface via non-blocking toast messages that auto-dismiss. Toast types: `error` (red), `info` (blue).

## Testing

Open `tests/test.html` in a browser to run the test suite. Tests cover module loading, search functionality, taxonomy matching, and UI rendering.

## Technology Stack

| Technology | Purpose |
|------------|---------|
| Vanilla JavaScript (ES modules) | No frameworks. Modular `import`/`export` architecture. |
| [Google Fonts](https://fonts.google.com/) | Inter (UI) and Playfair Display (headings) |
| CSS3 | Responsive layout with Grid, Flexbox, and custom properties |

## Security

- **Content Security Policy**: strict CSP in `<meta>` tag restricting script sources, style sources, API connections, and image origins
- **HTML escaping**: all API data sanitized before DOM insertion
- **No API keys**: MET API is public and unauthenticated
- **External links**: all use `target="_blank" rel="noopener"`
- **Subresource preconnect**: early DNS/TLS for Google Fonts and MET API domains

## Credits

Built with data from the [Metropolitan Museum of Art Open Access API](https://metmuseum.github.io/) and [eBird](https://ebird.org/), a project of the [Cornell Lab of Ornithology](https://www.birds.cornell.edu/).
