# NYCoffleash

**NYC parks & animal resource and reporting**

NYCoffleash is a free, open-source web app for exploring NYC dog runs, viewing off-leash dog complaints, tracking sick/injured animal reports, and accessing reporting resources — all on an interactive map powered by NYC Open Data.

Live site: _coming soon_

---

## Features

### Three Viewing Modes

| Mode | Description |
|------|-------------|
| **Find a Dog Run** (default) | Browse all NYC dog runs and off-leash areas on the map. Filter by borough, zip code, surface type, and seating availability. Click a dog run for details, directions, and park info. |
| **Offleashed Dog Reports** | View the most recent 311 complaints for off-leash/unleashed dogs. Open (pending) and closed complaints appear as color-coded dots. Filter by borough, location type, specific park, and result limit. |
| **Sick/Injured Animal Reports** | View NYC Parks Ranger animal condition responses. Incidents are grouped by park and displayed as sized dots. Filter by borough, animal condition, species, and result limit. |

### Map Interaction

- **Click any park** on the map to highlight its boundary, filter results to that park, and see a label
- **Click again** to deselect and restore full results
- **Click a list item** to fly to its location on the map and show a popup
- **Click a map dot** to see details and filter the list

### Reporting Resources

The **Report a Dog** / **Report an Animal** button is always visible on the map and opens a guide with:

- **Off-leash dogs**: 311 Online form links, Call 311, NYC311 app (iOS/Android), location-specific guidance (parks, sidewalks, NYCHA housing)
- **Animals in parks**: NYC Parks Rangers contact, 311 reporting form, ACC drop-off info
- **Wild birds**: Bird flu (H5N1) safety warning, Wild Bird Fund rescue info, NYS DEC dead bird reporting
- **Stray dogs & cats**: ACC contact and drop-off guidance, community cats program
- **Marine animals**: Stranded marine animal hotline

### Mobile Responsive

- Branded loading screen while resources load
- Switches between Map and List tabs on small screens
- Full-screen slide-in report modal (swipe-style)
- Compact filter panels with smaller controls
- Touch-friendly dropdowns and buttons

---

## Data Sources & APIs

Data comes from the [NYC Open Data](https://opendata.cityofnewyork.us/) portal using their public Socrata API. No API key is required.

| Dataset | ID | API Endpoint | Description |
|---------|----|--------------|-------------|
| 311 Service Requests | `erm2-nwe9` | `/resource/erm2-nwe9.json` | Citywide 311 complaints, filtered to "Dog Off Leash" (DPR) and "Unleashed Dog in Public" (DOHMH) descriptors |
| Dog Runs & Off-Leash Areas | `hxx3-bwgv` | `/resource/hxx3-bwgv.geojson` | NYC Parks dog run locations with polygon boundaries, surface type, seating, zip code |
| Animal Condition Response | `fuhs-xmg2` | `/resource/fuhs-xmg2.json` | Urban Park Rangers animal incident responses with species, condition, location, and ranger action |
| Park Properties | `enfh-gkve` | `/resource/enfh-gkve.geojson` | NYC Parks boundary polygons used for the clickable park layer and centroid matching |

**Base URL:** `https://data.cityofnewyork.us`

### How Data Is Used

- **Dog runs** are bundled locally for fast loading and rendered as teal polygon fills and centroid dots.
- **311 complaints** are fetched on-demand when switching to Offleashed Dog Reports mode. Open complaints appear as gold dots, closed as darker dots.
- **Animal incidents** are fetched on-demand when switching to Sick/Injured Animal Reports mode. The app matches the `property` (park name) field against park boundary centroids to place them on the map, since the source data has no coordinates. Incidents are grouped by park, with dot sizes proportional to the count.
- **Park boundaries** are loaded as a clickable background layer. Selecting a park highlights its outline and filters active data to that location.

---

## Local Data

| File | Description |
|------|-------------|
| `data/dogruns.geojson` | Pre-cached dog run locations (68KB, optimized from API) |
| `data/boroughs.geojson` | NYC borough boundary polygons (250KB, simplified) |

Both files are optimized with reduced coordinate precision and stripped unused properties to minimize load times.

---

## Technology Stack

| Technology | Purpose |
|------------|---------|
| [MapLibre GL JS](https://maplibre.org/) v4.7.1 | Interactive WebGL map rendering |
| [OpenFreeMap](https://openfreemap.org/) | Free map tile style (Liberty) |
| System fonts | UI typeface (San Francisco on iOS, Segoe UI on Windows, Roboto on Android) |
| Vanilla JavaScript | No frameworks — single `app.js` file (~1,760 lines) |
| CSS3 | Responsive layout with CSS Grid, Flexbox, and custom properties |

CDN: [jsDelivr](https://www.jsdelivr.com/) with Subresource Integrity (SRI) hashes for MapLibre.

---

## Project Structure

```
NYCoffleash/
├── index.html            Main HTML (single page app)
├── scripts/
│   └── app.js            Application logic (~1,760 lines)
├── styles/
│   └── style.css         All styling (~960 lines)
├── data/
│   ├── dogruns.geojson   Pre-cached dog run locations
│   └── boroughs.geojson  NYC borough boundaries
├── sw.js                 Service worker (network-first API, cache-first static)
├── tests/
│   └── test.html         Browser-based test suite
├── .gitignore
└── README.md
```

---

## Running Locally

The app is a static site — no build step is needed. Serve the files with any HTTP server:

```bash
# Using npx (Node.js)
npx serve -p 3456

# Using Python
python3 -m http.server 3456

# Using PHP
php -S localhost:3456
```

Then open `http://localhost:3456` in your browser.

---

## Performance

The app is optimized for fast loading on mobile:

- **Branded loading screen** — inline CSS renders immediately, no flash of unstyled content
- **Local data files** — dog runs and borough boundaries are bundled locally (no API calls on boot)
- **Deferred loading** — parks layer, park list, and API data load only when needed
- **Compressed GeoJSON** — reduced coordinate precision and stripped unused properties
- **System fonts** — no external font downloads
- **Deferred scripts** — HTML parses while JS downloads in parallel
- **jsDelivr CDN** — fast HTTP/2 delivery with SRI integrity hashes
- **Preconnect hints** — early DNS/TLS handshakes for external domains
- **localStorage caching** — dog runs cached for 7 days, park lists for 24 hours
- **Error recovery** — reload banner if map or data fails to load

---

## Security

- **HTML escaping** — all API data is sanitized via `escHTML()` / `safeText()` before insertion into the DOM
- **Subresource Integrity** — SRI hashes on CDN-loaded scripts and stylesheets
- **No API keys** — all data sources are public, unauthenticated endpoints
- **External links** — all use `target="_blank" rel="noopener"`
- **No sensitive data** — `.gitignore` excludes `.env`, `.claude/`, and `node_modules/`

---

## Caching

To reduce API calls and improve load times, the app caches data in the browser:

| Data | Storage | TTL |
|------|---------|-----|
| Park list (per borough) | localStorage | 24 hours |
| Dog runs | localStorage | 7 days |
| All parks | sessionStorage | Session only |
| Park boundaries (individual) | In-memory (Map) | Session only |

Cache is automatically refreshed when the TTL expires. Clearing your browser storage will reset all caches.

---

## Reporting Resources

The app links to official NYC resources for reporting:

- **311 Online**: Direct links to the NYC 311 service request portal for specific complaint types
- **Call 311**: Tel links for quick dialing
- **NYC311 App**: Links to the iOS App Store and Google Play Store
- **NYC Parks Rangers**: For wildlife and stray animals in parks
- **Animal Care Centers (ACC)**: Drop-off locations for common wildlife and stray animals — (212) 788-4000
- **Wild Bird Fund**: Wildlife rescue and rehabilitation — (646) 306-2862
- **NYC Bird Alliance**: Bird flu (H5N1) information and safety guidance
- **NYS DEC**: Dead wild bird reporting (outside of parks)
- **Marine Animal Hotline**: For beached/stranded seals, turtles, and whales

---

## Accessibility

- ARIA labels on interactive elements (buttons, filters, map controls)
- `aria-live="polite"` regions for dynamic content updates (stats bar, list results)
- `role="alert"` on toast notifications for screen reader announcements
- Keyboard-navigable autocomplete with arrow key and Enter support
- Focus management in modals

## Toast Notifications

Non-blocking toast messages for API errors, network failures, and data loading issues. Toasts auto-dismiss after 4–8 seconds and support manual dismissal. Types: `error` (red), `info` (blue), `success` (green). Respects `prefers-reduced-motion`.

## Testing

Open `tests/test.html` in a browser to run the test suite. Tests cover data loading, filter logic, map rendering, and UI interactions.

## Browser Support

Works in all modern browsers that support WebGL:
- Chrome / Edge 80+
- Firefox 78+
- Safari 14+
- Mobile Safari / Chrome (iOS 14+, Android 8+)

---

## License

This project uses publicly available NYC Open Data. Data is provided under the [NYC Open Data Terms of Use](https://opendata.cityofnewyork.us/overview/#termsofuse).

Map tiles by [OpenFreeMap](https://openfreemap.org/) using [OpenStreetMap](https://www.openstreetmap.org/copyright) data.
