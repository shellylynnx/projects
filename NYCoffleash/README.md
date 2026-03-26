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

The **Report a Dog** / **Report an Animal** button opens a guide with:

- **Off-leash dogs**: 311 Online form links, Call 311, NYC311 app (iOS/Android), location-specific guidance (parks, sidewalks, NYCHA housing)
- **Animals in parks**: NYC Parks Rangers contact, 311 reporting form, ACC drop-off info
- **Wild birds**: Bird flu (H5N1) safety warning, Wild Bird Fund rescue info, NYS DEC dead bird reporting
- **Stray dogs & cats**: ACC contact and drop-off guidance, community cats program
- **Marine animals**: Stranded marine animal hotline

### Mobile Responsive

- Switches between Map and List tabs on small screens
- Full-screen slide-in report modal
- Collapsible filter panels
- Touch-friendly controls

---

## Data Sources & APIs

All data is fetched from the [NYC Open Data](https://opendata.cityofnewyork.us/) portal using their public Socrata API. No API key is required.

| Dataset | ID | API Endpoint | Description |
|---------|----|--------------|-------------|
| 311 Service Requests | `erm2-nwe9` | `/resource/erm2-nwe9.json` | Citywide 311 complaints, filtered to "Dog Off Leash" (DPR) and "Unleashed Dog in Public" (DOHMH) descriptors |
| Dog Runs & Off-Leash Areas | `hxx3-bwgv` | `/resource/hxx3-bwgv.geojson` | NYC Parks dog run locations with polygon boundaries, surface type, seating, zip code |
| Animal Condition Response | `fuhs-xmg2` | `/resource/fuhs-xmg2.json` | Urban Park Rangers animal incident responses with species, condition, location, and ranger action |
| Park Properties | `enfh-gkve` | `/resource/enfh-gkve.geojson` | NYC Parks boundary polygons used for the clickable park layer and centroid matching |

**Base URL:** `https://data.cityofnewyork.us`

### How Data Is Used

- **311 complaints** are plotted by their latitude/longitude coordinates. Open complaints appear as gold dots, closed as darker dots.
- **Dog runs** are rendered as teal polygon fills and centroid dots from the GeoJSON geometry.
- **Animal incidents** do not have coordinates in the source data. The app matches the `property` (park name) field against park boundary centroids to place them on the map. Incidents are grouped by park, with dot sizes proportional to the count.
- **Park boundaries** are loaded as a clickable background layer. Selecting a park highlights its outline and filters active data to that location.

---

## Local Data

| File | Description |
|------|-------------|
| `data/boroughs.geojson` | NYC borough boundary polygons for the faint map overlay |

---

## Technology Stack

| Technology | Purpose |
|------------|---------|
| [MapLibre GL JS](https://maplibre.org/) v4.7.1 | Interactive WebGL map rendering |
| [OpenFreeMap](https://openfreemap.org/) | Free map tile style (Liberty) |
| [Inter](https://rsms.me/inter/) (Google Fonts) | UI typeface |
| Vanilla JavaScript | No frameworks — single `app.js` file |
| CSS3 | Responsive layout with CSS Grid, Flexbox, and custom properties |

---

## Project Structure

```
NYCoffleash/
├── index.html          Main HTML (single page app)
├── scripts/
│   └── app.js          Application logic (~1,600 lines)
├── styles/
│   └── style.css       All styling (~870 lines)
├── data/
│   └── boroughs.geojson  NYC borough boundaries
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

## Caching

To reduce API calls and improve load times, the app caches data in the browser:

| Data | Storage | TTL |
|------|---------|-----|
| Park list (per borough) | localStorage | 24 hours |
| Dog runs | localStorage | 7 days |
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
