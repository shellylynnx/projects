# METBird

Browse bird-related artwork from [The Metropolitan Museum of Art](https://www.metmuseum.org/) collection, enriched with taxonomy data from [eBird](https://ebird.org/).

## Features

- **9,761 bird artworks** indexed from the MET Open Access collection
- **Autocomplete search** with 134 species and 36 historical/regional name aliases
- **Bird Series browser** — filter by named art series (e.g., Birds of America, Game Birds)
- **Artwork detail panel** with full MET metadata, zoomable images, and eBird taxonomy links
- **Taxonomy matching** — automatically identifies bird species from artwork titles and displays scientific names, family, and eBird profile links
- **Per-artwork overrides** for titles where the species can't be determined from the name alone

## Data Sources

- **Artwork data**: [Metropolitan Museum of Art Open Access API](https://metmuseum.github.io/) — fetched at runtime for artwork details (images, dates, artists, etc.)
- **Bird taxonomy**: [eBird](https://ebird.org/) by the [Cornell Lab of Ornithology](https://www.birds.cornell.edu/) — pre-built species data stored locally for instant matching
- **Artwork index**: Pre-built list of 9,761 MET object IDs with bird-related titles, stored in `bird-object-ids.js`

## Project Structure

```
METBird/
  index.html                   # Single-page app entry point
  scripts/
    app.js                     # Application logic (search, pagination, detail panel, taxonomy)
    bird-object-ids.js         # Pre-built index of bird artwork object IDs and titles
    bird-taxonomy.js           # eBird taxonomy data and per-artwork overrides
  styles/
    style.css                  # All styling
```

## How It Works

1. On load, the app reads the pre-built bird artwork index (`bird-object-ids.js`) and taxonomy data (`bird-taxonomy.js`)
2. Users search by bird name or browse by series — results are filtered client-side from the index
3. Artwork details (images, artist, date, medium, etc.) are fetched from the MET API on demand with caching and retry logic
4. Bird species are matched from artwork titles using plural-aware regex patterns and displayed with eBird taxonomy info

## Usage

Open `index.html` in a browser. No build step or server required — it's a static single-page app that calls the MET API directly.

## API Information

### Metropolitan Museum of Art Open Access API

- **Documentation**: [metmuseum.github.io](https://metmuseum.github.io/)
- **Base URL**: `https://collectionapi.metmuseum.org/public/collection/v1/`
- **Authentication**: None required — the API is freely available to all users
- **Rate limit**: 80 requests per second
- **License**: Artwork metadata and images for 470,000+ works are released under [Creative Commons Zero (CC0)](https://creativecommons.org/publicdomain/zero/1.0/), permitting unrestricted use. Works still under copyright include a `rightsAndReproduction` field for proper attribution.
- **Endpoints used**:
  - `/objects/{id}` — fetch full artwork details (title, artist, date, medium, images, etc.)
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

## Credits

Built with data from the [Metropolitan Museum of Art Open Access API](https://metmuseum.github.io/) and [eBird](https://ebird.org/), a project of the [Cornell Lab of Ornithology](https://www.birds.cornell.edu/).
