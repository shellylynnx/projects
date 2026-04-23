# Projects

A collection of browser-based creative tools and data explorers, built with vanilla JavaScript and Claude Code.

## Projects

### [METBird](METBird/)

Browse 9,751 bird-related artworks from The Metropolitan Museum of Art's open-access collection, enriched with taxonomy data from eBird. Features species-aware autocomplete search across 188 species, multi-plate artwork support, and offline viewing via service worker.

### [NYCoffleash](NYCoffleash/)

Explore NYC dog runs, off-leash complaints, and sick/injured animal reports on an interactive map. Built on MapLibre GL JS with live data from NYC Open Data APIs. Three viewing modes, mobile-friendly, and cached for performance.

### [One Page Zine](one-page-zine/)

A browser-based tool for creating one-page zines. Upload 8 images to fill the page slots, then download a print-ready PDF or PNG. Supports drag-and-drop, localStorage persistence, and works fully offline.

### [Riso Preview](riso-preview/)

Preview artwork in risograph ink colors and simulate overprint. Upload an image, assign up to three ink layers from 23 standard riso colors, and see how they combine with multiply blending. Includes mask painting tools (brush, eraser, magic wand) for color separation, per-layer color previews, and downloadable B&W separation plates for riso printing.

## Tech Stack

All projects are lightweight, single-page web apps with no build step required:

- **JavaScript**: vanilla ES modules, no frameworks
- **HTML / CSS**: responsive layouts with mobile and tablet support
- **Canvas API**: pixel-level image processing (Riso Preview, One Page Zine)
- **MapLibre GL JS**: interactive maps (NYCoffleash)
- **Service Workers**: offline support (METBird, NYCoffleash)
- **NYC Open Data & MET Open Access APIs**: live public data